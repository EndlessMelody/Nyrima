/**
 * Zustand store for the Posts feature.
 *
 * Owns two things:
 *   - `myPosts`   — the author's own post folders under `Posts/`, each with
 *                   its full `PostDoc` read in (title/visibility/updatedAt
 *                   for the "My Posts" tab). Not persisted to
 *                   chrome.storage — cheap to re-list from the author's own
 *                   Drive on each visit, and always reflects Drive as the
 *                   source of truth rather than a stale local cache.
 *   - `feedItems` — flattened, newest-first announcements from every
 *                   followed user's `Shared/posts.json`. Cached in
 *                   chrome.storage (mirrors `social-store`'s inbox cache) so
 *                   reloads keep the last good feed while a fresh sync runs.
 *
 * Deliberately does NOT own the follow list — that's `useSocialStore`'s
 * `followedUsers`, reused as-is via `useSocialStore.getState()` so following
 * someone once surfaces both their shares and their posts.
 *
 * Sync model: best-effort pull, same shape as `social-store`'s
 * `syncInbox()` — bounded-concurrency worker pool over Drive reads,
 * per-follow errors recorded without blanking previously-synced rows.
 *
 * Unread tracking is deliberately out of scope for v1 (see the plan's
 * v1.1 bullet) — `feedItems` has no `isUnread` field yet.
 */

import { create } from "zustand";
import type { FollowedUser, ShareAuthor } from "@shared/types";
import { STORAGE_KEYS } from "@shared/constants";
import type { PostAnnouncement, PostDoc, PostsManifest } from "@shared/post-types";
import {
  deletePost,
  listMyPostFolders,
  publishPost,
  readPost,
  readPostsManifest,
  unpublishPost,
  type PublishedVisibility,
} from "../services/posts";
import { useSocialStore } from "./social-store";

export interface MyPostSummary {
  folderId: string;
  doc: PostDoc;
}

export interface PostFeedItem {
  announcement: PostAnnouncement;
  author: ShareAuthor;
  /** The followed user's `Shared/` folder id (for "view their shelf"
   *  links) — NOT the post's own folder id, which is
   *  `announcement.folderId` and is what `/posts/view/:folderId` uses. */
  sourceFolderId: string;
}

/** Per-follow sync state, same shape as `social-store`'s `FollowSyncState`,
 *  so a paused or errored pull is visible rather than silent. */
export interface PostSyncState {
  status: "idle" | "syncing" | "ok" | "error";
  error?: string;
  pulledCount?: number;
}

interface PostsFeedCache {
  v: 1;
  items: PostFeedItem[];
  lastSyncedAt: number | null;
}

interface PostsState {
  myPosts: MyPostSummary[];
  myPostsLoaded: boolean;
  myPostsLoading: boolean;
  myPostsError: string | null;

  feedItems: PostFeedItem[];
  feedLoaded: boolean;
  syncing: boolean;
  syncError: string | null;
  syncStates: Record<string, PostSyncState>;
  lastSyncedAt: number | null;

  /** Hydrate `myPosts` by listing the author's `Posts/` folders and reading
   *  each `post.json`. Cheap no-op on repeat calls unless `force`. */
  loadMyPosts: (opts?: { force?: boolean }) => Promise<void>;

  /** Hydrate `feedItems` from the local cache only — instant paint before
   *  a `syncFeed()` refresh, mirrors `social-store`'s `loadFollows`. */
  loadFeed: () => Promise<void>;
  /** Pull every followed user's `Shared/posts.json` and rebuild
   *  `feedItems`. */
  syncFeed: () => Promise<void>;

  publish: (
    postFolderId: string,
    doc: PostDoc,
    visibility: PublishedVisibility,
  ) => Promise<PostDoc>;
  unpublish: (postFolderId: string, doc: PostDoc) => Promise<PostDoc>;
  remove: (postFolderId: string, doc: PostDoc) => Promise<void>;
}

const MAX_CONCURRENT_PULLS = 4;

