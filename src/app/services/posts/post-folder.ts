/**
 * Bootstrap + locate the user's `Posts/` folder inside their Nyrima root,
 * and manage the per-post folder tree underneath it.
 *
 * Layout (sibling of the Phase 4 `Shared/` tree):
 *   Posts/
 *     <postId>/
 *       post.json
 *       assets/            (created lazily on first media upload)
 *
 * Each post folder is the atomic permission unit — publishing a post flips
 * exactly that folder public via `setFolderPublic`, so the manifest and
 * every asset copied into `assets/` become readable in one call. `Posts/`
 * itself stays private forever; only individual post folders are ever
 * published.
 */

import { POSTS_FOLDER_NAME, POST_ASSETS_FOLDER_NAME, STORAGE_KEYS } from "@shared/constants";
import { createFolder, findOrCreateChildFolder } from "../drive-api";
import { getNyrimaRoot } from "../storage";
import type { RequestOptions } from "../drive/types";
import type { DriveFile } from "@shared/types";

let inflightEnsure: Promise<string> | null = null;

/**
 * Resolve (and create on first run) the user's `Posts/` folder. Throws when
 * no Nyrima root is paired. Cached in chrome.storage so the first call per
 * session is the only one that touches Drive.
 */
export async function ensurePostsFolder(
  reqOpts: RequestOptions = {},
): Promise<string> {
  if (inflightEnsure) return inflightEnsure;
  inflightEnsure = (async () => {
    try {
      const cached = await readCache();
      if (cached) return cached;
      const root = await getNyrimaRoot();
      if (!root) {
        throw new Error(
          "Pair your Nyrima root folder before creating posts.",
        );
      }
      const postsFolder = await findOrCreateChildFolder(
        root.id,
        POSTS_FOLDER_NAME,
        reqOpts,
      );
      await writeCache(postsFolder.id);
      return postsFolder.id;
    } finally {
      inflightEnsure = null;
    }
  })();
  return inflightEnsure;
}

/** Create a new, uniquely-named post folder under `Posts/`. Does not check
 *  for an existing folder of the same name — `postId` is a fresh UUID, so
 *  collisions aren't a concern the way they are for user-chosen names. */
export async function createPostFolder(
  postId: string,
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const postsFolderId = await ensurePostsFolder(reqOpts);
  return createFolder(postsFolderId, postId, reqOpts);
}

/** Idempotently resolve the `assets/` subfolder of a post folder, creating
 *  it on first media upload. */
export function ensureAssetsFolder(
  postFolderId: string,
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  return findOrCreateChildFolder(postFolderId, POST_ASSETS_FOLDER_NAME, reqOpts);
}

/** Wipe the cached `Posts/` folder id. Called by account-reset when the
 *  user re-pairs their Nyrima root. */
export async function clearPostsFolderCache(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.POSTS_FOLDER_ID);
}

// ---------------------------------------------------------------------------
// chrome.storage glue
// ---------------------------------------------------------------------------

async function readCache(): Promise<string | null> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.POSTS_FOLDER_ID);
  const id = obj[STORAGE_KEYS.POSTS_FOLDER_ID] as string | undefined;
  return id ?? null;
}

async function writeCache(id: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.POSTS_FOLDER_ID]: id });
}
