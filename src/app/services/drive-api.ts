/**
 * Thin wrapper over the Google Drive v3 REST API.
 *
 * We intentionally avoid the official `googleapis` JS client to keep the
 * bundle small and the surface area auditable. Every request flows through
 * `authedFetch` (auth + queue + retry/backoff) and is de-duplicated by op
 * key (see drive/dedup.ts) so concurrent callers share a single underlying
 * Drive call.
 *
 * Docs: https://developers.google.com/drive/api/v3/reference
 */

import { authedFetch, tryGetAccessToken } from "./auth";
import { getApiKey, appendApiKey } from "./api-key";
import { inflight } from "./drive/dedup";
import type { RequestOptions } from "./drive/types";
import type { DriveFile } from "@shared/types";
import {
  VIDEO_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  VIDEO_MIME_PATTERNS,
  REQUIRED_FOLDER_NAME,
} from "@shared/constants";

const API_BASE = "https://www.googleapis.com/drive/v3";

const DEFAULT_FILE_FIELDS = [
  "id",
  "name",
  "mimeType",
  "size",
  "modifiedTime",
  "md5Checksum",
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

export function getFile(
  fileId: string,
  fields = DEFAULT_FILE_FIELDS,
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const key = `file:metadata:${fileId}:${fields}`;
  return inflight(key, async () => {
    const url = `${API_BASE}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
    const res = await authedFetch(
      url,
      { signal: reqOpts.signal },
      { kind: "metadata", priority: reqOpts.priority ?? "high", signal: reqOpts.signal },
    );
    return (await res.json()) as DriveFile;
  });
}

export function listFolder(
  folderId: string,
  opts: ListOptions = {},
  reqOpts: RequestOptions = {},
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

  // Dedup key: same folder + same page = same request. We deliberately
  // include the page token so paginated calls don't collide.
  const key = `folder:list:${folderId}:${opts.pageToken ?? ""}:${opts.q ?? ""}:${opts.orderBy ?? ""}`;
  return inflight(key, async () => {
    const res = await authedFetch(
      `${API_BASE}/files?${params}`,
      { signal: reqOpts.signal },
      { kind: "metadata", priority: reqOpts.priority ?? "high", signal: reqOpts.signal },
    );
    return (await res.json()) as ListResult;
  });
}

/**
 * List every page of a folder. Use cautiously for very large libraries.
 */
export async function listFolderAll(
  folderId: string,
  reqOpts: RequestOptions = {},
): Promise<DriveFile[]> {
  const all: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listFolder(folderId, { pageToken }, reqOpts);
    all.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all;
}

// ---------------------------------------------------------------------------
// Nyrima root validation
// ---------------------------------------------------------------------------

export interface NyrimaRootProbe {
  ok: boolean;
  actualName: string;
  isFolder: boolean;
}

/**
 * Verify that the given Drive folder ID is named "Nyrima" (case-insensitive
 * exact match) and is actually a folder. Single source of truth for the
 * extension's "must live under Nyrima" constraint.
 *
 * Throws DriveAccessError (via authedFetch) if the folder is unreachable —
 * callers should let that propagate so the same access-error UI surfaces.
 */
export async function validateNyrimaRoot(
  folderId: string,
  reqOpts: RequestOptions = {},
): Promise<NyrimaRootProbe> {
  const file = await getFile(folderId, "id,name,mimeType", reqOpts);
  const isF = file.mimeType === "application/vnd.google-apps.folder";
  const ok =
    isF &&
    file.name.trim().toLowerCase() === REQUIRED_FOLDER_NAME.toLowerCase();
  return { ok, actualName: file.name, isFolder: isF };
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
 * Preference order:
 *   1. **OAuth via DNR** — when a live OAuth token is available, return the
 *      bare media URL. The background service worker installs a
 *      declarativeNetRequest rule that stamps `Authorization: Bearer` onto
 *      these requests, so the browser can issue native Range requests on
 *      demand and start playback in seconds. Bandwidth is billed against the
 *      user's personal Drive quota, not the throttled public-key quota.
 *   2. **API key** — for "Anyone with the link" folders without OAuth, fall
 *      back to the `?key=...` URL. Same native-Range fast path, but only
 *      works for public files.
 *   3. Neither — return null. The caller falls through to a blob/MSE path.
 *
 * Why we don't use `?access_token=` in the URL: Drive rejects it for many
 * file/account combos (silent 403), and once <video> fails there's no clean
 * recovery. DNR header injection sidesteps that entirely.
 */
export async function buildPublicStreamUrl(
  fileId: string,
): Promise<string | null> {
  // OAuth path: DNR will stamp the Authorization header on <video>'s outgoing
  // Range requests. Returning the bare URL avoids the 403 -> blob ricochet
  // that used to force a full-file prefetch for OAuth-only users.
  const token = await tryGetAccessToken(false);
  if (token) {
    return buildMediaUrl(fileId);
  }
  const key = await getApiKey();
  if (key) {
    return appendApiKey(buildMediaUrl(fileId), key);
  }
  return null;
}

/**
 * Fetch a byte range. Used by the player to feed MSE buffers and by the
 * MKV subtitle extractor for the 4 MB header sniff.
 */
export async function fetchRange(
  fileId: string,
  start: number,
  end: number,
  reqOpts: RequestOptions = {},
): Promise<{ blob: Blob; total: number }> {
  const res = await authedFetch(
    buildMediaUrl(fileId),
    {
      headers: { Range: `bytes=${start}-${end}` },
      signal: reqOpts.signal,
    },
    {
      kind: reqOpts.kind ?? "media-range",
      priority: reqOpts.priority ?? "high",
      signal: reqOpts.signal,
    },
  );
  const contentRange = res.headers.get("content-range");
  const total = contentRange
    ? Number(contentRange.split("/")[1])
    : (await res.clone().blob()).size;
  return { blob: await res.blob(), total };
}

/**
 * Download a (small) file entirely. For subtitles, posters, etc. Not for video.
 */
export async function downloadFile(
  fileId: string,
  reqOpts: RequestOptions = {},
): Promise<Blob> {
  const key = `file:download:${fileId}`;
  return inflight(key, async () => {
    const res = await authedFetch(
      buildMediaUrl(fileId),
      { signal: reqOpts.signal },
      {
        kind: reqOpts.kind ?? "subtitle",
        priority: reqOpts.priority ?? "normal",
        signal: reqOpts.signal,
      },
    );
    return await res.blob();
  });
}

export async function downloadTextFile(
  fileId: string,
  reqOpts: RequestOptions = {},
): Promise<string> {
  const blob = await downloadFile(fileId, reqOpts);
  return await blob.text();
}
