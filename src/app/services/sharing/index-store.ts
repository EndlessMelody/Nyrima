/**
 * Read + write `Shared/index.json` — the manifest of share entries.
 *
 * Why this layer:
 *   - The full ShareEntry JSON files live in `Shared/entries/` (one per
 *     share). A recipient that wants to browse a user's shares shouldn't
 *     have to fetch every entry — they pull the slim `index.json` first
 *     and only download entry files they actually open.
 *   - Writes are read-modify-write: load current index → mutate → upload.
 *     There's no Drive primitive for atomic patches of JSON files, so
 *     concurrent edits from two tabs would race. Single-user is the only
 *     supported case today; multi-tab is a Phase 4.x problem.
 *
 * Path: `<sharedFolderId>/index.json`
 */

import {
  MAX_SHARE_INDEX_ENTRIES,
  SHARED_INDEX_FILENAME,
} from "@shared/constants";
import type { ShareIndex, ShareIndexEntry } from "@shared/types";
import {
  downloadJsonFile,
  findChildByName,
  updateJsonFile,
  uploadJsonFile,
} from "../drive-api";
import type { RequestOptions } from "../drive/types";

/**
 * Fetch the index manifest from a user's `Shared/` folder. Returns null
 * when the file doesn't exist yet (fresh user who has never shared).
 *
 * The `sharedFolderId` can be the user's own folder (for editing) or a
 * followed user's folder (for browsing) — the call is read-only either way.
 */
export async function readShareIndex(
  sharedFolderId: string,
  reqOpts: RequestOptions = {},
): Promise<ShareIndex | null> {
  const file = await findChildByName(
    sharedFolderId,
    SHARED_INDEX_FILENAME,
    reqOpts,
  );
  if (!file) return null;
  return downloadJsonFile<ShareIndex>(file.id, reqOpts);
}

/**
 * Overwrite (or create) the index manifest at the root of the user's own
 * `Shared/` folder. Returns the Drive file id of the index so callers can
 * cache it for subsequent updates without re-resolving.
 *
 * Returns `{ fileId, isNew }` so callers can log "created index" vs
 * "updated index" if useful.
 */
export async function writeShareIndex(
  sharedFolderId: string,
  index: ShareIndex,
  reqOpts: RequestOptions = {},
): Promise<{ fileId: string; isNew: boolean }> {
  const existing = await findChildByName(
    sharedFolderId,
    SHARED_INDEX_FILENAME,
    reqOpts,
  );
  // Soft cap — keep the index slim. Older entries stay on Drive under
  // entries/ but stop appearing in the manifest.
  const slim: ShareIndex = {
    ...index,
    entries: index.entries.slice(0, MAX_SHARE_INDEX_ENTRIES),
    updatedAt: new Date().toISOString(),
  };
  if (existing) {
    const file = await updateJsonFile(existing.id, slim, reqOpts);
    return { fileId: file.id, isNew: false };
  }
  const file = await uploadJsonFile(
    sharedFolderId,
    SHARED_INDEX_FILENAME,
    slim,
    reqOpts,
  );
  return { fileId: file.id, isNew: true };
}

/**
 * Prepend a fresh entry to the index. Returns the updated index. Pure helper
 * — the caller is responsible for persisting via `writeShareIndex`.
 */
export function prependIndexEntry(
  index: ShareIndex,
  entry: ShareIndexEntry,
): ShareIndex {
  return {
    ...index,
    entries: [entry, ...index.entries.filter((e) => e.id !== entry.id)],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Remove an entry from the index by id. Returns the updated index. Pure
 * helper — the caller is responsible for persisting via `writeShareIndex`.
 * Does NOT delete the underlying entry JSON file in `Shared/entries/`;
 * the entry-store owns that cleanup.
 */
export function removeIndexEntry(
  index: ShareIndex,
  entryId: string,
): ShareIndex {
  return {
    ...index,
    entries: index.entries.filter((e) => e.id !== entryId),
    updatedAt: new Date().toISOString(),
  };
}
