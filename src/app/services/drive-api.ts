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
import { assertDriveId, escapeDriveQueryLiteral } from "@shared/drive-id";

const API_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_API_BASE = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const DEFAULT_FILE_FIELDS = [
  "id",
  "name",
  "mimeType",
  "size",
  "modifiedTime",
  "md5Checksum",
  "thumbnailLink",
  "parents",
  "capabilities(canCopy,canDownload)",
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
  const safeFileId = assertDriveId(fileId, "Drive file ID");
  const key = `file:metadata:${safeFileId}:${fields}`;
  return inflight(key, async () => {
    const url = `${API_BASE}/files/${encodeURIComponent(safeFileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
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
  const safeFolderId = assertDriveId(folderId, "Drive folder ID");
  const parentQuery = `'${escapeDriveQueryLiteral(safeFolderId)}' in parents`;
  const q = [parentQuery, "trashed = false", opts.q]
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
  const key = `folder:list:${safeFolderId}:${opts.pageToken ?? ""}:${opts.q ?? ""}:${opts.orderBy ?? ""}`;
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
 * Verify that the given Drive folder ID resolves to an actual folder. The
 * historical "must be literally named 'Nyrima'" check was dropped on
 * 2026-05-17 — the constraint added friction (users had to rename existing
 * libraries to onboard) without protection. The root-store records whatever
 * name the folder has, and we only complain if the picked id isn't a folder
 * at all. Callers that still want a soft hint can compare `actualName`
 * against `REQUIRED_FOLDER_NAME` themselves.
 *
 * Throws DriveAccessError (via authedFetch) if the folder is unreachable —
 * callers should let that propagate so the same access-error UI surfaces.
 */
export async function validateNyrimaRoot(
  folderId: string,
  reqOpts: RequestOptions = {},
): Promise<NyrimaRootProbe> {
  const safeFolderId = assertDriveId(folderId, "Drive folder ID");
  const file = await getFile(safeFolderId, "id,name,mimeType", reqOpts);
  const isF = file.mimeType === "application/vnd.google-apps.folder";
  return { ok: isF, actualName: file.name, isFolder: isF };
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
  const safeFileId = assertDriveId(fileId, "Drive file ID");
  return `${API_BASE}/files/${encodeURIComponent(safeFileId)}?alt=media&supportsAllDrives=true`;
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
  const safeFileId = assertDriveId(fileId, "Drive file ID");
  const key = `file:download:${safeFileId}`;
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

// ---------------------------------------------------------------------------
// Write helpers (Phase 4 — sharing layer)
//
// All writes go through `authedFetch` so they share the same auth/queue/retry
// pipeline as reads. They REQUIRE the `drive.file` OAuth scope, which is
// added to the BYOK auth flow in src/background/service-worker.ts. Without
// that scope, Drive returns 403 and the call surfaces a DriveAccessError.
//
// Convention: `name` arguments are written verbatim into Drive — these are
// "Shared", "entries", "comments", "index.json", etc. The sharing module
// in src/app/services/sharing/ owns the path conventions.
// ---------------------------------------------------------------------------

/**
 * Look up a child file/folder of `parentId` by exact name. Returns null when
 * no match exists. Useful as a pre-check before `createFolder` so we don't
 * accidentally create duplicates if the user re-runs bootstrap.
 *
 * Drive's q-filter is exact match on the `name` field; trashed files are
 * excluded so a previously-deleted entry doesn't resurface.
 */
export function findChildByName(
  parentId: string,
  name: string,
  reqOpts: RequestOptions = {},
): Promise<DriveFile | null> {
  const safeParentId = assertDriveId(parentId, "Drive parent folder ID");
  const safeName = escapeDriveQueryLiteral(name);
  const q = `'${escapeDriveQueryLiteral(safeParentId)}' in parents and name = '${safeName}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: `files(${DEFAULT_FILE_FIELDS})`,
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const key = `child:by-name:${safeParentId}:${name}`;
  return inflight(key, async () => {
    const res = await authedFetch(
      `${API_BASE}/files?${params}`,
      { signal: reqOpts.signal },
      {
        kind: "metadata",
        priority: reqOpts.priority ?? "normal",
        signal: reqOpts.signal,
      },
    );
    const data = (await res.json()) as { files?: DriveFile[] };
    return data.files?.[0] ?? null;
  });
}

/**
 * Create a new folder inside `parentId`. Returns the created file metadata
 * (with `id`, `name`, etc.). Does NOT check for an existing folder of the
 * same name first — callers that want idempotence should use
 * `findOrCreateChildFolder`.
 */
export async function createFolder(
  parentId: string,
  name: string,
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const safeParentId = assertDriveId(parentId, "Drive parent folder ID");
  const url = `${API_BASE}/files?fields=${encodeURIComponent(DEFAULT_FILE_FIELDS)}&supportsAllDrives=true`;
  const body = JSON.stringify({
    name,
    mimeType: FOLDER_MIME,
    parents: [safeParentId],
  });
  const res = await authedFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: reqOpts.signal,
    },
    {
      kind: "metadata",
      priority: reqOpts.priority ?? "normal",
      signal: reqOpts.signal,
    },
  );
  return (await res.json()) as DriveFile;
}

