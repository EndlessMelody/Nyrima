/**
 * Drive-backed audio sourcing for the music player.
 *
 * Unlike the video player (which prefers a direct streamable URL and only
 * falls back to a blob), the music player ALWAYS downloads the track into a
 * same-origin object URL. Two reasons:
 *   1. Web-app builds have no extension DNR rule to stamp the `Authorization`
 *      header onto a bare `<audio src>`, so OAuth-private files can't stream
 *      directly anyway.
 *   2. The 10-band EQ runs through Web Audio (`MediaElementAudioSourceNode`),
 *      which is silenced by a cross-origin/tainted source. A blob object URL is
 *      same-origin, so the EQ graph stays audible.
 *
 * Audio files (FLAC/MP3/…) are small enough (tens of MB) that a full download
 * is acceptable; we surface progress so the UI can show a buffering state.
 */

import { buildMediaUrl, getFile, getExtension, listFolderAll } from "./drive-api";
import { authedFetch } from "./auth";
import { isSupportedMediaFile } from "./media-library-source";
import type { DriveFile } from "@shared/types";
import type { Priority, RequestKind } from "./drive/types";

export interface DownloadedAudio {
  /** Same-origin object URL — assign to `<audio src>` and remember to revoke. */
  url: string;
  size: number;
  mimeType: string;
  embedded: DownloadedEmbeddedAudioMetadata;
  /** Sample rate / bit depth / channels parsed from a FLAC STREAMINFO block or WAV `fmt ` chunk, when available. */
  format?: AudioFormatInfo;
}

export interface AudioFormatInfo {
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
}

export interface DownloadedEmbeddedAudioMetadata {
  lyricsText?: string;
  pictureUrl?: string;
  pictureMimeType?: string;
}

export interface EmbeddedAudioPicture {
  blob: Blob;
  mimeType: string;
}

export interface EmbeddedFlacMetadata {
  lyricsText?: string;
  picture?: EmbeddedAudioPicture;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  /**
   * Playback uses critical priority. Background warmups can opt down to low
   * without blocking the user-requested track.
   */
  priority?: Priority;
  /**
   * Full audio downloads should use the open-ended stream lane so they do not
   * contend with video/MSE byte-range fetches.
   */
  kind?: RequestKind;
  /** 0..1 download progress (only fires when Content-Length is known). */
  onProgress?: (fraction: number) => void;
}

const PREFETCH_CACHE_LIMIT = 2;
const prefetchedAudio = new Map<string, DownloadedAudio>();
const prefetchingAudio = new Map<string, Promise<void>>();

/**
 * Download a Drive audio file into an object URL, reporting progress. The
 * caller owns the returned `url` and must `URL.revokeObjectURL` it when the
 * track changes or the component unmounts.
 *
 * Throws if the file id is malformed (via `buildMediaUrl`) or Drive rejects the
 * request (via `authedFetch`).
 */
export async function downloadAudioObjectUrl(
  fileId: string,
  opts: DownloadOptions = {},
): Promise<DownloadedAudio> {
  const cached = prefetchedAudio.get(fileId);
  if (cached) {
    prefetchedAudio.delete(fileId);
    opts.onProgress?.(1);
    return cached;
  }

  const warming = prefetchingAudio.get(fileId);
  if (warming) {
    await warming;
    const warmed = prefetchedAudio.get(fileId);
    if (warmed) {
      prefetchedAudio.delete(fileId);
      opts.onProgress?.(1);
      return warmed;
    }
  }

  return downloadAudioObjectUrlUncached(fileId, opts);
}

export function prefetchAudioObjectUrl(
  fileId: string,
  opts: DownloadOptions = {},
): Promise<void> {
  if (prefetchedAudio.has(fileId)) return Promise.resolve();
  const existing = prefetchingAudio.get(fileId);
  if (existing) return existing;

  const task = downloadAudioObjectUrlUncached(fileId, {
    ...opts,
    priority: opts.priority ?? "low",
    kind: opts.kind ?? "media-stream",
    onProgress: undefined,
  })
    .then((audio) => {
      if (opts.signal?.aborted) {
        revokeDownloadedAudio(audio);
        return;
      }
      prefetchedAudio.set(fileId, audio);
      trimPrefetchedAudio(fileId);
    })
    .catch(() => {
      // Background warmups should never surface as playback errors.
    })
    .finally(() => {
      prefetchingAudio.delete(fileId);
    });

  prefetchingAudio.set(fileId, task);
  return task;
}

