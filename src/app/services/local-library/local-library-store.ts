/**
 * Zustand store for the connected local library: drives the
 * `/library/local-folder` panel and the "Local" filter merge on the
 * Movies/Light Novel/Music library pages.
 *
 * `needs-permission` is the *normal* boot state for a persisted directory
 * handle — most browsers don't remember the read grant across sessions.
 * `requestPermission` only succeeds inside a user gesture, so `reconnect()`
 * must be called from a click handler.
 */

import { create } from "zustand";
import {
  type LocalLibraryHandleRecord,
  clearStoredLocalLibrary,
  getStoredLocalLibrary,
  setStoredLocalLibrary,
  supportsLocalLibrary,
  verifyLocalLibraryPermission,
} from "./handle-store";
import { localLibrary } from "./local-source";
import { scanLocalRoot } from "./local-index";
import { buildVirtualDirectoryHandle, virtualRootName } from "./virtual-directory";
import type { MediaFolderScanResult } from "../media-library-index";
import type { MediaLibraryKind } from "../media-library-source";

export type LocalLibraryStatus =
  | "unsupported"
  | "disconnected"
  | "needs-permission"
  | "indexing"
  | "ready"
  | "error";

interface LocalLibraryState {
  status: LocalLibraryStatus;
  rootName: string;
  scans: Partial<Record<MediaLibraryKind, MediaFolderScanResult>>;
  error: string | null;
  /** True when the connected root came from a `webkitdirectory` `FileList`
   *  (Firefox/Safari fallback) rather than a persisted directory handle —
   *  the handle lives only in memory for this tab and is never written to
   *  IDB (it isn't structured-cloneable). */
  isVirtualRoot: boolean;

  /** Silent boot check: re-validates a persisted handle without prompting. */
  load: () => Promise<void>;
  /** User gesture: opens the directory picker and indexes the result. */
  connect: () => Promise<void>;
  /** User gesture: re-requests permission on the persisted handle. */
  reconnect: () => Promise<void>;
  /** Firefox/Safari fallback: index a `webkitdirectory` picker result for
   *  this session only — re-pick on every reload. */
  connectVirtualDirectory: (fileList: FileList) => Promise<void>;
  rescan: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useLocalLibraryStore = create<LocalLibraryState>((set, get) => ({
  status: supportsLocalLibrary() ? "disconnected" : "unsupported",
  rootName: "",
  scans: {},
  error: null,
  isVirtualRoot: false,

  load: async () => {
    if (!supportsLocalLibrary()) {
      set({ status: "unsupported" });
      return;
    }
    const stored = await getStoredLocalLibrary();
    if (!stored) {
      localLibrary.setRoot(null);
      set({ status: "disconnected", rootName: "", scans: {}, error: null });
      return;
    }
    const permission = await verifyLocalLibraryPermission(stored.handle);
    if (permission !== "granted") {
      localLibrary.setRoot(null);
      set({ status: "needs-permission", rootName: stored.name, scans: {}, error: null });
      return;
    }
    await indexAndStore(stored, set);
  },

  connect: async () => {
    if (!supportsLocalLibrary()) {
      set({ status: "unsupported" });
      return;
    }
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({ mode: "read" });
    } catch {
      return; // user dismissed the picker
    }
    const record: LocalLibraryHandleRecord = {
      handle,
      name: handle.name,
      connectedAt: Date.now(),
    };
    await indexAndStore(record, set);
  },

  connectVirtualDirectory: async (fileList: FileList) => {
    if (fileList.length === 0) return;
    const handle = buildVirtualDirectoryHandle(fileList);
    const name = virtualRootName(fileList);
    localLibrary.setRoot(handle, name);
    set({ isVirtualRoot: true });
    await runScan(handle, name, set);
  },

  reconnect: async () => {
    const stored = await getStoredLocalLibrary();
    if (!stored) {
      set({ status: "disconnected" });
      return;
    }
    const permission = await verifyLocalLibraryPermission(stored.handle, { request: true });
    if (permission !== "granted") {
      set({ status: "needs-permission" });
      return;
    }
    await indexAndStore(stored, set);
  },

  rescan: async () => {
    if (get().isVirtualRoot) {
      await runScan(localLibrary.getRootHandle(), get().rootName, set);
      return;
    }
    const stored = await getStoredLocalLibrary();
    if (!stored) {
      await get().load();
      return;
    }
    await indexAndStore(stored, set);
  },

  disconnect: async () => {
    await clearStoredLocalLibrary();
    localLibrary.setRoot(null);
    set({
      status: supportsLocalLibrary() ? "disconnected" : "unsupported",
      rootName: "",
      scans: {},
      error: null,
      isVirtualRoot: false,
    });
  },
}));

/** Scan `handle` and publish the result, leaving `rootName` untouched (the
 *  caller already set it via `setRoot`/initial state). Shared by
 *  `indexAndStore` (persisted handles) and `connectVirtualDirectory`/`rescan`
 *  (in-memory `webkitdirectory` trees). */
async function runScan(
  handle: FileSystemDirectoryHandle,
  rootName: string,
  set: (partial: Partial<LocalLibraryState>) => void,
): Promise<Partial<Record<MediaLibraryKind, MediaFolderScanResult>> | null> {
  set({ status: "indexing", rootName, error: null });
  try {
    const scans = await scanLocalRoot(handle, rootName);
    set({ status: "ready", scans, error: null });
    return scans;
  } catch (e) {
    set({ status: "error", error: e instanceof Error ? e.message : "Failed to read local library." });
    return null;
  }
}

async function indexAndStore(
  record: LocalLibraryHandleRecord,
  set: (partial: Partial<LocalLibraryState>) => void,
): Promise<void> {
  localLibrary.setRoot(record.handle, record.name);
  set({ isVirtualRoot: false });
  const scans = await runScan(record.handle, record.name, set);
  if (scans) await setStoredLocalLibrary({ ...record, lastIndexedAt: Date.now() });
}
