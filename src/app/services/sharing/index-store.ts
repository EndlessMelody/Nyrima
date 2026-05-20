/**
 * Read + write `Shared/index.json` — the manifest of share entries.
 *
 * Under schema v=2, the full ShareEntry payloads are inlined here. There
 * is no longer a separate `entries/` subfolder of per-share JSON files —
 * one Drive read yields the whole feed for a follower.
 *
 * Reads:
 *   - `readShareIndex` returns null for missing files OR for legacy v=1
 *     manifests. The next share re-seeds a fresh v=2 manifest.
 *
 * Writes:
 *   - Drive has no atomic JSON patch, so callers that mutate the manifest
 *     should use `mutateShareIndex()`. It serializes read → mutate → write
 *     in this extension context so two local share/unshare actions don't
 *     overwrite one another. Cross-device edits can still race because Drive
 *     is the only backend.
 *
 * Path: `<sharedFolderId>/index.json`
 */

import {
  MAX_SHARE_INDEX_ENTRIES,
  SHARED_INDEX_FILENAME,
} from "@shared/constants";
import type { ShareEntry, ShareIndex } from "@shared/types";
import {
  downloadJsonFile,
  findChildByName,
  updateJsonFile,
  uploadJsonFile,
} from "../drive-api";
import type { RequestOptions } from "../drive/types";

/** Current on-disk schema version. Anything below this is treated as
 *  absent (`readShareIndex` returns null) — the inline-entries refactor
 *  is not back-compat with v=1 indexes, which carried only slim refs to
 *  separate entry files that no longer get written. */
const SHARE_INDEX_SCHEMA_VERSION = 2 as const;
const mutationQueues = new Map<string, Promise<unknown>>();

/**
 * Fetch the index manifest from a user's `Shared/` folder. Returns null
 * when the file doesn't exist OR holds a legacy v=1 payload. Caller
 * treats both cases the same: seed a fresh v=2 manifest on next write.
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
  const raw = await downloadJsonFile<{ v?: number }>(file.id, reqOpts);
  if (!raw || raw.v !== SHARE_INDEX_SCHEMA_VERSION) return null;
  return raw as ShareIndex;
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
  // Soft cap — drop oldest beyond the cap. Inline entries means there's no
  // separate-file archive; once an entry rolls off it's gone.
  const slim: ShareIndex = {
    ...index,
    v: SHARE_INDEX_SCHEMA_VERSION,
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
 * Serialize a read-modify-write of one user's manifest. The mutator receives
 * the latest readable index (or null for a missing/legacy manifest) and must
 * return the complete next v=2 index to persist.
 */
export function mutateShareIndex(
  sharedFolderId: string,
  mutate: (current: ShareIndex | null) => ShareIndex | Promise<ShareIndex>,
  reqOpts: RequestOptions = {},
): Promise<ShareIndex> {
  return enqueueIndexMutation(sharedFolderId, async () => {
    const current = await readShareIndex(sharedFolderId, reqOpts);
    const next = await mutate(current);
    await writeShareIndex(sharedFolderId, next, reqOpts);
    return next;
  });
}

/**
 * Prepend a fresh entry to the index. Returns the updated index. Pure helper
 * — the caller is responsible for persisting via `writeShareIndex`.
 */
export function prependIndexEntry(
  index: ShareIndex,
  entry: ShareEntry,
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

/**
 * Generate a stable random id for a new share entry. Uses
 * `crypto.randomUUID()` when available (Chrome 92+), falling back to a
 * timestamp + random suffix. The id only needs to be unique within the
 * user's own index — collisions across users are namespaced by author.
 */
export function generateShareId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function enqueueIndexMutation<T>(
  sharedFolderId: string,
  task: () => Promise<T>,
): Promise<T> {
  const prev = mutationQueues.get(sharedFolderId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  const queued = next.finally(() => {
    if (mutationQueues.get(sharedFolderId) === queued) {
      mutationQueues.delete(sharedFolderId);
    }
  });
  mutationQueues.set(sharedFolderId, queued);
  return next;
}