async function downloadAudioObjectUrlUncached(
  fileId: string,
  opts: DownloadOptions = {},
): Promise<DownloadedAudio> {
  const url = buildMediaUrl(fileId);
  const res = await authedFetch(
    url,
    { signal: opts.signal },
    {
      kind: opts.kind ?? "media-stream",
      priority: opts.priority ?? "critical",
      signal: opts.signal,
    },
  );

  const total = Number(res.headers.get("content-length") ?? 0);
  const mimeType = res.headers.get("content-type") ?? "audio/*";
  opts.onProgress?.(total > 0 ? 0 : 0.08);

  // Stream the body so we can report progress; fall back to res.blob() when
  // the body isn't readable (older runtimes / opaque responses).
  if (!res.body) {
    const blob = await res.blob();
    const { embedded, format } = await analyzeAudioBlob(blob);
    return {
      url: URL.createObjectURL(blob),
      size: blob.size,
      mimeType,
      embedded: toDownloadedEmbeddedMetadata(embedded),
      ...(format ? { format } : {}),
    };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.length;
    if (total > 0) opts.onProgress?.(Math.min(1, received / total));
  }

  const bytes = concatChunks(chunks, received);
  const embedded = extractEmbeddedFlacMetadata(bytes);
  const format = parseAudioFormatInfo(bytes);
  const blob = new Blob([bytes], { type: mimeType });
  opts.onProgress?.(1);
  return {
    url: URL.createObjectURL(blob),
    size: blob.size,
    mimeType,
    embedded: toDownloadedEmbeddedMetadata(embedded),
    ...(format ? { format } : {}),
  };
}

function trimPrefetchedAudio(keepId: string): void {
  for (const [id, audio] of prefetchedAudio) {
    if (prefetchedAudio.size <= PREFETCH_CACHE_LIMIT) break;
    if (id === keepId) continue;
    prefetchedAudio.delete(id);
    revokeDownloadedAudio(audio);
  }
}

function revokeDownloadedAudio(audio: DownloadedAudio): void {
  URL.revokeObjectURL(audio.url);
  if (audio.embedded.pictureUrl) URL.revokeObjectURL(audio.embedded.pictureUrl);
}

export interface ParsedTrack {
  title: string;
  artist?: string;
}

/**
 * Best-effort metadata from a filename. Drive doesn't expose audio tags, so we
 * lean on the fansub-style naming conventions Nyrima sees in practice:
 *   - strip the extension and bracketed release/quality tags (`[2026.05.22]`,
 *     `[FLAC]`, `[Hi-Res]`, `【…】`),
 *   - drop a leading track number (`09. `, `09 - `),
 *   - split a remaining `Artist - Title` into its parts.
 */
export function parseTrackName(fileName: string): ParsedTrack {
  let base = fileName.replace(/\.[^.]+$/, "");

  // Leading bracket tag (release date / group).
  base = base.replace(/^\s*[[(【][^\])】]*[\])】]\s*/, "");
  // Trailing bracket tags, possibly several in a row.
  while (/[[(【][^\])】]*[\])】]\s*$/.test(base)) {
    base = base.replace(/\s*[[(【][^\])】]*[\])】]\s*$/, "").trim();
  }
  base = base.trim();

  // Leading track number: "09.", "09 -", "09)".
  const numbered = base.replace(/^\s*\d{1,3}[.)\-\s]+/, "").trim();
  const candidate = numbered || base;

  const dash = candidate.split(/\s[-–—]\s/);
  if (dash.length >= 2) {
    const artist = dash[0].trim();
    const title = dash.slice(1).join(" - ").trim();
    if (artist && title) return { title, artist };
  }

  return { title: candidate || fileName };
}

export interface FolderContext {
  folderId: string | null;
  /** Every (non-folder) file in the track's Drive folder. */
  allFiles: DriveFile[];
  /** Just the playable audio files, numeric-sorted by name. */
  audioFiles: DriveFile[];
  /** The track that was requested. */
  currentFile: DriveFile;
}

/**
 * Resolve the folder the track lives in and list its audio siblings (the
 * source of the "Up Next" queue). Falls back to a single-file context when the
 * file has no discoverable parent.
 */
