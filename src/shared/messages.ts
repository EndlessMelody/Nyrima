/**
 * Strongly-typed message protocol between background, content, and app.
 *
 * Usage:
 *   chrome.runtime.sendMessage<DcMessage, DcResponse>({ type: "AUTH_GET_TOKEN" })
 */

export type DcMessage =
  | { type: "AUTH_GET_TOKEN"; interactive?: boolean }
  | { type: "AUTH_REVOKE" }
  | { type: "OPEN_APP_FOR_FOLDER"; folderId: string; folderName?: string }
  | { type: "GET_RECENT_FOLDERS" }
  | { type: "PING" };

export type DcResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok<T>(data: T): DcResponse<T> {
  return { ok: true, data };
}

export function err(error: unknown): DcResponse<never> {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return { ok: false, error: message };
}
