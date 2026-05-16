/**
 * Zustand store for the Nyrima root folder + its immediate library children.
 *
 * Why a dedicated store: the library shelf in the lobby is no longer a list
 * of "every folder you've opened" — it's a derived view of the Nyrima
 * folder's immediate child folders. That requires:
 *   1. A persisted root reference (id + verified name).
 *   2. Re-validation on every load (folder may have been renamed/deleted).
 *   3. A cached scan of children, refreshed via SWR like the rest of the app.
 *
 * The store exposes:
 *   - `root` — the verified Nyrima folder (null until onboarding completes).
 *   - `libraries` — immediate child folders of the root.
 *   - `rootError` — set when validation fails (wrong name, missing, …).
 *   - `setRoot(folderId)` — onboarding entry-point: validates, persists,
 *      wipes any prior account's data, then triggers an initial scan.
 *   - `refresh()` — re-validate + re-scan. Surfaces stale libraries on cache
 *      hit; refreshes in the background.
 *
 * Drive API calls go through the SWR-cached metadata-service so revisiting
 * the lobby costs zero requests on a warm cache.
 */

import { create } from "zustand";
import {
  validateNyrimaRoot,
  isFolder,
  type NyrimaRootProbe,
} from "../services/drive-api";
import {
  listFolder as cachedListFolder,
  invalidateFolder,
} from "../services/drive/metadata-service";
import {
  getNyrimaRoot,
  setNyrimaRoot,
  clearNyrimaRoot,
} from "../services/storage";
import { wipeAccountData } from "../services/account-reset";
import { DriveAccessError, type DriveAccessReason } from "../services/errors";
import { REQUIRED_FOLDER_NAME } from "@shared/constants";
import type { DriveFile, NyrimaRoot } from "@shared/types";

export type RootErrorKind = "wrong-name" | "not-folder" | "drive-access";

export interface RootError {
  kind: RootErrorKind;
  message: string;
  /** Underlying Drive access reason, when applicable. */
  driveReason?: DriveAccessReason;
  /** When kind === "wrong-name", the actual name we saw. */
  actualName?: string;
}

interface NyrimaRootState {
  root: NyrimaRoot | null;
  /** Immediate child folders of the root. The lobby's library shelf binds
   *  directly to this list. */
  libraries: DriveFile[];
  /** True while the initial load (root read + first child scan) is running. */
  loading: boolean;
  /** True when the rendered libraries came from cache and a refresh is in
   *  flight. Surface this for a subtle "syncing…" hint in the UI. */
  refreshing: boolean;
  /** Set when validation or scanning failed. */
  rootError: RootError | null;

  load: () => Promise<void>;
  setRoot: (folderId: string) => Promise<SetRootOutcome>;
  refresh: () => Promise<void>;
  /** Tear down the persisted root. Used by "Change Nyrima folder". */
  reset: () => Promise<void>;
}

export type SetRootOutcome =
  | { ok: true; root: NyrimaRoot }
  | { ok: false; error: RootError };

export const useNyrimaRootStore = create<NyrimaRootState>((set, get) => ({
  root: null,
  libraries: [],
  loading: false,
  refreshing: false,
  rootError: null,

  load: async () => {
    set({ loading: true, rootError: null });
    const stored = await getNyrimaRoot();
    if (!stored) {
      set({ root: null, libraries: [], loading: false });
      return;
    }
    set({ root: stored });
    await runScan(stored.id, set);
    set({ loading: false });
  },

  setRoot: async (folderId: string): Promise<SetRootOutcome> => {
    set({ loading: true, rootError: null });
    let probe: NyrimaRootProbe;
    try {
      probe = await validateNyrimaRoot(folderId);
    } catch (e) {
      const err = toDriveError(e);
      set({ loading: false, rootError: err });
      return { ok: false, error: err };
    }

    if (!probe.isFolder) {
      const err: RootError = {
        kind: "not-folder",
        message: "That link points to a file, not a folder.",
      };
      set({ loading: false, rootError: err });
      return { ok: false, error: err };
    }
    if (!probe.ok) {
      const err: RootError = {
        kind: "wrong-name",
        message: `That folder is named "${probe.actualName}", not "${REQUIRED_FOLDER_NAME}". Rename it (or pick the right folder).`,
        actualName: probe.actualName,
      };
      set({ loading: false, rootError: err });
      return { ok: false, error: err };
    }

    // Fresh root → wipe everything tied to whatever account/api-key the
    // previous root belonged to. Settings and saved keys survive.
    await wipeAccountData();

    const root: NyrimaRoot = {
      id: folderId,
      name: probe.actualName,
      verifiedAt: Date.now(),
    };
    await setNyrimaRoot(root);
    set({ root, libraries: [] });

    await runScan(folderId, set);
    set({ loading: false });
    return { ok: true, root };
  },

  refresh: async () => {
    const { root } = get();
    if (!root) return;
    set({ refreshing: true, rootError: null });
    // Re-validate first so a renamed/deleted root surfaces a clean error
    // instead of an empty library shelf.
    try {
      const probe = await validateNyrimaRoot(root.id);
      if (!probe.isFolder || !probe.ok) {
        set({
          refreshing: false,
          libraries: [],
          rootError: !probe.isFolder
            ? { kind: "not-folder", message: "Root is no longer a folder." }
            : {
                kind: "wrong-name",
                message: `Root folder is now named "${probe.actualName}", not "${REQUIRED_FOLDER_NAME}". Rename it on Drive or pick a different folder.`,
                actualName: probe.actualName,
              },
        });
        return;
      }
      // Update the cached name if the user renamed (still "Nyrima" but
      // different casing/whitespace).
      if (probe.actualName !== root.name) {
        const next: NyrimaRoot = { ...root, name: probe.actualName, verifiedAt: Date.now() };
        await setNyrimaRoot(next);
        set({ root: next });
      }
    } catch (e) {
      set({ refreshing: false, rootError: toDriveError(e) });
      return;
    }

    await invalidateFolder(root.id);
    await runScan(root.id, set, { forceRefresh: true });
    set({ refreshing: false });
  },

  reset: async () => {
    await clearNyrimaRoot();
    set({ root: null, libraries: [], rootError: null });
  },
}));

// Listen for storage edits from other contexts (popup, background) so the
// app reacts to a root swap without a manual reload.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const change = changes["dc.nyrimaRoot"];
    if (!change) return;
    const next = (change.newValue as NyrimaRoot | undefined) ?? null;
    useNyrimaRootStore.setState({ root: next, libraries: next ? [] : [] });
    if (next) void useNyrimaRootStore.getState().refresh();
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ScanOpts {
  forceRefresh?: boolean;
}

async function runScan(
  folderId: string,
  set: (partial: Partial<NyrimaRootState>) => void,
  opts: ScanOpts = {},
): Promise<void> {
  try {
    const result = await cachedListFolder(folderId, {
      forceRefresh: opts.forceRefresh,
    });
    const libraries = result.files
      .filter(isFolder)
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    set({ libraries, refreshing: result.revalidating });
  } catch (e) {
    set({ libraries: [], refreshing: false, rootError: toDriveError(e) });
  }
}

function toDriveError(e: unknown): RootError {
  if (e instanceof DriveAccessError) {
    return {
      kind: "drive-access",
      message: e.message,
      driveReason: e.reason,
    };
  }
  return {
    kind: "drive-access",
    message: e instanceof Error ? e.message : "Couldn't reach Drive.",
  };
}
