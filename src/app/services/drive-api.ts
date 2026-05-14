/**
 * Thin wrapper over the Google Drive v3 REST API.
 *
 * We intentionally avoid the official `googleapis` JS client to keep the
 * bundle small and the surface area auditable. Every request goes through
 * authedFetch which handles token refresh.
 *
 * Docs: https://developers.google.com/drive/api/v3/reference
 */

import { authedFetch } from "./auth";
import { getApiKey, appendApiKey } from "./api-key";
import type { DriveFile } from "@shared/types";
import {
  VIDEO_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  VIDEO_MIME_PATTERNS,
} from "@shared/constants";

const API_BASE = "https://www.googleapis.com/drive/v3";

const DEFAULT_FILE_FIELDS = [
  "id",
  "name",
  "mimeType",
  "size",
  "modifiedTime",
  "iconLink",
  "thumbnailLink",
  "parents",
  "videoMediaMetadata(width,height,durationMillis)",
].join(",");

const LIST_FIELDS = `nextPageToken,files(${DEFAULT_FILE_FIELDS})`;

export interface ListOptions {
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
  q?: string;
}

export interface ListResult {
  files: DriveFile[];
  nextPageToken?: string;
}

// ---------------------------------------------------------------------------
// Folder / file metadata
// ---------------------------------------------------------------------------

export async function getFile(
  fileId: string,
  fields = DEFAULT_FILE_FIELDS,
): Promise<DriveFile> {
  const url = `${API_BASE}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
  const res = await authedFetch(url);
  return (await res.json()) as DriveFile;
}

export async function listFolder(
  folderId: string,
  opts: ListOptions = {},
): Promise<ListResult> {
  const q = [`'${folderId}' in parents`, "trashed = false", opts.q]
    .filter(Boolean)
    .join(" and ");
  const params = new URLSearchParams({
    q,
    fields: LIST_FIELDS,
    pageSize: String(opts.pageSize ?? 200),
    orderBy: opts.orderBy ?? "folder,name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (opts.pageToken) params.set("pageToken", opts.pageToken);

  const res = await authedFetch(`${API_BASE}/files?${params}`);
  return (await res.json()) as ListResult;
}

/**
 * List every page of a folder. Use cautiously for very large libraries.
 */
export async function listFolderAll(folderId: string): Promise<DriveFile[]> {
  const all: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listFolder(folderId, { pageToken });
    all.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all;
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

export function isFolder(file: DriveFile): boolean {
  return file.mimeType === "application/vnd.google-apps.folder";
}

export function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isVideoFile(file: DriveFile): boolean {
  if (isFolder(file)) return false;
  const ext = getExtension(file.name);
  if (VIDEO_EXTENSIONS.includes(ext as (typeof VIDEO_EXTENSIONS)[number]))
    return true;
  const mime = file.mimeType.toLowerCase();
  return VIDEO_MIME_PATTERNS.some((p) => mime.startsWith(p));
}

export function isSubtitleFile(file: DriveFile): boolean {
  if (isFolder(file)) return false;
  const ext = getExtension(file.name);
  return SUBTITLE_EXTENSIONS.includes(
    ext as (typeof SUBTITLE_EXTENSIONS)[number],
  );
}

/**
 * Match subtitle files to a given video by basename. Nyrima treats
 * `Movie.mkv` + `Movie.en.srt` + `Movie.vi.ass` as a single playable bundle.
 */
export function matchSubtitlesForVideo(
  video: DriveFile,
  allFiles: DriveFile[],
): DriveFile[] {
  const baseName = stripExtension(video.name).toLowerCase();
  return allFiles.filter(
    (f) =>
      isSubtitleFile(f) &&
      stripExtension(f.name).toLowerCase().startsWith(baseName),
  );
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * Build the direct-media URL for streaming a Drive file. The URL itself is
 * not playable without an Authorization header; pass it through fetch().
 */
export function buildMediaUrl(fileId: string): string {
  return `${API_BASE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
}

/**
 * Build a directly-streamable URL that can be assigned to <video src>.
 *
 * Returns null when no API key is configured (we can't put a Bearer token
 * in a URL, so OAuth-only callers must fall back to fetch+blob).
 *
 * Why this matters for playback:
 *   The previous Phase 1 path fetched the *entire* file as a Blob before
 *   assigning to <video>. For multi-GB movies that blocks playback for
 *   minutes and bloats RAM. With a stream URL, the browser's native HTTP
 *   stack issues Range requests on-demand and starts playing in seconds.
 */
export async function buildPublicStreamUrl(
  fileId: string,
): Promise<string | null> {
  const key = await getApiKey();
  if (!key) return null;
  return appendApiKey(buildMediaUrl(fileId), key);
}

/**
 * Fetch a byte range. Used by the player to feed MSE buffers.
 */
export async function fetchRange(
  fileId: string,
  start: number,
  end: number,
): Promise<{ blob: Blob; total: number }> {
  const res = await authedFetch(buildMediaUrl(fileId), {
    headers: { Range: `bytes=${start}-${end}` },
  });
  const contentRange = res.headers.get("content-range");
  const total = contentRange
    ? Number(contentRange.split("/")[1])
    : (await res.clone().blob()).size;
  return { blob: await res.blob(), total };
}

/**
 * Download a (small) file entirely. For subtitles, posters, etc. Not for video.
 */
export async function downloadFile(fileId: string): Promise<Blob> {
  const res = await authedFetch(buildMediaUrl(fileId));
  return await res.blob();
}

export async function downloadTextFile(fileId: string): Promise<string> {
  const blob = await downloadFile(fileId);
  return await blob.text();
}
