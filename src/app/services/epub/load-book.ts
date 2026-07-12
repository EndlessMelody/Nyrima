/**
 * Open an EPUB from Google Drive into a ready-to-read `EpubBook`.
 *
 * Flow: try the local IndexedDB cache first (instant resume / offline), else
 * download the archive via the authed Drive pipeline, cache it, then parse.
 * The cache key folds in the Drive md5 so a re-uploaded book busts the cache.
 */

import { downloadFile, getFile } from "../drive-api";
import { localLibrary } from "../local-library/local-source";
import { getCachedEpub, putCachedEpub } from "./epub-cache";
import { parseEpub } from "./epub-parser";
import type { EpubBook } from "./types";

export interface LoadedBook {
  book: EpubBook;
  /** Drive file name (with extension) — used for titles + persistence keys. */
  fileName: string;
}

export async function loadBookFromDrive(
  fileId: string,
  opts: { signal?: AbortSignal; fileName?: string } = {},
): Promise<LoadedBook> {
  // Resolve metadata for a cache-busting key + a display name. Cheap + cached
  // by the metadata layer, and we need the name regardless.
  let fileName = opts.fileName ?? "";
  let md5 = "";
  try {
    const meta = await getFile(fileId, "id,name,md5Checksum", { signal: opts.signal });
    fileName = meta.name || fileName;
    md5 = meta.md5Checksum ?? "";
  } catch {
    /* fall back to a download-only path below */
  }

  const cacheKey = `${fileId}:${md5}`;

  let buffer: ArrayBuffer | null = md5 ? await getCachedEpub(cacheKey) : null;
  if (!buffer) {
    const blob = await downloadFile(fileId, { kind: "subtitle", signal: opts.signal });
    buffer = await blob.arrayBuffer();
    if (md5) void putCachedEpub(cacheKey, buffer.slice(0));
  }

  const book = await parseEpub(buffer);
  return { book, fileName: fileName || book.title };
}

/**
 * Open an EPUB from the connected local library. Disk is the cache here, so
 * unlike `loadBookFromDrive` this skips the IDB epub-cache entirely.
 */
export async function loadBookFromLocal(localId: string): Promise<LoadedBook> {
  const file = await localLibrary.resolveFile(localId);
  const buffer = await file.arrayBuffer();
  const book = await parseEpub(buffer);
  return { book, fileName: file.name || book.title };
}
