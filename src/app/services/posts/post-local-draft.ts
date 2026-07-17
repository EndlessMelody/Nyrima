/**
 * Local-first post drafting. A post is never created on Drive just because
 * `/posts/new` was opened — it lives entirely in `chrome.storage.local`
 * until it's explicitly promoted (`post-local-draft-sync.ts`), either by
 * the author (Publish, or "Save to Drive" from the resume banner) or the
 * first time it genuinely needs Drive storage (an image upload). This is
 * what keeps an idle or abandoned draft from littering `Posts/` with empty
 * folders — the old failure mode behind "Couldn't find that post.".
 *
 * All drafts live under one `STORAGE_KEYS.POSTS_LOCAL_DRAFTS` key (a
 * `localId -> LocalPostDraft` map) rather than one chrome.storage key per
 * draft — there's realistically at most a couple of these alive at once,
 * so a single read/write is simpler than also maintaining an index.
 */

import { STORAGE_KEYS } from "@shared/constants";
import type { PostBlock, PostDoc } from "@shared/post-types";
import { derivePostExcerpt } from "./post-doc";

export interface LocalPostDraft {
  /** Matches `PostDoc.id` — the post keeps the same id whether it's local
   *  or promoted to a real Drive folder. */
  localId: string;
  doc: PostDoc;
  savedAt: string;
}

/** Route-param prefix marking `/posts/edit/:folderId` as a local-only
 *  draft rather than a real Drive folder id — Drive file ids never
 *  contain a hyphen-prefixed literal like this. */
const ROUTE_ID_PREFIX = "local-";

export function isLocalDraftRouteId(routeId: string): boolean {
  return routeId.startsWith(ROUTE_ID_PREFIX);
}

export function toLocalDraftRouteId(localId: string): string {
  return `${ROUTE_ID_PREFIX}${localId}`;
}

export function fromLocalDraftRouteId(routeId: string): string {
  return routeId.slice(ROUTE_ID_PREFIX.length);
}

type DraftMap = Record<string, LocalPostDraft>;

async function readAll(): Promise<DraftMap> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.POSTS_LOCAL_DRAFTS);
  const raw = obj[STORAGE_KEYS.POSTS_LOCAL_DRAFTS];
  return raw && typeof raw === "object" ? (raw as DraftMap) : {};
}

async function writeAll(map: DraftMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.POSTS_LOCAL_DRAFTS]: map });
}

export async function saveLocalDraft(localId: string, doc: PostDoc): Promise<void> {
  const all = await readAll();
  all[localId] = { localId, doc, savedAt: new Date().toISOString() };
  await writeAll(all);
}

export async function readLocalDraft(localId: string): Promise<LocalPostDraft | null> {
  const all = await readAll();
  return all[localId] ?? null;
}

export async function deleteLocalDraft(localId: string): Promise<void> {
  const all = await readAll();
  if (!(localId in all)) return;
  delete all[localId];
  await writeAll(all);
}

/** Newest-first. Used by the Posts feed's "resume draft" banner. */
export async function listLocalDrafts(): Promise<LocalPostDraft[]> {
  const all = await readAll();
  return Object.values(all).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

const NON_TEXT_CONTENT_TYPES = new Set<PostBlock["type"]>([
  "driveImage",
  "driveVideo",
  "driveAudio",
  "animeCard",
  "rating",
]);

/** Whether a draft has anything worth keeping — a title, a caption-worthy
 *  media block, or actual body text. An untouched blank scaffold (the
 *  default single empty paragraph) shouldn't trigger the resume banner or
 *  the beforeunload warning. */
export function postDraftHasContent(doc: PostDoc): boolean {
  if (doc.title.trim().length > 0) return true;
  if (derivePostExcerpt(doc.blocks) !== undefined) return true;
  const hasMediaBlock = (blocks: PostBlock[]): boolean =>
    blocks.some(
      (b) => NON_TEXT_CONTENT_TYPES.has(b.type) || (b.children && hasMediaBlock(b.children)),
    );
  return hasMediaBlock(doc.blocks);
}