/**
 * Server-side copy of an accessible Drive file into `parentId`.
 *
 * This is the core of the share-import flow: Drive performs the copy inside
 * Google's backend, so the browser does not download the source bytes and
 * re-upload them. The caller still needs read access to the source and write
 * access to the destination, and owner-level copy restrictions still apply.
 */
export async function copyFileToFolder(
  fileId: string,
  opts: { parentId: string; name?: string },
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const safeFileId = assertDriveId(fileId, "Drive file ID");
  const safeParentId = assertDriveId(opts.parentId, "Drive parent folder ID");
  const url =
    `${API_BASE}/files/${encodeURIComponent(safeFileId)}/copy` +
    `?fields=${encodeURIComponent(DEFAULT_FILE_FIELDS)}&supportsAllDrives=true`;
  const res = await authedFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(opts.name ? { name: opts.name } : {}),
        parents: [safeParentId],
      }),
      signal: reqOpts.signal,
    },
    {
      kind: reqOpts.kind ?? "metadata",
      priority: reqOpts.priority ?? "normal",
      signal: reqOpts.signal,
    },
  );
  return (await res.json()) as DriveFile;
}

/**
 * Idempotent folder bootstrap: look up `name` inside `parentId`, create if
 * missing. The check + create is wrapped in `inflight` so a burst of parallel
 * calls (e.g., share-folder bootstrap racing with another sharing surface on
 * cold start) doesn't create duplicates.
 */
export function findOrCreateChildFolder(
  parentId: string,
  name: string,
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const safeParentId = assertDriveId(parentId, "Drive parent folder ID");
  const key = `folder:ensure:${safeParentId}:${name}`;
  return inflight(key, async () => {
    const existing = await findChildByName(safeParentId, name, reqOpts);
    if (existing && existing.mimeType === FOLDER_MIME) return existing;
    return createFolder(safeParentId, name, reqOpts);
  });
}

/**
 * Multipart upload of a JSON file. Returns the created file metadata.
 *
 * Drive's multipart format wraps the metadata + content in a single boundary-
 * delimited request body. We use it (rather than the simpler `uploadType=media`)
 * so we can set the parent folder and name in the same call — `media` requires
 * a separate metadata PATCH afterwards.
 */