export const usePostsStore = create<PostsState>((set, get) => ({
  myPosts: [],
  myPostsLoaded: false,
  myPostsLoading: false,
  myPostsError: null,

  feedItems: [],
  feedLoaded: false,
  syncing: false,
  syncError: null,
  syncStates: {},
  lastSyncedAt: null,

  loadMyPosts: async (opts) => {
    if (get().myPostsLoaded && !opts?.force) return;
    if (get().myPostsLoading) return;
    set({ myPostsLoading: true, myPostsError: null });
    try {
      const folders = await listMyPostFolders();
      const results: MyPostSummary[] = [];
      const queue = [...folders];
      async function worker() {
        while (queue.length > 0) {
          const folder = queue.shift();
          if (!folder) return;
          const doc = await readPost(folder.id).catch(() => null);
          if (doc) results.push({ folderId: folder.id, doc });
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENT_PULLS, folders.length) }, worker),
      );
      results.sort((a, b) => (a.doc.updatedAt < b.doc.updatedAt ? 1 : -1));
      set({ myPosts: results, myPostsLoaded: true, myPostsLoading: false });
    } catch (e) {
      set({
        myPostsLoading: false,
        myPostsError:
          e instanceof Error ? e.message : "Couldn't load your posts.",
      });
    }
  },

  loadFeed: async () => {
    if (get().feedLoaded) return;
    const obj = await chrome.storage.local.get(STORAGE_KEYS.POSTS_FEED_CACHE);
    const cached = parseFeedCache(obj[STORAGE_KEYS.POSTS_FEED_CACHE]);
    set({
      feedItems: cached?.items ?? [],
      feedLoaded: true,
      lastSyncedAt: cached?.lastSyncedAt ?? null,
    });
  },

  syncFeed: async () => {
    if (get().syncing) return;
    const social = useSocialStore.getState();
    if (!social.followsLoaded) await social.loadFollows();
    const follows = useSocialStore.getState().followedUsers;

    if (follows.length === 0) {
      const lastSyncedAt = Date.now();
      set({
        feedItems: [],
        feedLoaded: true,
        syncing: false,
        syncError: null,
        syncStates: {},
        lastSyncedAt,
      });
      await persistFeed([], lastSyncedAt);
      return;
    }

    set({
      syncing: true,
      syncError: null,
      feedLoaded: true,
      syncStates: Object.fromEntries(
        follows.map((f) => [f.sharedFolderId, { status: "syncing" as const }]),
      ),
    });

    const pulled: Array<{
      follow: FollowedUser;
      manifest: PostsManifest | null;
      error?: string;
    }> = [];
    const queue = [...follows];
    async function worker() {
      while (queue.length > 0) {
        const f = queue.shift();
        if (!f) return;
        try {
          const manifest = await readPostsManifest(f.sharedFolderId);
          pulled.push({ follow: f, manifest });
        } catch (e) {
          pulled.push({
            follow: f,
            manifest: null,
            error: e instanceof Error ? e.message : "Pull failed",
          });
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_PULLS, follows.length) }, worker),
    );

    const items: PostFeedItem[] = [];
    const states: Record<string, PostSyncState> = {};
    for (const { follow, manifest, error } of pulled) {
      if (error || !manifest) {
        states[follow.sharedFolderId] = { status: "error", error };
        // Keep this follow's previously-synced rows visible — an offline
        // blip should mark the source stale, not blank their shelf.
        items.push(
          ...get().feedItems.filter(
            (i) => i.sourceFolderId === follow.sharedFolderId,
          ),
        );
        continue;
      }
      states[follow.sharedFolderId] = {
        status: "ok",
        pulledCount: manifest.posts.length,
      };
      for (const announcement of manifest.posts) {
        items.push({
          announcement,
          author: manifest.owner,
          sourceFolderId: follow.sharedFolderId,
        });
      }
    }

    items.sort((a, b) =>
      a.announcement.publishedAt < b.announcement.publishedAt ? 1 : -1,
    );

    const lastSyncedAt = Date.now();
    set({
      feedItems: items,
      syncing: false,
      syncStates: states,
      lastSyncedAt,
    });
    await persistFeed(items, lastSyncedAt);
  },

  publish: async (postFolderId, doc, visibility) => {
    const next = await publishPost(postFolderId, doc, visibility);
    set({ myPosts: upsertMyPost(get().myPosts, postFolderId, next) });
    return next;
  },

  unpublish: async (postFolderId, doc) => {
    const next = await unpublishPost(postFolderId, doc);
    set({ myPosts: upsertMyPost(get().myPosts, postFolderId, next) });
    return next;
  },

  remove: async (postFolderId, doc) => {
    await deletePost(postFolderId, doc);
    set({ myPosts: get().myPosts.filter((p) => p.folderId !== postFolderId) });
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function upsertMyPost(
  list: MyPostSummary[],
  folderId: string,
  doc: PostDoc,
): MyPostSummary[] {
  const next = list.filter((p) => p.folderId !== folderId);
  next.unshift({ folderId, doc });
  return next;
}

async function persistFeed(
  items: PostFeedItem[],
  lastSyncedAt: number | null,
): Promise<void> {
  const cache: PostsFeedCache = { v: 1, items, lastSyncedAt };
  await chrome.storage.local.set({ [STORAGE_KEYS.POSTS_FEED_CACHE]: cache });
}

function parseFeedCache(raw: unknown): PostsFeedCache | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as { v?: unknown }).v !== 1 ||
    !Array.isArray((raw as { items?: unknown }).items)
  ) {
    return null;
  }
  const cache = raw as Partial<PostsFeedCache>;
  const items = (cache.items ?? []).filter(isPostFeedItem);
  return {
    v: 1,
    items,
    lastSyncedAt:
      typeof cache.lastSyncedAt === "number" ? cache.lastSyncedAt : null,
  };
}

function isPostFeedItem(value: unknown): value is PostFeedItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PostFeedItem>;
  return (
    !!item.announcement &&
    typeof item.announcement.id === "string" &&
    item.announcement.v === 1 &&
    !!item.author &&
    typeof item.author.handle === "string" &&
    typeof item.sourceFolderId === "string"
  );
}
