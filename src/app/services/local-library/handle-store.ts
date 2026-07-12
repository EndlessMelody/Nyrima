/**
 * Persists the connected local library's root directory handle.
 *
 * `FileSystemDirectoryHandle` is structured-cloneable in Chromium, so it can
 * be stored directly in IndexedDB. Permission grants are NOT persisted by
 * the browser across sessions for most profiles — `verifyPermission` must be
 * called (and `request: true` only from a user gesture) on every boot.
 */

import { STORES, idbDelete, idbGet, idbPut } from "../drive/idb";

const ROOT_KEY = "root";

export interface LocalLibraryHandleRecord {
  handle: FileSystemDirectoryHandle;
  name: string;
  connectedAt: number;
  lastIndexedAt?: number;
}

export type LocalPermissionState = "granted" | "prompt" | "denied";

/** True when the File System Access API + IndexedDB are both available. */
export function supportsLocalLibrary(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function" &&
    typeof indexedDB !== "undefined"
  );
}

export async function getStoredLocalLibrary(): Promise<LocalLibraryHandleRecord | undefined> {
  return idbGet<LocalLibraryHandleRecord>(STORES.LOCAL_LIBRARY, ROOT_KEY);
}

export async function setStoredLocalLibrary(
  record: LocalLibraryHandleRecord,
): Promise<void> {
  await idbPut(STORES.LOCAL_LIBRARY, ROOT_KEY, record);
}

export async function clearStoredLocalLibrary(): Promise<void> {
  await idbDelete(STORES.LOCAL_LIBRARY, ROOT_KEY);
}

/**
 * Check (and optionally request) read permission on a persisted directory
 * handle. `request: true` calls `requestPermission`, which throws unless
 * invoked synchronously within a user gesture — only set it from a click
 * handler.
 */
export async function verifyLocalLibraryPermission(
  handle: FileSystemDirectoryHandle,
  opts: { request?: boolean } = {},
): Promise<LocalPermissionState> {
  const descriptor = { mode: "read" } as const;
  const queried = await handle.queryPermission(descriptor);
  if (queried === "granted" || !opts.request) return queried;
  return handle.requestPermission(descriptor);
}
