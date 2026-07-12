/**
 * Local-file equivalents of music-source.ts's Drive helpers.
 *
 * Playback always uses `localLibrary.getStreamUrl` -- a disk-backed object
 * URL with zero RAM copy, so the EQ stays audible without re-downloading the
 * track. Embedded FLAC metadata (cover art / lyrics) is read from a bounded
 * file prefix instead of the whole file.
 */

import { parseLocalId, toLocalFolderId } from "@shared/local-id";
import { buildLocalFileDriveFile, inferLocalMimeType, localLibrary } from "./local-source";
import { getExtension, isSupportedMediaFile } from "../media-library-source";
import {
  extractEmbeddedFlacMetadata,
  parseAudioFormatInfo,
  toDownloadedEmbeddedMetadata,
  type AudioFormatInfo,
  type DownloadedAudio,
  type EmbeddedFlacMetadata,
  type FolderContext,
} from "../music-source";

/** Grow the read window until embedded metadata is found or the file ends. */
const FLAC_METADATA_PREFIX_SIZES = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024];

/**
 * Resolve the folder a local track lives in and list its audio siblings,
 * mirroring `loadFolderContext`'s shape so the queue/up-next logic in
 * `useMusicEngine` works unchanged.
 */
export async function loadLocalFolderContext(localId: string): Promise<FolderContext> {
  const relPath = parseLocalId(localId);
  if (relPath === null) throw new Error("Invalid local file id");

  const file = await localLibrary.resolveFile(localId);
  const currentFile = buildLocalFileDriveFile(relPath, file);

  const segments = relPath.split("/").filter(Boolean);
  segments.pop();
  const folderId = toLocalFolderId(segments.join("/"));

  const allFiles = await localLibrary.listEntries(folderId);
  const audioFiles = allFiles.filter((f) => isSupportedMediaFile("music", f));
  if (
    !audioFiles.some((f) => f.id === currentFile.id) &&
    isSupportedMediaFile("music", currentFile)
  ) {
    audioFiles.push(currentFile);
  }
  audioFiles.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );

  return { folderId, allFiles, audioFiles, currentFile };
}

/**
 * Same-origin object URL for a local track, with embedded FLAC metadata
 * (lyrics/cover) read from a bounded prefix of the file.
 */
export async function localAudioObjectUrl(localId: string): Promise<DownloadedAudio> {
  const file = await localLibrary.resolveFile(localId);
  const url = localLibrary.getStreamUrl(localId, file);
  const embedded = await extractLocalEmbeddedAudioMetadata(file);
  const format = await extractLocalAudioFormatInfo(file);
  return {
    url,
    size: file.size,
    mimeType: inferLocalMimeType(file.name, file.type),
    embedded: toDownloadedEmbeddedMetadata(embedded),
    ...(format ? { format } : {}),
  };
}

async function extractLocalEmbeddedAudioMetadata(file: File): Promise<EmbeddedFlacMetadata> {
  if (getExtension(file.name) !== "flac") return {};
  for (const size of FLAC_METADATA_PREFIX_SIZES) {
    const prefixSize = Math.min(size, file.size);
    const buf = await file.slice(0, prefixSize).arrayBuffer();
    const result = extractEmbeddedFlacMetadata(buf);
    if (result.lyricsText || result.picture || prefixSize >= file.size) return result;
  }
  return {};
}

/** FLAC STREAMINFO and WAV `fmt ` chunks both sit near the start of the file. */
async function extractLocalAudioFormatInfo(file: File): Promise<AudioFormatInfo | null> {
  const ext = getExtension(file.name);
  if (ext !== "flac" && ext !== "wav") return null;
  const prefixSize = Math.min(FLAC_METADATA_PREFIX_SIZES[0], file.size);
  const buf = await file.slice(0, prefixSize).arrayBuffer();
  return parseAudioFormatInfo(buf);
}
