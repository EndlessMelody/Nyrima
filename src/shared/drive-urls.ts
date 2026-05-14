/**
 * Canonical Drive web-UI URL builders. Symmetric with parse-folder-url.ts:
 * the parser extracts ids from these shapes, these helpers reconstruct them.
 *
 * Lives in `src/shared/` so any context (app page, content script, background)
 * can use them without dragging in chrome.* APIs.
 */

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}
