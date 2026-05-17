/**
 * Cache + manage the `Shared/` folder's "Anyone with the link" state.
 *
 * Drive's permissions API is straightforward but each query costs a roundtrip
 * — and the user's publication state rarely changes (the composer asks once,
 * the user opts in or out, done). Cache the result in chrome.storage so the
 * composer can render "already public" / "still private" without burning a
 * request on every open.
 *
 * Invalidation: any time we call `setSharedPublic` / `setSharedPrivate`, we
 * also update the cache. External edits (the user revoking the permission
 * through Drive's UI) won't propagate until next refresh — Phase 4.x can add
 * a soft re-validate-on-open if it turns out to matter.
 */

import {
  getFolderIsPublic,
  setFolderPublic,
  setFolderPrivate,
} from "../drive-api";
import type { RequestOptions } from "../drive/types";

/** chrome.storage.local key holding the cached state. */
const STORAGE_KEY = "dc.sharedFolderIsPublic";

type CachedState = boolean | null;

let inflightProbe: Promise<boolean> | null = null;

/**
 * Returns the cached public-state if known, else queries Drive.
 *
 * `forceRefresh: true` skips the cache and re-queries — useful when the
 * composer wants to display a "live" status indicator.
 */
export async function isSharedFolderPublic(
  sharedFolderId: string,
  opts: { forceRefresh?: boolean; req?: RequestOptions } = {},
): Promise<boolean> {
  if (!opts.forceRefresh) {
    const cached = await readCache();
    if (cached !== null) return cached;
  }
  if (inflightProbe) return inflightProbe;
  inflightProbe = (async () => {
    try {
      const isPublic = await getFolderIsPublic(sharedFolderId, opts.req);
      await writeCache(isPublic);
      return isPublic;
    } finally {
      inflightProbe = null;
    }
  })();
  return inflightProbe;
}

/** Flip the folder public + update the cache. */
export async function publishSharedFolder(
  sharedFolderId: string,
  reqOpts: RequestOptions = {},
): Promise<void> {
  await setFolderPublic(sharedFolderId, reqOpts);
  await writeCache(true);
}

/** Revoke the public permission + update the cache. */
export async function unpublishSharedFolder(
  sharedFolderId: string,
  reqOpts: RequestOptions = {},
): Promise<void> {
  await setFolderPrivate(sharedFolderId, reqOpts);
  await writeCache(false);
}

/** Drop the cached state. Called by account-reset when the user re-pairs
 *  their Nyrima root (the cached value belongs to the old folder id). */
export async function clearSharedFolderPublicCache(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

// ---------------------------------------------------------------------------

async function readCache(): Promise<CachedState> {
  const obj = await chrome.storage.local.get(STORAGE_KEY);
  const v = obj[STORAGE_KEY];
  if (typeof v === "boolean") return v;
  return null;
}

async function writeCache(value: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: value });
}
