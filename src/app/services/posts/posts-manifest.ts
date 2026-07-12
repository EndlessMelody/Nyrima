/**
 * Read + write `Shared/posts.json` — the follow-feed manifest of post
 * announcements.
 *
 * A new sibling file of `Shared/index.json`, never merged into it: the
 * index sanitizer hard-rejects any `v` it doesn't recognise, so grafting
 * posts onto that schema would break existing share-index readers. One
 * Drive read of this file yields a follower's whole posts feed for that
 * author; the full `post.json` is fetched lazily only when a reader opens
 * a specific post (see post-io.ts `readPost`).
 *
 * Same read-modify-write caveat as `index-store.ts`: Drive has no atomic
 * JSON patch, so mutation goes through `mutatePostsManifest`, which
 * serializes same-tab writers. Cross-device edits can still race — Drive is
 * the only backend.
 *
 * Path: `<sharedFolderId>/posts.json`
 */

import {
  MAX_POSTS_MANIFEST_ENTRIES,
  MAX_POST_EXCERPT_CHARS,
  MAX_POST_TAG_CHARS,
  MAX_POST_TAGS,
  MAX_POST_TITLE_CHARS,
  POSTS_MANIFEST_FILENAME,
  SHARE_HANDLE_PATTERN,
} from "@shared/constants";
import { isDriveId } from "@shared/drive-id";
import type { PostAnnouncement, PostsManifest } from "@shared/post-types";
import { POSTS_MANIFEST_SCHEMA_VERSION } from "@shared/post-types";
import type { ShareAuthor } from "@shared/types";
import {
  downloadJsonFile,
  findChildByName,
  updateJsonFile,
  uploadJsonFile,
} from "../drive-api";
import type { RequestOptions } from "../drive/types";

const MAX_ID_CHARS = 160;
const MAX_AUTHOR_NAME_CHARS = 80;
const MAX_AVATAR_URL_CHARS = 2048;
const MAX_POSTER_URL_CHARS = 2048;
const mutationQueues = new Map<string, Promise<unknown>>();

/**
 * Fetch the posts manifest from a user's `Shared/` folder. Returns null
 * when the file doesn't exist or fails sanitization. The `sharedFolderId`
 * can be the user's own folder (for editing) or a followed user's folder
 * (for the feed sync) — read-only either way.
 */
export async function readPostsManifest(
  sharedFolderId: string,
  reqOpts: RequestOptions = {},
): Promise<PostsManifest | null> {
  const file = await findChildByName(
    sharedFolderId,
    POSTS_MANIFEST_FILENAME,
    reqOpts,
  );
  if (!file) return null;
  const raw = await downloadJsonFile<unknown>(file.id, reqOpts);
  return sanitizePostsManifest(raw);
}

/**
 * Shape public `Shared/posts.json` bytes before feed-sync callers trust
 * them. A followed user's Drive folder is an untrusted input boundary:
 * keep the manifest readable when individual announcements are malformed,
 * but reject a root that cannot identify its owner or entry list.
 */
export function sanitizePostsManifest(raw: unknown): PostsManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<PostsManifest>;
  if (
    value.v !== POSTS_MANIFEST_SCHEMA_VERSION ||
    !Array.isArray(value.posts) ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    return null;
  }

  const owner = sanitizeAuthor(value.owner);
  if (!owner) return null;

  const posts: PostAnnouncement[] = [];
  const seenIds = new Set<string>();
  for (const entry of value.posts) {
    if (posts.length >= MAX_POSTS_MANIFEST_ENTRIES) break;
    const sanitized = sanitizeAnnouncement(entry);
    if (!sanitized || seenIds.has(sanitized.id)) continue;
    seenIds.add(sanitized.id);
    posts.push(sanitized);
  }

  return {
    v: POSTS_MANIFEST_SCHEMA_VERSION,
    owner,
    updatedAt: value.updatedAt,
    posts,
  };
}

/**
 * Overwrite (or create) `posts.json` at the root of the user's own
 * `Shared/` folder. Returns `{ fileId, isNew }` so callers can cache the
 * id for subsequent updates without re-resolving.
 */
