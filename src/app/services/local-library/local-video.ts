/**
 * Local-file equivalents of the Drive helpers `PlayerPage` relies on:
 * resolving a video's folder context (siblings + display names), prefetching
 * an MKV header for `extractMkvSubtitles`, and reading sibling subtitle
 * files as text.
 */

import { parseLocalId, toLocalFolderId } from "@shared/local-id";
import { isSeasonFolderName } from "@shared/title-parser";
import {
  QUICK_OPEN_REL_PATH,
  buildLocalFileDriveFile,
  buildLocalFolderDriveFile,
  localLibrary,
} from "./local-source";
import { getExtension } from "../drive-api";
import { parseSubtitles, detectLang, prettyLangLabel, type SubCue } from "../subtitles";
import type { DriveFile } from "@shared/types";

export interface LocalVideoContext {
  video: DriveFile;
  folder: DriveFile;
  siblings: DriveFile[];
  /** Show name one level above `folder`, when `folder` looks like a season
   *  folder (e.g. "Kan" / "Zoku" / "Season 2") — mirrors the Drive path's
   *  parent-folder lookup for `showFolderName`. */
  showFolderName?: string;
}

/**
 * Resolve a local video's folder, siblings, and display-name context,
 * mirroring the shape PlayerPage's load effect builds from
 * `getFileMetadata` + `cachedListFolder` + `getFileMetadata(folderId)`.
 */
export async function loadLocalVideoContext(localId: string): Promise<LocalVideoContext> {
  const relPath = parseLocalId(localId);
  if (relPath === null) throw new Error("Invalid local file id");

  const file = await localLibrary.resolveFile(localId);
  const video = buildLocalFileDriveFile(relPath, file);

  const segments = relPath.split("/").filter(Boolean);
  segments.pop();
  const rawFolderName = segments[segments.length - 1] ?? localLibrary.getRootName() ?? "Local Library";
  const folderName = rawFolderName === QUICK_OPEN_REL_PATH ? "Quick Open" : rawFolderName;
  const folder = buildLocalFolderDriveFile(segments.join("/"), folderName || "Local Library");

  const siblings = await localLibrary.listEntries(folder.id);

  const showFolderName =
    isSeasonFolderName(folderName) && segments.length >= 2
      ? segments[segments.length - 2]
      : undefined;

  return { video, folder, siblings, showFolderName };
}

const MKV_HEADER_PREFETCH_SIZE = 4 * 1024 * 1024;

/** Read the leading bytes `extractMkvSubtitles` needs via `prefetchedBuf` —
 *  the local equivalent of its 4 MB Range-fetch header probe. */
export async function readLocalMkvHeader(
  file: File,
): Promise<{ buf: Uint8Array; fileSize: number }> {
  const size = Math.min(MKV_HEADER_PREFETCH_SIZE, file.size);
  const buf = new Uint8Array(await file.slice(0, size).arrayBuffer());
  return { buf, fileSize: file.size };
}

export interface LocalSubtitleTextEntry {
  text: string;
  cues: SubCue[];
  lang: string;
  label: string;
}

/** Read + parse a local sibling subtitle file, mirroring `getSubtitleText`'s
 *  output shape (no IDB cache — disk is the cache). */
export async function readLocalSubtitleText(file: DriveFile): Promise<LocalSubtitleTextEntry> {
  const f = await localLibrary.resolveFile(file.id);
  const text = await f.text();
  const lang = detectLang(file.name);
  return {
    text,
    cues: parseSubtitles(text, getExtension(file.name)),
    lang,
    label: prettyLangLabel(lang, file.name),
  };
}
