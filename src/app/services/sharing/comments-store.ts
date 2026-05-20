/**
 * Comments are written to a single flat JSONL stream per user:
 * `Shared/comments.jsonl`. Every comment the user has ever posted appears
 * as one line, regardless of which share or which owner it targets.
 *
 * Why one file (not one per shareId, the original P4.3 sketch):
 *   - Aggregator pulls one Drive file per follower instead of N. Going from
 *     `O(followers × shares-commented-on)` reads to `O(followers)` is the
 *     whole reason this works on Drive at all.
 *   - The owner doesn't need a listing of "which shareIds did this person
 *     comment on" before fetching — they just read the stream and filter.
 *
 * Filter axis: a share owner aggregating threads on *their* shares filters
 * lines where `sharedFolderId === their-own-folder-id`. That lookup is
 * a substring match on the JSONL text — fast enough that we do it in JS
 * after `JSON.parse` rather than pre-indexing.
 *
 * Append model: Drive has no true append, so writers do
 * download → parse → push → upload. `appendComment()` serializes that
 * read-modify-write locally per `Shared/` folder so two comment dialogs in
 * this extension context don't lose a line. Cross-device edits can still
 * race because Drive is the only backend.
 *
 * IDs: caller-side via `generateShareId()` from index-store. We don't need
 * a distinct id namespace for comments — the same UUID generator is fine.
 */

import {
  SHARED_COMMENTS_FILENAME,
  SHARED_JSONL_MIME,
  MAX_SHARE_COMMENT_CHARS,
} from "@shared/constants";
import type { ShareComment } from "@shared/types";
import {
  downloadTextFile,
  findChildByName,
  updateTextFile,
  uploadTextFile,
} from "../drive-api";
import type { RequestOptions } from "../drive/types";

const appendQueues = new Map<string, Promise<unknown>>();

/**
 * Append a comment to the *caller's own* `Shared/comments.jsonl`.
 *
 * `mySharedFolderId` is the writer's Drive folder id — not the share
 * owner's. (The owner's folder id is embedded in `comment.sharedFolderId`.)
 */
export async function appendComment(
  mySharedFolderId: string,
  comment: ShareComment,
  reqOpts: RequestOptions = {},
): Promise<void> {
  if (comment.text.length > MAX_SHARE_COMMENT_CHARS) {
    throw new Error(
      `Comment is too long (${comment.text.length}/${MAX_SHARE_COMMENT_CHARS} chars).`,
    );
  }
  return enqueueAppend(mySharedFolderId, async () => {
    await appendCommentUnqueued(mySharedFolderId, comment, reqOpts);
  });
}

async function appendCommentUnqueued(
  mySharedFolderId: string,
  comment: ShareComment,
  reqOpts: RequestOptions,
): Promise<void> {
  const existing = await findChildByName(
    mySharedFolderId,
    SHARED_COMMENTS_FILENAME,
    reqOpts,
  );
  const newLine = JSON.stringify(comment) + "\n";
  if (!existing) {
    await uploadTextFile(
      mySharedFolderId,
      SHARED_COMMENTS_FILENAME,
      newLine,
      SHARED_JSONL_MIME,
      reqOpts,
    );
    return;
  }
  const current = await downloadTextFile(existing.id, reqOpts);
  // Ensure exactly one trailing newline between the previous block and the
  // new line so JSONL parsers don't trip on a missing separator.
  const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  await updateTextFile(
    existing.id,
    current + sep + newLine,
    SHARED_JSONL_MIME,
    reqOpts,
  );
}

function enqueueAppend<T>(
  mySharedFolderId: string,
  task: () => Promise<T>,
): Promise<T> {
  const prev = appendQueues.get(mySharedFolderId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  const queued = next.finally(() => {
    if (appendQueues.get(mySharedFolderId) === queued) {
      appendQueues.delete(mySharedFolderId);
    }
  });
  appendQueues.set(mySharedFolderId, queued);
  return next;
}

/**
 * Fetch + parse the comments stream from any user's `Shared/` folder.
 * Returns `[]` when no comments file exists yet (fresh user) or it parses
 * to nothing. Malformed lines are skipped silently so a single corrupt
 * record doesn't kill the whole feed.
 */
export async function readComments(
  sharedFolderId: string,
  reqOpts: RequestOptions = {},
): Promise<ShareComment[]> {
  const existing = await findChildByName(
    sharedFolderId,
    SHARED_COMMENTS_FILENAME,
    reqOpts,
  );
  if (!existing) return [];
  const text = await downloadTextFile(existing.id, reqOpts);
  return parseCommentsJsonl(text);
}

/** Parse a JSONL blob into `ShareComment` records, skipping invalid lines
 *  and entries that don't look like a v=1 comment. Exported for tests. */
export function parseCommentsJsonl(text: string): ShareComment[] {
  const out: ShareComment[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Partial<ShareComment>;
      if (
        parsed &&
        parsed.v === 1 &&
        typeof parsed.id === "string" &&
        typeof parsed.shareId === "string" &&
        typeof parsed.sharedFolderId === "string" &&
        typeof parsed.at === "string" &&
        typeof parsed.text === "string" &&
        parsed.author &&
        typeof parsed.author.handle === "string"
      ) {
        out.push(parsed as ShareComment);
      }
    } catch {
      // skip malformed
    }
  }
  return out;
}

/**
 * Pull comment streams from every supplied follower folder in parallel
 * (bounded concurrency) and concat the results. Failures per-follower are
 * recorded but do NOT abort the whole aggregate — a single offline blip
 * shouldn't blank out everyone else's threads.
 *
 * Filtering by `ownerFolderId` is the caller's job: this just returns
 * everything that came back. Most callers want
 * `result.filter(c => c.sharedFolderId === myFolderId)` so they only see
 * comments targeting their own shares.
 */
export async function aggregateComments(
  sharedFolderIds: string[],
  reqOpts: RequestOptions = {},
): Promise<{
  comments: ShareComment[];
  errors: Array<{ sharedFolderId: string; message: string }>;
}> {
  const MAX_CONCURRENT = 4;
  const queue = [...sharedFolderIds];
  const comments: ShareComment[] = [];
  const errors: Array<{ sharedFolderId: string; message: string }> = [];

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      try {
        const batch = await readComments(id, reqOpts);
        comments.push(...batch);
      } catch (e) {
        errors.push({
          sharedFolderId: id,
          message: e instanceof Error ? e.message : "Read failed",
        });
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT, sharedFolderIds.length) },
      worker,
    ),
  );
  return { comments, errors };
}
