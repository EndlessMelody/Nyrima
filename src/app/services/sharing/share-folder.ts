/**
 * Bootstrap + locate the user's `Shared/` folder inside their Nyrima root.
 *
 * The `Shared/` folder is the publishing surface for the Phase 4 social
 * layer. Under schema v=2 the layout is flat:
 *   - `index.json`     — manifest of inlined share entries
 *   - `comments.jsonl` — flat stream of all comments the user has ever
 *                        posted (each line targets one shareId via the
 *                        embedded `sharedFolderId` + `shareId` fields)
 *
 * Both files live directly under `Shared/`; there are no subfolders.
 *
 * Lifecycle:
 *   - First call after a fresh Nyrima root pairing: the folder doesn't
 *     exist yet. `ensureShareFolders()` creates it idempotently.
 *   - The root folder id is cached in chrome.storage.local so we don't
 *     pay a Drive list+create roundtrip on every Phase 4 call. The cache
 *     is wiped by account-reset.ts when the user re-pairs the root.
 *   - We do NOT auto-publish the folder ("Anyone with the link → Viewer"
 *     permission). Auto-flipping a folder public without an explicit user
 *     gesture is a privacy footgun. Phase 4.1's share-creation flow
 *     surfaces a confirmation step that flips the permission only after
 *     the user opts in. Until then the folder stays private and Phase 4
 *     writes are local-only.
 *
 * Auth: every call here requires the `drive.file` OAuth scope (added to
 * the BYOK flow in service-worker.ts). Pre-Phase-4 users will see a 403
 * on the first ensure call; the existing DriveAccessError UI ("Connect
 * Drive") re-prompts with the new scope set and the call succeeds on retry.
 */

import { SHARED_FOLDER_NAME, STORAGE_KEYS } from "@shared/constants";
import { findOrCreateChildFolder } from "../drive-api";
import { getNyrimaRoot } from "../storage";
import type { RequestOptions } from "../drive/types";

/** Cached folder ids for the user's `Shared/` tree. The shape was a
 *  record-of-children under Phase 4.0; the inline-entries + flat-comments
 *  refactor collapsed it to just the root folder. */
export interface ShareFolderIds {
  /** Drive folder id of `Shared/`. */
  root: string;
}

let inflightEnsure: Promise<ShareFolderIds> | null = null;

/**
 * Resolve (and create on first run) the user's `Shared/` folder. Throws
 * when no Nyrima root is paired — Phase 4 requires the root because
 * everything lives under it.
 *
 * Returns cached ids on subsequent calls. The cache survives across SW
 * idle restarts via chrome.storage, so the first call per browser session
 * is the only one that touches Drive.
 */
export async function ensureShareFolders(
  reqOpts: RequestOptions = {},
): Promise<ShareFolderIds> {
  if (inflightEnsure) return inflightEnsure;
  inflightEnsure = (async () => {
    try {
      const cached = await readCache();
      if (cached) return cached;
      const root = await getNyrimaRoot();
      if (!root) {
        throw new Error(
          "Pair your Nyrima root folder before using the sharing layer.",
        );
      }
      const sharedFolder = await findOrCreateChildFolder(
        root.id,
        SHARED_FOLDER_NAME,
        reqOpts,
      );
      const ids: ShareFolderIds = { root: sharedFolder.id };
      await writeCache(ids);
      return ids;
    } finally {
      inflightEnsure = null;
    }
  })();
  return inflightEnsure;
}

/**
 * Get cached ids without creating. Returns null when the cache is empty.
 * Useful for "is sharing initialised?" checks without paying the bootstrap
 * cost on cold start.
 */
export async function getCachedShareFolders(): Promise<ShareFolderIds | null> {
  return readCache();
}

/**
 * Wipe the cached folder ids. Called by account-reset.ts when the user
 * re-pairs their Nyrima root, so the next ensure call discovers the
 * fresh folder tree instead of hitting deleted ids.
 */
export async function clearShareFolderCache(): Promise<void> {
  await chrome.storage.local.remove([
    STORAGE_KEYS.SHARED_FOLDER_ID,
    STORAGE_KEYS.SHARED_SUBFOLDER_IDS,
  ]);
}

// ---------------------------------------------------------------------------
// chrome.storage glue
// ---------------------------------------------------------------------------

async function readCache(): Promise<ShareFolderIds | null> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.SHARED_FOLDER_ID);
  const root = obj[STORAGE_KEYS.SHARED_FOLDER_ID] as string | undefined;
  if (!root) return null;
  return { root };
}

async function writeCache(ids: ShareFolderIds): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SHARED_FOLDER_ID]: ids.root });
}