export async function uploadJsonFile(
  parentId: string,
  name: string,
  data: unknown,
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const safeParentId = assertDriveId(parentId, "Drive parent folder ID");
  const boundary = `nyrima-${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name,
    parents: [safeParentId],
    mimeType: "application/json",
  };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;
  const url = `${UPLOAD_API_BASE}/files?uploadType=multipart&fields=${encodeURIComponent(DEFAULT_FILE_FIELDS)}&supportsAllDrives=true`;
  const res = await authedFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
      signal: reqOpts.signal,
    },
    {
      kind: reqOpts.kind ?? "metadata",
      priority: reqOpts.priority ?? "normal",
      signal: reqOpts.signal,
    },
  );
  return (await res.json()) as DriveFile;
}

/**
 * Overwrite the contents of an existing file with a fresh JSON payload.
 * Uses Drive's simple `uploadType=media` PATCH — name/parents stay as-is,
 * only the body is replaced.
 */
export async function updateJsonFile(
  fileId: string,
  data: unknown,
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const safeFileId = assertDriveId(fileId, "Drive file ID");
  const url = `${UPLOAD_API_BASE}/files/${encodeURIComponent(safeFileId)}?uploadType=media&fields=${encodeURIComponent(DEFAULT_FILE_FIELDS)}&supportsAllDrives=true`;
  const res = await authedFetch(
    url,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(data),
      signal: reqOpts.signal,
    },
    {
      kind: reqOpts.kind ?? "metadata",
      priority: reqOpts.priority ?? "normal",
      signal: reqOpts.signal,
    },
  );
  return (await res.json()) as DriveFile;
}

/**
 * Trash a file by id (Drive `files.delete` actually moves to trash for
 * standard items). Kept as a general Drive helper for future sharing cleanup
 * tasks and any app-created files that need to be removed.
 *
 * 204 No Content on success; the call is idempotent against an already-gone
 * id (404 swallowed) so a retry after a partial unshare doesn't error out.
 */
export async function deleteFile(
  fileId: string,
  reqOpts: RequestOptions = {},
): Promise<void> {
  const safeFileId = assertDriveId(fileId, "Drive file ID");
  const url = `${API_BASE}/files/${encodeURIComponent(safeFileId)}?supportsAllDrives=true`;
  try {
    await authedFetch(
      url,
      { method: "DELETE", signal: reqOpts.signal },
      {
        kind: reqOpts.kind ?? "metadata",
        priority: reqOpts.priority ?? "normal",
        signal: reqOpts.signal,
      },
    );
  } catch (e) {
    // Re-issuing the unshare against an entry whose file is already gone
    // should be a no-op, not a hard error.
    const msg = e instanceof Error ? e.message : String(e);
    if (/\b404\b/.test(msg)) return;
    throw e;
  }
}

/**
 * Multipart upload of a raw-text file (used for the comments JSONL stream).
 * Same multipart envelope as `uploadJsonFile`, but the inner Content-Type
 * is configurable so Drive's preview shows JSONL as plain text.
 */
export async function uploadTextFile(
  parentId: string,
  name: string,
  text: string,
  mime: string = "text/plain",
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const safeParentId = assertDriveId(parentId, "Drive parent folder ID");
  const boundary = `nyrima-${Math.random().toString(36).slice(2)}`;
  const metadata = { name, parents: [safeParentId], mimeType: mime };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mime}; charset=UTF-8\r\n\r\n` +
    `${text}\r\n` +
    `--${boundary}--`;
  const url = `${UPLOAD_API_BASE}/files?uploadType=multipart&fields=${encodeURIComponent(DEFAULT_FILE_FIELDS)}&supportsAllDrives=true`;
  const res = await authedFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
      signal: reqOpts.signal,
    },
    {
      kind: reqOpts.kind ?? "metadata",
      priority: reqOpts.priority ?? "normal",
      signal: reqOpts.signal,
    },
  );
  return (await res.json()) as DriveFile;
}

/**
 * Overwrite the contents of an existing text file. Drive lacks a true
 * append primitive, so callers wanting append semantics must
 * download → mutate → updateTextFile in their own layer.
 */
export async function updateTextFile(
  fileId: string,
  text: string,
  mime: string = "text/plain",
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const safeFileId = assertDriveId(fileId, "Drive file ID");
  const url = `${UPLOAD_API_BASE}/files/${encodeURIComponent(safeFileId)}?uploadType=media&fields=${encodeURIComponent(DEFAULT_FILE_FIELDS)}&supportsAllDrives=true`;
  const res = await authedFetch(
    url,
    {
      method: "PATCH",
      headers: { "Content-Type": `${mime}; charset=UTF-8` },
      body: text,
      signal: reqOpts.signal,
    },
    {
      kind: reqOpts.kind ?? "metadata",
      priority: reqOpts.priority ?? "normal",
      signal: reqOpts.signal,
    },
  );
  return (await res.json()) as DriveFile;
}

/**
 * Read + return the text content of a JSON file, parsed. Thin wrapper over
 * downloadTextFile that throws on parse failure with a clearer message.
 */
