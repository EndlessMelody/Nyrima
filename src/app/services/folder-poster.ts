/**
 * Local folder-poster lookup.
 *
 * Each library/season folder may contain a `Poster.{jpg,jpeg,png,webp}`
 * (case-insensitive) image dropped in by the user. When present we render
 * that file's Drive `thumbnailLink` as the library cover instead of
 * resolving against an external catalog. This replaced the MAL/Jikan
 * pipeline on 2026-05-18: manual curation gives the cleanest
 * one-poster-per-folder mapping and removes a flaky third-party dependency.
 *
 * Parent fallback (matches Plex/Jellyfin "show poster applies to seasons"):
 *   A season subfolder with no local poster walks up exactly one level to
 *   read its parent's poster. We never recurse further — predictability
 *   beats coverage. Folders directly under the Nyrima root that have no
 *   poster fall through to the initials/gradient tile in `LibraryCard`.
 *
 * URL freshness:
 *   Drive's image `thumbnailLink` URLs are signed but typically valid for
 *   weeks (longer than video thumb URLs). Callers persist the Drive file
 *   id alongside the URL (`RecentFolder.coverFileId`) so `resolveCoverUrl`
 *   below can re-mint a fresh thumbnailLink from the file id when the
 *   stored URL eventually expires.
 */

import {
  listFolder as cachedListFolder,
  getFileMetadata,
} from "./drive/metadata-service";
import type { DriveFile } from "@shared/types";
import type { RequestOptions } from "./drive/types";

/** Case-insensitive match for the manually-placed poster file. We accept
 *  the four image containers Drive renders thumbnails for. JPEG covers
 *  `.jpg` and `.jpeg`; WebP is increasingly common for screenshots. */
const POSTER_NAME_RE = /^poster\.(jpe?g|png|webp)$/i;

/** Pure filter — scan a Drive folder listing for the poster file. Returns
 *  the first match. The file order returned by Drive is `folder,name`, so
 *  in the unlikely case of two posters the alphabetically-first wins. */
export function findPosterFile(files: DriveFile[]): DriveFile | null {
  for (const f of files) {
    if (POSTER_NAME_RE.test(f.name)) return f;
  }
  return null;
}

export interface FolderPoster {
  /** Drive file id of the matched Poster.* file. Persist this so the URL
   *  can be re-resolved when the cached URL signature expires. */
  fileId: string;
  /** Drive-served thumbnail URL. Safe to drop into `<img src>` directly. */
  url: string;
}

/**
 * Resolve a folder's poster, optionally walking up to the parent folder
 * when the folder itself has none. Returns `null` when neither location
 * holds a `Poster.{jpg,jpeg,png,webp}` file — callers fall through to the
 * initials tile.
 *
 * Both lookups go through the cached `listFolder`, so a warm cache means
 * zero Drive requests. The parent fallback only fires when a poster file
 * is genuinely missing locally; folders that already supply their own
 * cover never pay the second listing.
 */
export async function resolveFolderPoster(
  folderId: string,
  parentFolderId?: string,
  opts: RequestOptions = {},
): Promise<FolderPoster | null> {
  const own = await listPoster(folderId, opts);
  if (own) return own;
  if (parentFolderId && parentFolderId !== folderId) {
    return await listPoster(parentFolderId, opts);
  }
  return null;
}

async function listPoster(
  folderId: string,
  opts: RequestOptions,
): Promise<FolderPoster | null> {
  try {
    const result = await cachedListFolder(folderId, {
      priority: "low",
      ...opts,
    });
    const poster = findPosterFile(result.files);
    if (!poster?.thumbnailLink) return null;
    return { fileId: poster.id, url: poster.thumbnailLink };
  } catch {
    // Permission/rate-limit failure — let the caller render the fallback.
    return null;
  }
}

/**
 * Re-mint a poster URL when only the Drive file id is cached (e.g. on a
 * lobby revisit weeks after the original enrichment). `getFileMetadata` is
 * cache-fronted; on a warm cache this costs no Drive request. Returns
 * `null` when the file is gone or thumbnail-less.
 */
export async function resolveCoverUrl(
  fileId: string,
): Promise<string | null> {
  try {
    const file = await getFileMetadata(fileId, { priority: "low" });
    return file.thumbnailLink ?? null;
  } catch {
    return null;
  }
}
