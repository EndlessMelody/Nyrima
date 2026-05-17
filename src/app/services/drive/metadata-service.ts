/**
 * DriveMetadataService — cache-first Drive metadata.
 *
 * Strategy: stale-while-revalidate.
 *   - On read: return cached entry immediately if present (even if stale),
 *     then kick off a background revalidation when stale.
 *   - On write: persist the new entry + emit a change event so subscribers
 *     re-render with fresh data.
 *
 * Without this layer, navigating from Lobby → Player → back fired off
 * `listFolderAll(folderId)` three times within a few seconds. The folder
 * cache holds those listings for ~20 min so navigation costs zero requests.
 *
 * What's NOT cached here:
 *   - Media bytes (Phase 3 / segment cache, separate)
 *   - MAL/Jikan poster lookups (existing metadata-cache.ts, separate concern)
 *   - Playback positions (chrome.storage.local, never stale)
 */

import { idbGet, idbPut, idbDelete, STORES } from "./idb";
import { useDevModeStore } from "./dev-mode";
import { isCoolingDown } from "./rate-limit-store";
import {
  listFolderAll as rawListFolderAll,
  getFile as rawGetFile,
  matchSubtitlesForVideo,
  isSubtitleFile,
  isVideoFile,
  isFolder,
  downloadTextFile,
  getExtension,
} from "../drive-api";
import {
  parseSubtitles,
  detectLang,
  prettyLangLabel,
  type SubCue,
} from "../subtitles";
import type { DriveFile } from "@shared/types";
import type { RequestOptions } from "./types";

// ---------------------------------------------------------------------------
// TTLs (ms)
// ---------------------------------------------------------------------------

const FOLDER_SCAN_TTL = 20 * 60 * 1000; // 20 min
const FILE_METADATA_TTL = 45 * 60 * 1000; // 45 min
// Subtitles rarely change after upload. The modifiedTime check in
// getSubtitleText busts the cache the moment a sub is re-uploaded, so the
// TTL only matters as a "force re-download after long absence" floor. A
// week is generous without being effectively-forever.
const SUBTITLE_TEXT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

export interface FolderScanEntry {
  folderId: string;
  files: DriveFile[];
  scannedAt: number;
}

export interface FileMetadataEntry {
  fileId: string;
  file: DriveFile;
  fetchedAt: number;
}

