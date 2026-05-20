/**
 * Shared parser for Google Drive folder identifiers.
 *
 * Lives under `src/shared/` because three contexts need it:
 *   - background service worker (context-menu URL → folder id)
 *   - content script (drive.google.com FAB → folder id from location.href)
 *   - app page (user-pasted URL → folder id from <Input>)
 *
 * CRITICAL: keep this file side-effect-free. Anything pulled in here will be
 * bundled into all three contexts, and content scripts in particular do NOT
 * have chrome.runtime.onInstalled / chrome.identity / chrome.contextMenus,
 * so introducing a top-level listener registration here would silently break
 * the content script (FAB never appears).
 *
 * Supported input formats:
 *   - https://drive.google.com/drive/folders/<ID>
 *   - https://drive.google.com/drive/u/N/folders/<ID>(?usp=sharing)
 *   - https://drive.google.com/open?id=<ID>
 *   - bare folder ID (the 28-44 char base64-ish string)
 */

import { isDriveId } from "./drive-id";

export function extractFolderId(input: string): string | null {
  if (!input) return null;

  const folderMatch = input.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (folderMatch && isDriveId(folderMatch[1])) return folderMatch[1];

  const idParamMatch = input.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (idParamMatch && isDriveId(idParamMatch[1])) return idParamMatch[1];

  const bareIdMatch = input.match(/^([A-Za-z0-9_-]{10,})$/);
  if (bareIdMatch && isDriveId(bareIdMatch[1])) return bareIdMatch[1];

  return null;
}
