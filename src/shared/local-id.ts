/**
 * Identity scheme for files/folders served from a connected local library
 * (File System Access API), mirroring `drive-id.ts` so the same opaque
 * string can flow through routes, `PlaybackPosition.fileId`, and recent
 * folders without either side knowing about the other's source.
 *
 * Ids are reversible: `local-<base64url(relativePath)>`. Path-based identity
 * means progress survives re-encodes/replacements (same name = same id) and
 * resolving a file is a pure decode + directory-handle walk — no separate
 * per-file handle registry needed.
 */

export const LOCAL_ID_PREFIX = "local-";

/** Folder id for the connected library's root directory. */
export const LOCAL_ROOT_FOLDER_ID = "local-root";

export function isLocalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(LOCAL_ID_PREFIX) &&
    value.length > LOCAL_ID_PREFIX.length
  );
}

/** Normalize a relative path: forward slashes, no leading/trailing slashes. */
function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function utf8ToBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUtf8(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Build the file id for a path relative to the connected library root. */
export function toLocalFileId(relativePath: string): string {
  return LOCAL_ID_PREFIX + utf8ToBase64Url(normalizeRelativePath(relativePath));
}

/** Build the folder id for a path relative to the connected library root.
 *  An empty/root path returns `LOCAL_ROOT_FOLDER_ID`. */
export function toLocalFolderId(relativeDirPath: string): string {
  const normalized = normalizeRelativePath(relativeDirPath);
  if (!normalized) return LOCAL_ROOT_FOLDER_ID;
  return LOCAL_ID_PREFIX + utf8ToBase64Url(normalized);
}

/** Decode a local file/folder id back to its relative path (root = ""), or
 *  `null` if `id` is not a valid local id. */
export function parseLocalId(id: string): string | null {
  if (id === LOCAL_ROOT_FOLDER_ID) return "";
  if (!isLocalId(id)) return null;
  try {
    return normalizeRelativePath(base64UrlToUtf8(id.slice(LOCAL_ID_PREFIX.length)));
  } catch {
    return null;
  }
}