export interface SubtitleTextEntry {
  fileId: string;
  modifiedTime?: string;
  text: string;
  cues: SubCue[];
  lang: string;
  label: string;
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Subscribers — minimal pub-sub so library-store can refresh
// ---------------------------------------------------------------------------

type FolderChangeListener = (folderId: string) => void;
const folderChangeListeners = new Set<FolderChangeListener>();

export function onFolderChange(fn: FolderChangeListener): () => void {
  folderChangeListeners.add(fn);
  return () => folderChangeListeners.delete(fn);
}

function emitFolderChange(folderId: string): void {
  for (const l of folderChangeListeners) {
    try {
      l(folderId);
    } catch {
      // Listener bugs shouldn't take down the revalidation path.
    }
  }
}

// ---------------------------------------------------------------------------
// Stats — observable by debug panel
// ---------------------------------------------------------------------------

const stats = {
  folderHits: 0,
  folderStaleHits: 0,
  folderMisses: 0,
  fileHits: 0,
  fileStaleHits: 0,
  fileMisses: 0,
  subtitleHits: 0,
  subtitleMisses: 0,
  revalidations: 0,
};

export function getMetadataCacheStats(): typeof stats {
  return { ...stats };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFresh(fetchedAt: number, ttl: number): boolean {
  return Date.now() - fetchedAt <= ttl;
}

// Each folder scan revalidation is gated so concurrent reads don't trigger
// multiple background fetches.
const revalidating = new Set<string>();

// ---------------------------------------------------------------------------
// Folder scan
// ---------------------------------------------------------------------------

export interface FolderListOptions extends RequestOptions {
  /** Force a network fetch even if the cache is fresh. */
  forceRefresh?: boolean;
  /** Skip the network when stale; return cached or empty. */
  cacheOnly?: boolean;
}

export interface FolderListResult {
  files: DriveFile[];
  fromCache: boolean;
  scannedAt: number;
  /** When true, a background revalidation is in flight. */
  revalidating: boolean;
}

export async function listFolder(
  folderId: string,
  opts: FolderListOptions = {},
): Promise<FolderListResult> {
  // Apply dev-mode safety overrides. cacheOnly forces a pure cache read;
  // disablePrefetch is honored by skipping background revalidation below.
  const dev = useDevModeStore.getState();
  const effective: FolderListOptions = {
    ...opts,
    cacheOnly: opts.cacheOnly || dev.cacheOnly,
  };
  const cached = (await idbGet<FolderScanEntry>(
    STORES.FOLDER_SCAN,
    folderId,
  )) ?? null;

  if (cached && !effective.forceRefresh) {
    const fresh = isFresh(cached.scannedAt, FOLDER_SCAN_TTL);
    if (fresh) {
      stats.folderHits += 1;
      return {
        files: cached.files,
        fromCache: true,
        scannedAt: cached.scannedAt,
        revalidating: false,
      };
    }
    if (effective.cacheOnly) {
      stats.folderStaleHits += 1;
      return {
        files: cached.files,
        fromCache: true,
        scannedAt: cached.scannedAt,
        revalidating: false,
      };
    }
    // Stale — return cached now and revalidate in background, unless dev
    // mode has disabled prefetch OR Drive is in a global cooldown (firing
    // a "sync" revalidation against a refusing server just amplifies the
    // storm and resets the cooldown timer).
    stats.folderStaleHits += 1;
    const shouldRevalidate = !dev.disablePrefetch && !isCoolingDown();
    if (shouldRevalidate) {
      void revalidateFolder(folderId, opts).catch(() => {
        // The fetch failed; we already returned the stale snapshot, so
        // there's nothing for the caller to do here. The error will surface
        // on the next direct call.
      });
    }
    return {
      files: cached.files,
      fromCache: true,
      scannedAt: cached.scannedAt,
      revalidating: shouldRevalidate,
    };
  }

  if (effective.cacheOnly) {
    stats.folderMisses += 1;
    return {
      files: [],
      fromCache: false,
      scannedAt: 0,
      revalidating: false,
    };
  }

  stats.folderMisses += 1;
  const files = await rawListFolderAll(folderId, opts);
  const entry: FolderScanEntry = {
    folderId,
    files,
    scannedAt: Date.now(),
  };
  await idbPut(STORES.FOLDER_SCAN, folderId, entry);
  emitFolderChange(folderId);
  return { files, fromCache: false, scannedAt: entry.scannedAt, revalidating: false };
}

async function revalidateFolder(
  folderId: string,
  opts: FolderListOptions,
): Promise<void> {
  if (revalidating.has(folderId)) return;
  revalidating.add(folderId);
  stats.revalidations += 1;
  try {
    const files = await rawListFolderAll(folderId, {
      ...opts,
      priority: opts.priority ?? "low",
    });
    const entry: FolderScanEntry = {
      folderId,
      files,
      scannedAt: Date.now(),
    };
    await idbPut(STORES.FOLDER_SCAN, folderId, entry);
    emitFolderChange(folderId);
  } finally {
    revalidating.delete(folderId);
  }
}

export async function invalidateFolder(folderId: string): Promise<void> {
  await idbDelete(STORES.FOLDER_SCAN, folderId);
}

// ---------------------------------------------------------------------------
// File metadata
// ---------------------------------------------------------------------------

export interface FileOptions extends RequestOptions {
  forceRefresh?: boolean;
  cacheOnly?: boolean;
}

export async function getFileMetadata(
  fileId: string,
  opts: FileOptions = {},
): Promise<DriveFile> {
  const cached = (await idbGet<FileMetadataEntry>(
    STORES.FILE_METADATA,
    fileId,
  )) ?? null;

  const dev = useDevModeStore.getState();
  if (cached && !opts.forceRefresh) {
    if (isFresh(cached.fetchedAt, FILE_METADATA_TTL)) {
      stats.fileHits += 1;
      return cached.file;
    }
    if (opts.cacheOnly || dev.cacheOnly) {
      stats.fileStaleHits += 1;
      return cached.file;
    }
    // Stale — return cached, revalidate in background. Skip the revalidation
    // when Drive is rate-limiting us; a stale fileMetadata entry is safer
    // than a fresh rate-limit hit.
    stats.fileStaleHits += 1;
    if (!dev.disablePrefetch && !isCoolingDown()) {
      void revalidateFile(fileId, opts).catch(() => undefined);
    }
    return cached.file;
  }

  if (opts.cacheOnly && cached) {
    return cached.file;
  }

  stats.fileMisses += 1;
  const file = await rawGetFile(fileId, undefined, opts);
  await idbPut(STORES.FILE_METADATA, fileId, {
    fileId,
    file,
    fetchedAt: Date.now(),
  });
  return file;
}

async function revalidateFile(
  fileId: string,
  opts: FileOptions,
): Promise<void> {
  stats.revalidations += 1;
  const file = await rawGetFile(fileId, undefined, {
    ...opts,
    priority: opts.priority ?? "low",
  });
  await idbPut(STORES.FILE_METADATA, fileId, {
    fileId,
    file,
    fetchedAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Subtitle text
// ---------------------------------------------------------------------------

export async function getSubtitleText(
  file: DriveFile,
  opts: RequestOptions = {},
): Promise<SubtitleTextEntry> {
  const cached = (await idbGet<SubtitleTextEntry>(
    STORES.SUBTITLE,
    file.id,
  )) ?? null;

  // Bust cache when modifiedTime changed (the file was re-uploaded).
  const cacheValid =
    cached &&
    cached.modifiedTime === file.modifiedTime &&
    isFresh(cached.fetchedAt, SUBTITLE_TEXT_TTL);

  if (cacheValid) {
    stats.subtitleHits += 1;
    return cached;
  }

  stats.subtitleMisses += 1;
  const text = await downloadTextFile(file.id, opts);
  const lang = detectLang(file.name);
  const entry: SubtitleTextEntry = {
    fileId: file.id,
    modifiedTime: file.modifiedTime,
    text,
    cues: parseSubtitles(text, getExtension(file.name)),
    lang,
    label: prettyLangLabel(lang, file.name),
    fetchedAt: Date.now(),
  };
  await idbPut(STORES.SUBTITLE, file.id, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Convenience: classify a cached folder listing the way the UI expects.
// ---------------------------------------------------------------------------

export interface ClassifiedFolder {
  files: DriveFile[];
  subfolders: DriveFile[];
  videos: Array<{ video: DriveFile; subtitles: DriveFile[] }>;
}

export function classifyFolder(files: DriveFile[]): ClassifiedFolder {
  const subfolders = files.filter(isFolder);
  const videos = files
    .filter(isVideoFile)
    .map((v) => ({ video: v, subtitles: matchSubtitlesForVideo(v, files) }));
  return { files, subfolders, videos };
}

export { isSubtitleFile };