export async function downloadJsonFile<T = unknown>(
  fileId: string,
  reqOpts: RequestOptions = {},
): Promise<T> {
  const text = await downloadTextFile(fileId, reqOpts);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `downloadJsonFile(${fileId}): invalid JSON — ${(e as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Permissions (Phase 4 — sharing layer)
//
// The Phase 4 publish flow flips the user's `Shared/` folder from private to
// "Anyone with the link → Viewer" so followers can read it. Drive models
// this as a Permission resource with `type: "anyone", role: "reader"`.
// `drive.file` scope is sufficient because the app created the folder.
// ---------------------------------------------------------------------------

interface DrivePermission {
  id: string;
  type: "user" | "group" | "domain" | "anyone";
  role: "owner" | "organizer" | "fileOrganizer" | "writer" | "commenter" | "reader";
  allowFileDiscovery?: boolean;
}

/**
 * Detect whether a folder is currently "Anyone with the link" readable.
 * Lists the file's permissions and looks for the `type: anyone` reader
 * entry. Returns true / false; throws on Drive errors.
 *
 * Cheap: one list call, paginated only if a file has hundreds of perms
 * (rare for personal folders).
 */
export async function getFolderIsPublic(
  fileId: string,
  reqOpts: RequestOptions = {},
): Promise<boolean> {
  const safeFileId = assertDriveId(fileId, "Drive folder ID");
  const url =
    `${API_BASE}/files/${encodeURIComponent(safeFileId)}/permissions` +
    `?fields=permissions(id,type,role,allowFileDiscovery)` +
    `&supportsAllDrives=true`;
  const res = await authedFetch(
    url,
    { signal: reqOpts.signal },
    {
      kind: "metadata",
      priority: reqOpts.priority ?? "normal",
      signal: reqOpts.signal,
    },
  );
  const data = (await res.json()) as { permissions?: DrivePermission[] };
  return (data.permissions ?? []).some(
    (p) => p.type === "anyone" && (p.role === "reader" || p.role === "writer"),
  );
}

/**
 * Flip a folder to "Anyone with the link → Viewer". Idempotent — calling
 * twice is harmless because Drive returns the existing permission.
 *
 * Why `allowFileDiscovery: false`: this is "link-only" sharing, not
 * "indexed by Google Search". The user pasting the URL to a friend is the
 * intended distribution channel; nothing should make the folder
 * publicly searchable.
 */
export async function setFolderPublic(
  fileId: string,
  reqOpts: RequestOptions = {},
): Promise<void> {
  const safeFileId = assertDriveId(fileId, "Drive folder ID");
  const url =
    `${API_BASE}/files/${encodeURIComponent(safeFileId)}/permissions` +
    `?supportsAllDrives=true&sendNotificationEmail=false`;
  await authedFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "anyone",
        role: "reader",
        allowFileDiscovery: false,
      }),
      signal: reqOpts.signal,
    },
    {
      kind: "metadata",
      priority: reqOpts.priority ?? "normal",
      signal: reqOpts.signal,
    },
  );
}

/**
 * Revoke the "Anyone with the link" permission. Looks up the anyone-typed
 * permission id then deletes it. No-op when no such permission exists.
 */
export async function setFolderPrivate(
  fileId: string,
  reqOpts: RequestOptions = {},
): Promise<void> {
  const safeFileId = assertDriveId(fileId, "Drive folder ID");
  const listUrl =
    `${API_BASE}/files/${encodeURIComponent(safeFileId)}/permissions` +
    `?fields=permissions(id,type)&supportsAllDrives=true`;
  const listRes = await authedFetch(
    listUrl,
    { signal: reqOpts.signal },
    {
      kind: "metadata",
      priority: reqOpts.priority ?? "normal",
      signal: reqOpts.signal,
    },
  );
  const data = (await listRes.json()) as { permissions?: DrivePermission[] };
  const anyone = (data.permissions ?? []).find((p) => p.type === "anyone");
  if (!anyone) return;
  const delUrl =
    `${API_BASE}/files/${encodeURIComponent(safeFileId)}/permissions/${encodeURIComponent(anyone.id)}` +
    `?supportsAllDrives=true`;
  await authedFetch(
    delUrl,
    { method: "DELETE", signal: reqOpts.signal },
    {
      kind: "metadata",
      priority: reqOpts.priority ?? "normal",
      signal: reqOpts.signal,
    },
  );
}
