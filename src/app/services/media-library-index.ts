import { listFolder as cachedListFolder, type FolderListOptions, type FolderListResult } from "./drive/metadata-service";
import {
  MEDIA_LIBRARY_KINDS,
  getExtension,
  getMediaFolderName,
  isFolder,
  isSupportedMediaFile,
  type MediaLibraryKind,
} from "./media-library-source";
import type { DriveFile } from "@shared/types";

export type MediaFolderListResult = Pick<
  FolderListResult,
  "files" | "fromCache" | "scannedAt" | "revalidating"
>;

export type MediaFolderListFn = (
  folderId: string,
  opts?: FolderListOptions,
) => Promise<MediaFolderListResult>;

export interface IndexedMediaFile {
  kind: MediaLibraryKind;
  file: DriveFile;
  sourceFolder: DriveFile;
  parentFolder: DriveFile;
  relativeFolderIds: string[];
  relativeFolderNames: string[];
}

export interface UnsupportedMediaFileSample {
  name: string;
  extension: string;
  mimeType: string;
}

export interface MediaFolderScanStats {
  categoryName: string;
  folderId: string;
  scannedFolders: number;
  scannedFiles: number;
  supportedFiles: number;
  unsupportedFiles: number;
  supportedSample: string[];
  unsupportedSample: UnsupportedMediaFileSample[];
  unsupportedExtensions: Record<string, number>;
}

export interface MediaFolderScanResult {
  kind: MediaLibraryKind;
  folder: DriveFile;
  files: IndexedMediaFile[];
  folders: DriveFile[];
  stats: MediaFolderScanStats;
  scannedAt: number;
  revalidating: boolean;
}

export interface ScanMediaFolderOptions {
  kind: MediaLibraryKind;
  folder: DriveFile;
  listFolder?: MediaFolderListFn;
  forceRefresh?: boolean;
  debug?: boolean;
}

interface QueueEntry {
  folder: DriveFile;
  relativeFolderIds: string[];
  relativeFolderNames: string[];
}

/** How many folder listings to have in flight at once during a recursive
 *  scan. The Drive request queue (`authedFetch`) still globally throttles
 *  and rate-limits, so this just lets independent sibling folders (e.g.
 *  season folders) resolve concurrently instead of one at a time. */
const SCAN_CONCURRENCY = 4;

export async function scanMediaFolderRecursive({
  kind,
  folder,
  listFolder = cachedListFolder,
  forceRefresh,
  debug,
}: ScanMediaFolderOptions): Promise<MediaFolderScanResult> {
  const visitedFolderIds = new Set<string>();
  const indexedFileIds = new Set<string>();
  const queue: QueueEntry[] = [
    { folder, relativeFolderIds: [], relativeFolderNames: [] },
  ];
  const folders: DriveFile[] = [];
  const files: IndexedMediaFile[] = [];
  let scannedAt = 0;
  let revalidating = false;
  let scannedFiles = 0;
  let unsupportedFiles = 0;
  const unsupportedExtensions: Record<string, number> = {};
  const supportedSample: string[] = [];
  const unsupportedSample: UnsupportedMediaFileSample[] = [];

  async function processEntry(current: QueueEntry): Promise<void> {
    const result = await listFolder(current.folder.id, {
      forceRefresh,
      priority: current.folder.id === folder.id ? "normal" : "low",
    });
    scannedAt = Math.max(scannedAt, result.scannedAt);
    revalidating = revalidating || result.revalidating;

    for (const child of result.files) {
      if (isFolder(child)) {
        if (!visitedFolderIds.has(child.id)) {
          queue.push({
            folder: child,
            relativeFolderIds: [...current.relativeFolderIds, child.id],
            relativeFolderNames: [...current.relativeFolderNames, child.name],
          });
        }
        continue;
      }

      scannedFiles += 1;
      if (isSupportedMediaFile(kind, child)) {
        if (!indexedFileIds.has(child.id)) {
          indexedFileIds.add(child.id);
          files.push({
            kind,
            file: child,
            sourceFolder: folder,
            parentFolder: current.folder,
            relativeFolderIds: current.relativeFolderIds,
            relativeFolderNames: current.relativeFolderNames,
          });
          if (supportedSample.length < 10) supportedSample.push(child.name);
        }
        continue;
      }

      unsupportedFiles += 1;
      const extension = extensionLabel(child.name);
      unsupportedExtensions[extension] = (unsupportedExtensions[extension] ?? 0) + 1;
      if (unsupportedSample.length < 10) {
        unsupportedSample.push({
          name: child.name,
          extension,
          mimeType: child.mimeType,
        });
      }
    }
  }

  // Bounded-concurrency BFS: up to SCAN_CONCURRENCY folder listings run at
  // once. Each finished listing may push new subfolders onto `queue`, so the
  // pool keeps pumping until both the queue and all in-flight work are drained.
  await new Promise<void>((resolve) => {
    let active = 0;

    function pump(): void {
      while (active < SCAN_CONCURRENCY && queue.length > 0) {
        const current = queue.shift()!;
        if (visitedFolderIds.has(current.folder.id)) continue;
        visitedFolderIds.add(current.folder.id);
        folders.push(current.folder);

        active += 1;
        void processEntry(current).finally(() => {
          active -= 1;
          pump();
        });
      }
      if (active === 0 && queue.length === 0) resolve();
    }

    pump();
  });

  const scan: MediaFolderScanResult = {
    kind,
    folder,
    files,
    folders,
    stats: {
      categoryName: getMediaFolderName(kind),
      folderId: folder.id,
      scannedFolders: folders.length,
      scannedFiles,
      supportedFiles: files.length,
      unsupportedFiles,
      supportedSample,
      unsupportedSample,
      unsupportedExtensions,
    },
    scannedAt,
    revalidating,
  };

  if (debug ?? isDevMode()) logMediaIndexScan(scan);

  return scan;
}

export async function scanAllMediaFolders({
  folders,
  listFolder = cachedListFolder,
  forceRefresh,
  debug,
}: {
  folders: Partial<Record<MediaLibraryKind, DriveFile>>;
  listFolder?: MediaFolderListFn;
  forceRefresh?: boolean;
  debug?: boolean;
}): Promise<MediaFolderScanResult[]> {
  const scans = await Promise.all(
    MEDIA_LIBRARY_KINDS.flatMap((kind) => {
      const folder = folders[kind];
      if (!folder) return [];
      return scanMediaFolderRecursive({
        kind,
        folder,
        listFolder,
        forceRefresh,
        debug,
      });
    }),
  );
  return scans;
}

export function logMediaIndexScan(scan: MediaFolderScanResult): void {
  const stats = scan.stats;
  console.debug(
    `[nyrima:index] ${stats.categoryName} folderId=${stats.folderId} scannedFolders=${stats.scannedFolders} scannedFiles=${stats.scannedFiles} supported=${stats.supportedFiles} unsupported=${stats.unsupportedFiles}`,
  );
  console.debug(`[nyrima:index] ${stats.categoryName} supported sample=`, stats.supportedSample);
  console.debug(
    `[nyrima:index] ${stats.categoryName} unsupported extensions=`,
    stats.unsupportedExtensions,
  );
  console.debug(
    `[nyrima:index] ${stats.categoryName} unsupported sample=`,
    stats.unsupportedSample,
  );
}

function extensionLabel(name: string): string {
  const ext = getExtension(name);
  return ext ? `.${ext}` : "(none)";
}

function isDevMode(): boolean {
  return typeof import.meta !== "undefined" && !!import.meta.env?.DEV;
}