export async function loadFolderContext(
  fileId: string,
  signal?: AbortSignal,
): Promise<FolderContext> {
  const currentFile = await getFile(fileId, undefined, { signal });
  const folderId = currentFile.parents?.[0] ?? null;

  if (!folderId) {
    return {
      folderId: null,
      allFiles: [currentFile],
      audioFiles: [currentFile],
      currentFile,
    };
  }

  const allFiles = await listFolderAll(folderId, { signal });
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
 * Find a sibling `.lrc` lyrics file for a track by basename — same convention
 * the video player uses to pair subtitles with a video. Prefers an exact
 * basename match, then a prefix match (covers `Track.lrc` vs `Track (1).lrc`).
 */
export function findSiblingLrc(
  files: DriveFile[],
  trackFile: DriveFile,
): DriveFile | null {
  const base = stripExtension(trackFile.name).toLowerCase();
  const lrcs = files.filter((f) => getExtension(f.name) === "lrc");
  return (
    lrcs.find((f) => stripExtension(f.name).toLowerCase() === base) ??
    lrcs.find((f) => stripExtension(f.name).toLowerCase().startsWith(base)) ??
    null
  );
}

/**
 * Music folders can include a curated `cover.jpg` beside the tracks. Prefer
 * that exact convention, then accept common image extensions if the user saved
 * the same basename differently. A displayable Drive thumbnail is required so
 * the player can render the image without another media download.
 */
export function findSiblingCover(files: DriveFile[]): DriveFile | null {
  const displayable = files.filter(
    (file) => !!file.thumbnailLink && /^cover\.(jpe?g|png|webp)$/i.test(file.name),
  );
  return (
    displayable.find((file) => /^cover\.jpe?g$/i.test(file.name)) ??
    displayable[0] ??
    null
  );
}

export function extractEmbeddedFlacMetadata(
  input: ArrayBuffer | Uint8Array<ArrayBufferLike>,
): EmbeddedFlacMetadata {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isFlac(bytes)) return {};

  let offset = 4;
  let lyricsText: string | undefined;
  let picture: EmbeddedAudioPicture | undefined;
  let done = false;

  while (!done && offset + 4 <= bytes.length) {
    const header = bytes[offset] ?? 0;
    done = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const length =
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0);
    offset += 4;
    if (length < 0 || offset + length > bytes.length) break;

    const block = bytes.subarray(offset, offset + length);
    if (type === 4 && !lyricsText) {
      lyricsText = parseVorbisLyrics(block);
    } else if (type === 6 && !picture) {
      picture = parseFlacPicture(block) ?? undefined;
    }

    offset += length;
  }

  return {
    ...(lyricsText ? { lyricsText } : {}),
    ...(picture ? { picture } : {}),
  };
}

/**
 * Parse sample rate / bit depth / channel count from a FLAC STREAMINFO block
 * or a WAV `fmt ` chunk. Returns `null` for compressed formats (MP3/AAC/…)
 * where "bit depth" isn't a meaningful concept.
 */
export function parseAudioFormatInfo(
  input: ArrayBuffer | Uint8Array<ArrayBufferLike>,
): AudioFormatInfo | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (isFlac(bytes)) return parseFlacFormatInfo(bytes);
  if (isWav(bytes)) return parseWavFormatInfo(bytes);
  return null;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function concatChunks(
  chunks: Uint8Array<ArrayBufferLike>[],
  totalLength: number,
): Uint8Array<ArrayBuffer> {
  const out: Uint8Array<ArrayBuffer> = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function analyzeAudioBlob(
  blob: Blob,
): Promise<{ embedded: EmbeddedFlacMetadata; format: AudioFormatInfo | null }> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { embedded: extractEmbeddedFlacMetadata(bytes), format: parseAudioFormatInfo(bytes) };
  } catch {
    return { embedded: {}, format: null };
  }
}

export function toDownloadedEmbeddedMetadata(
  embedded: EmbeddedFlacMetadata,
): DownloadedEmbeddedAudioMetadata {
  return {
    ...(embedded.lyricsText ? { lyricsText: embedded.lyricsText } : {}),
    ...(embedded.picture
      ? {
          pictureUrl: URL.createObjectURL(embedded.picture.blob),
          pictureMimeType: embedded.picture.mimeType,
        }
      : {}),
  };
}

function isFlac(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
  );
}

function isWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45 // E
  );
}

/** STREAMINFO (block type 0) must be the first metadata block per the FLAC spec. */
function parseFlacFormatInfo(bytes: Uint8Array): AudioFormatInfo | null {
  if (bytes.length < 4 + 4 + 18) return null;
  const type = (bytes[4] ?? 0) & 0x7f;
  if (type !== 0) return null;
  const length = ((bytes[5] ?? 0) << 16) | ((bytes[6] ?? 0) << 8) | (bytes[7] ?? 0);
  if (length < 18 || 8 + length > bytes.length) return null;
  return parseFlacStreamInfo(bytes.subarray(8, 8 + length));
}

