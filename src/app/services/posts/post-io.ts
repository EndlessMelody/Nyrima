/**
 * Read + write `<postFolderId>/post.json`.
 *
 * Mirrors `sharing/index-store.ts`'s read/mutate shape: Drive has no atomic
 * JSON patch, so `savePost` serializes read→write per post folder to keep
 * overlapping autosave calls (e.g. a debounce firing while a previous save
 * is still in flight) from clobbering each other out of order.
 */

import { POST_JSON_FILENAME } from "@shared/constants";
import type { PostDoc } from "@shared/post-types";
import {
  downloadJsonFile,
  findChildByName,
  listFolder,
  updateJsonFile,
  uploadJsonFile,
} from "../drive-api";
import type { RequestOptions } from "../drive/types";
import { sanitizePostDoc } from "./post-doc";
import { ensurePostsFolder } from "./post-folder";

const saveQueues = new Map<string, Promise<unknown>>();

/** Read + sanitize a post document from its folder. Returns null when the
 *  file is missing or fails sanitization (untrusted input boundary — same
 *  posture as `readShareIndex`). */
export async function readPost(
  postFolderId: string,
  reqOpts: RequestOptions = {},
): Promise<PostDoc | null> {
  const file = await findChildByName(postFolderId, POST_JSON_FILENAME, reqOpts);
  if (!file) return null;
  const raw = await downloadJsonFile<unknown>(file.id, reqOpts);
  return sanitizePostDoc(raw);
}

/** Overwrite (or create) `post.json` inside `postFolderId`. Returns the
 *  Drive file id so callers can cache it. Serialized per post folder. */
export function savePost(
  postFolderId: string,
  doc: PostDoc,
  reqOpts: RequestOptions = {},
): Promise<{ fileId: string; isNew: boolean }> {
  return enqueueSave(postFolderId, async () => {
    const existing = await findChildByName(
      postFolderId,
      POST_JSON_FILENAME,
      reqOpts,
    );
    const next: PostDoc = { ...doc, updatedAt: new Date().toISOString() };
    if (existing) {
      const file = await updateJsonFile(existing.id, next, reqOpts);
      return { fileId: file.id, isNew: false };
    }
    const file = await uploadJsonFile(
      postFolderId,
      POST_JSON_FILENAME,
      next,
      reqOpts,
    );
    return { fileId: file.id, isNew: true };
  });
}

/** List the author's own post folders (drafts + published), newest Drive
 *  folder first. Callers that need the full document should follow up with
 *  `readPost(folder.id)` per entry — this call is just folder enumeration,
 *  cheap enough for a "My Posts" list without a manifest round-trip. */
export async function listMyPostFolders(
  reqOpts: RequestOptions = {},
): Promise<{ id: string; name: string }[]> {
  const postsFolderId = await ensurePostsFolder(reqOpts);
  const { files } = await listFolder(
    postsFolderId,
    { orderBy: "createdTime desc", pageSize: 100 },
    reqOpts,
  );
  return files.map((f) => ({ id: f.id, name: f.name }));
}

function enqueueSave<T>(
  postFolderId: string,
  task: () => Promise<T>,
): Promise<T> {
  const prev = saveQueues.get(postFolderId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  const queued = next.finally(() => {
    if (saveQueues.get(postFolderId) === queued) {
      saveQueues.delete(postFolderId);
    }
  });
  saveQueues.set(postFolderId, queued);
  return next;
}
