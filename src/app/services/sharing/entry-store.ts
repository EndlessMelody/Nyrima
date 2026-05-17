/**
 * Read + write individual share entries to `Shared/entries/{id}.json`.
 *
 * One file per share. The id is generated client-side at share time and
 * used as both the filename (`{id}.json`) and the cross-user reference
 * key (recipients route their comments back to it under their own
 * `Shared/comments/{id}.jsonl`).
 *
 * Pairs with index-store.ts: the entry file holds the full ShareEntry
 * payload; the index holds a slim ShareIndexEntry per id so a recipient
 * can list shares without pulling every JSON.
 *
 * Phase 4.0 ships the read/write primitives only — the Share-this-video
 * UX in 4.1 wires them together via a sharing store + the topbar Share
 * button stub.
 */

import type { ShareEntry } from "@shared/types";
import {
  downloadJsonFile,
  findChildByName,
  updateJsonFile,
  uploadJsonFile,
} from "../drive-api";
import type { RequestOptions } from "../drive/types";

/** Filename convention: `{id}.json`. The id is opaque to Drive; we use it
 *  for both the filename and the cross-user comment routing key. */
export function entryFilename(id: string): string {
  return `${id}.json`;
}

/**
 * Create the entry JSON in `Shared/entries/`. Returns the created Drive
 * file (with id) so the caller can stamp the entryFileId into the
 * accompanying ShareIndexEntry.
 *
 * On the rare case that an entry with the same id already exists (e.g.,
 * the share-creation flow retried after a partial failure), we update in
 * place instead of creating a duplicate. The id is supposed to be unique
 * per share but defensive-merge keeps the index referentially intact.
 */
export async function writeShareEntry(
  entriesFolderId: string,
  entry: ShareEntry,
  reqOpts: RequestOptions = {},
): Promise<{ fileId: string; isNew: boolean }> {
  const filename = entryFilename(entry.id);
  const existing = await findChildByName(
    entriesFolderId,
    filename,
    reqOpts,
  );
  if (existing) {
    const file = await updateJsonFile(existing.id, entry, reqOpts);
    return { fileId: file.id, isNew: false };
  }
  const file = await uploadJsonFile(
    entriesFolderId,
    filename,
    entry,
    reqOpts,
  );
  return { fileId: file.id, isNew: true };
}

/** Fetch + parse a single entry by Drive file id. */
export async function readShareEntry(
  fileId: string,
  reqOpts: RequestOptions = {},
): Promise<ShareEntry> {
  return downloadJsonFile<ShareEntry>(fileId, reqOpts);
}

/**
 * Generate a stable random id for a new share entry. Uses
 * `crypto.randomUUID()` when available (Chrome 92+), falling back to a
 * timestamp + random suffix. The format isn't enforced by anything —
 * we just need uniqueness across the user's own shares (collisions
 * across users are namespaced by the author's folder id anyway).
 */
export function generateShareId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