/**
 * STREAMINFO bytes 10-17 (64 bits) pack:
 *   sample_rate(20) | channels-1(3) | bits_per_sample-1(5) | total_samples(36)
 */
function parseFlacStreamInfo(block: Uint8Array): AudioFormatInfo | null {
  if (block.length < 18) return null;
  const b10 = block[10] ?? 0;
  const b11 = block[11] ?? 0;
  const b12 = block[12] ?? 0;
  const b13 = block[13] ?? 0;
  const sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);
  const channels = ((b12 >> 1) & 0x07) + 1;
  const bitsPerSample = (((b12 & 0x01) << 4) | (b13 >> 4)) + 1;
  if (sampleRate <= 0) return null;
  return { sampleRate, channels, bitsPerSample };
}

/** Walks RIFF chunks (word-aligned) looking for the `fmt ` chunk. */
function parseWavFormatInfo(bytes: Uint8Array): AudioFormatInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id =
      String.fromCharCode(bytes[offset] ?? 0) +
      String.fromCharCode(bytes[offset + 1] ?? 0) +
      String.fromCharCode(bytes[offset + 2] ?? 0) +
      String.fromCharCode(bytes[offset + 3] ?? 0);
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    if (id === "fmt " && dataStart + 16 <= bytes.length) {
      const channels = view.getUint16(dataStart + 2, true);
      const sampleRate = view.getUint32(dataStart + 4, true);
      const bitsPerSample = view.getUint16(dataStart + 14, true);
      if (sampleRate <= 0) return null;
      return { sampleRate, channels, bitsPerSample };
    }
    offset = dataStart + size + (size % 2);
  }
  return null;
}

function parseVorbisLyrics(block: Uint8Array): string | undefined {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  let offset = 0;
  const vendorLength = readUint32Le(view, offset);
  if (vendorLength == null) return undefined;
  offset += 4 + vendorLength;

  const count = readUint32Le(view, offset);
  if (count == null) return undefined;
  offset += 4;

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const candidates: Array<{ rank: number; text: string }> = [];
  for (let i = 0; i < count && offset + 4 <= block.byteLength; i++) {
    const length = readUint32Le(view, offset);
    if (length == null) break;
    offset += 4;
    if (offset + length > block.byteLength) break;
    const raw = decoder.decode(block.subarray(offset, offset + length));
    offset += length;

    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    const key = raw.slice(0, eq).trim().toUpperCase().replace(/[\s-]+/g, "");
    const text = raw.slice(eq + 1).trim();
    if (!text || !key.includes("LYRICS")) continue;

    const rank = key.includes("UNSYNCED")
      ? 0
      : key === "LYRICS"
        ? 1
        : key === "SYNCEDLYRICS"
          ? 3
          : 2;
    candidates.push({ rank, text });
  }

  candidates.sort((a, b) => a.rank - b.rank);
  return candidates[0]?.text;
}

function parseFlacPicture(block: Uint8Array): EmbeddedAudioPicture | null {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  let offset = 0;

  if (block.byteLength < 32) return null;
  offset += 4; // picture type

  const mimeLength = readUint32Be(view, offset);
  if (mimeLength == null) return null;
  offset += 4;
  if (offset + mimeLength > block.byteLength) return null;
  const mimeType =
    new TextDecoder("ascii").decode(block.subarray(offset, offset + mimeLength)) ||
    "image/*";
  offset += mimeLength;

  const descriptionLength = readUint32Be(view, offset);
  if (descriptionLength == null) return null;
  offset += 4 + descriptionLength;
  offset += 16; // width, height, depth, indexed-color count

  const dataLength = readUint32Be(view, offset);
  if (dataLength == null) return null;
  offset += 4;
  if (offset + dataLength > block.byteLength) return null;

  const normalizedMime = mimeType.toLowerCase();
  if (!normalizedMime.startsWith("image/")) return null;

  const imageBytes = new Uint8Array(dataLength);
  imageBytes.set(block.subarray(offset, offset + dataLength));
  return {
    blob: new Blob([imageBytes], { type: normalizedMime }),
    mimeType: normalizedMime,
  };
}

function readUint32Le(view: DataView, offset: number): number | null {
  if (offset < 0 || offset + 4 > view.byteLength) return null;
  return view.getUint32(offset, true);
}

function readUint32Be(view: DataView, offset: number): number | null {
  if (offset < 0 || offset + 4 > view.byteLength) return null;
  return view.getUint32(offset, false);
}