export async function writePostsManifest(
  sharedFolderId: string,
  manifest: PostsManifest,
  reqOpts: RequestOptions = {},
): Promise<{ fileId: string; isNew: boolean }> {
  const existing = await findChildByName(
    sharedFolderId,
    POSTS_MANIFEST_FILENAME,
    reqOpts,
  );
  const slim: PostsManifest = {
    ...manifest,
    v: POSTS_MANIFEST_SCHEMA_VERSION,
    posts: manifest.posts.slice(0, MAX_POSTS_MANIFEST_ENTRIES),
    updatedAt: new Date().toISOString(),
  };
  if (existing) {
    const file = await updateJsonFile(existing.id, slim, reqOpts);
    return { fileId: file.id, isNew: false };
  }
  const file = await uploadJsonFile(
    sharedFolderId,
    POSTS_MANIFEST_FILENAME,
    slim,
    reqOpts,
  );
  return { fileId: file.id, isNew: true };
}

/**
 * Serialize a read-modify-write of one user's posts manifest. The mutator
 * receives the latest readable manifest (or null for missing/malformed)
 * and must return the complete next manifest to persist.
 */
export function mutatePostsManifest(
  sharedFolderId: string,
  mutate: (
    current: PostsManifest | null,
  ) => PostsManifest | Promise<PostsManifest>,
  reqOpts: RequestOptions = {},
): Promise<PostsManifest> {
  return enqueueManifestMutation(sharedFolderId, async () => {
    const current = await readPostsManifest(sharedFolderId, reqOpts);
    const next = await mutate(current);
    await writePostsManifest(sharedFolderId, next, reqOpts);
    return next;
  });
}

/** Prepend a fresh announcement (or replace an existing one with the same
 *  id, keeping it newest-first). Pure — caller persists via
 *  `writePostsManifest` / `mutatePostsManifest`. */
export function prependAnnouncement(
  manifest: PostsManifest,
  announcement: PostAnnouncement,
): PostsManifest {
  return {
    ...manifest,
    posts: [
      announcement,
      ...manifest.posts.filter((p) => p.id !== announcement.id),
    ],
    updatedAt: new Date().toISOString(),
  };
}

/** Remove an announcement by id (unpublish/delete). Pure helper. */
export function removeAnnouncement(
  manifest: PostsManifest,
  postId: string,
): PostsManifest {
  return {
    ...manifest,
    posts: manifest.posts.filter((p) => p.id !== postId),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------

function sanitizeAnnouncement(value: unknown): PostAnnouncement | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<PostAnnouncement>;
  if (
    entry.v !== 1 ||
    !isNonEmptyText(entry.id, MAX_ID_CHARS) ||
    !isDriveId(entry.folderId) ||
    !isNonEmptyText(entry.title, MAX_POST_TITLE_CHARS) ||
    (entry.visibility !== "friends" && entry.visibility !== "public") ||
    !isIsoTimestamp(entry.publishedAt) ||
    !isIsoTimestamp(entry.updatedAt)
  ) {
    return null;
  }

  return {
    v: 1,
    id: entry.id,
    folderId: entry.folderId,
    title: entry.title.slice(0, MAX_POST_TITLE_CHARS),
    excerpt: sanitizeText(entry.excerpt, MAX_POST_EXCERPT_CHARS),
    posterUrl: sanitizeHttpsUrl(entry.posterUrl, MAX_POSTER_URL_CHARS),
    visibility: entry.visibility,
    publishedAt: entry.publishedAt,
    updatedAt: entry.updatedAt,
    tags: sanitizeTags(entry.tags),
  };
}

function sanitizeAuthor(value: unknown): ShareAuthor | null {
  if (!value || typeof value !== "object") return null;
  const author = value as Partial<ShareAuthor>;
  if (
    typeof author.handle !== "string" ||
    !SHARE_HANDLE_PATTERN.test(author.handle)
  ) {
    return null;
  }
  return {
    handle: author.handle,
    name: sanitizeText(author.name, MAX_AUTHOR_NAME_CHARS),
    avatarUrl: sanitizeHttpsUrl(author.avatarUrl, MAX_AVATAR_URL_CHARS),
  };
}

function sanitizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (tags.length >= MAX_POST_TAGS) break;
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase().slice(0, MAX_POST_TAG_CHARS);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags.length > 0 ? tags : undefined;
}

function sanitizeText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxChars);
}

function sanitizeHttpsUrl(
  value: unknown,
  maxChars: number,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxChars
  ) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isNonEmptyText(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxChars
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function enqueueManifestMutation<T>(
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
