/**
 * Zustand store for the Social hub (Phase 4 UI).
 *
 * Lives alongside (not inside) `sharing-store.ts` so the composer flow stays
 * focused. This store owns the state the hub surfaces care about:
 *
 *   - `followedUsers`  — local list of people the user follows. Persisted in
 *                        chrome.storage.local under FOLLOWED_USERS.
 *   - `inboxItems`     — flattened, newest-first list of share-index entries
 *                        from every followed user, with author + sourceFolderId
 *                        stamped on each row. Recomputed by `syncInbox()`
 *                        and cached so reloads keep the last good feed.
 *   - `unreadCount`    — entries newer than each follow's `lastSeenEntryId`.
 *                        Surfaced as a badge on the topbar Social icon.
 *   - `myIndex`        — the user's own `index.json`, cached for the
 *                        My Shares tab. Refreshed on demand by `loadMyIndex`.
 *
 * Sync model: best-effort pull. `syncInbox()` walks every followed user's
 * `index.json` in parallel (capped at 4 concurrent reads through Drive's
 * queue). Failures are recorded per-follow but do NOT clear the existing
 * cached items — so an offline blip leaves the Inbox readable rather than
 * blank.
 *
 * Read-after-write: every state-mutating action (`follow`, `unfollow`,
 * `unshare`, `markAllRead`) also persists to chrome.storage before resolving,
 * so a popup → fullpage navigation reflects the change immediately.
 */

import { create } from "zustand";
import type {
  DirectoryEntry,
  FollowedUser,
  ShareAuthor,
  ShareComment,
  ShareEntry,
  ShareIndex,
  ShareTarget,
} from "@shared/types";
import { STORAGE_KEYS } from "@shared/constants";
import { extractFolderId } from "@shared/parse-folder-url";
import {
  aggregateComments,
  appendComment,
  fetchDirectory,
  generateShareId,
  importShareTargetToDrive,
  getCachedDirectory,
  mutateShareIndex,
  profileToAuthor,
  readComments,
  readShareIndex,
  removeIndexEntry,
  type DriveImportResult,
} from "../services/sharing";
import { getCachedShareFolders } from "../services/sharing/share-folder";
import { useSharingStore } from "./sharing-store";

/** A row rendered in the Inbox tab — one inlined ShareEntry from a
 *  followed user, with author + source folder stamped so the UI can render
 *  attribution + a "view on Drive" link without re-resolving anything. */
export interface InboxItem {
  /** The inlined entry payload (id, sharedAt, target, title, poster, …). */
  entry: ShareEntry;
  /** Author profile snapshot from the followed user's `ShareIndex.owner`. */
  author: ShareAuthor;
  /** Drive folder id of the author's `Shared/` folder. */
  sourceFolderId: string;
  /** True when this entry is newer than the follow's `lastSeenEntryId`.
   *  Used to drive the unread badge + visual "NEW" pill on the row. */
  isUnread: boolean;
}

interface InboxCache {
  v: 1;
  items: InboxItem[];
  lastSyncedAt: number | null;
}

/** Per-follow sync state surfaced to the People + Inbox tabs so a paused or
 *  errored pull is visible rather than silent. */
export interface FollowSyncState {
  status: "idle" | "syncing" | "ok" | "error";
  error?: string;
  /** Number of entries that arrived in the most recent successful pull. */
  pulledCount?: number;
}

interface SocialState {
  followedUsers: FollowedUser[];
  followsLoaded: boolean;

  inboxItems: InboxItem[];
  unreadCount: number;

  myIndex: ShareIndex | null;
  myIndexLoaded: boolean;
  myIndexLoading: boolean;
  myIndexError: string | null;

  syncing: boolean;
  syncError: string | null;
  syncStates: Record<string, FollowSyncState>;
  lastSyncedAt: number | null;

  /** Curated directory entries from the P4.4 bootstrap registry.
   *  Refreshed by `loadDirectory()` (cached 24h). */
  directoryEntries: DirectoryEntry[];
  directoryLoaded: boolean;
  directoryLoading: boolean;

  /** Comments left on the user's *own* shares, aggregated from every
   *  followed user's `comments.jsonl` and bucketed by `shareId`. Refreshed
   *  by `loadReceivedComments()`. */
  receivedComments: Record<string, ShareComment[]>;
  /** Comments the user has written themselves, sorted newest-first.
   *  Refreshed by `loadMyComments()`. */
  myComments: ShareComment[];
  commentsLoading: boolean;
  commentsError: string | null;
  /** Wall-clock of the last successful comments aggregate. Drives the
   *  "Synced N ago" line on the Activity tab. */
  lastCommentsSyncedAt: number | null;

  // ---- follow management ----
  loadFollows: () => Promise<void>;
  follow: (input: { url: string }) => Promise<FollowedUser>;
  unfollow: (sharedFolderId: string) => Promise<void>;

  // ---- inbox ----
  syncInbox: () => Promise<void>;
  importShareTarget: (input: {
    target: ShareTarget;
    title?: string;
  }) => Promise<DriveImportResult>;
  markAllRead: () => Promise<void>;
  markFollowRead: (sharedFolderId: string) => Promise<void>;

  // ---- my shares ----
  loadMyIndex: (opts?: { force?: boolean }) => Promise<ShareIndex | null>;
  unshare: (entryId: string) => Promise<void>;

// ---- directory ----
  /** Hydrate `directoryEntries` from the cached copy (instant) then refresh
   *  from the network if the TTL has lapsed. Safe to call repeatedly —
   *  the in-store flag dedupes concurrent fetches. */
  loadDirectory: (opts?: { force?: boolean }) => Promise<void>;

  // ---- comments ----
  /** Append a comment to the user's own `comments.jsonl` targeting the
   *  share at `{sharedFolderId, shareId}`. Re-reads the local stream so
   *  `myComments` reflects the new entry on resolve. */
  postComment: (input: {
    sharedFolderId: string;
    shareId: string;
    text: string;
  }) => Promise<ShareComment>;
  /** Refresh `myComments` from the user's own `comments.jsonl`. */
  loadMyComments: (opts?: { force?: boolean }) => Promise<void>;
  /** Walk every followed user's `comments.jsonl`, filter to comments
   *  targeting the user's own shares, group by shareId. */
  loadReceivedComments: () => Promise<void>;
}

const MAX_CONCURRENT_PULLS = 4;

export const useSocialStore = create<SocialState>((set, get) => ({
  followedUsers: [],
  followsLoaded: false,

  inboxItems: [],
  unreadCount: 0,

  myIndex: null,
  myIndexLoaded: false,
  myIndexLoading: false,
  myIndexError: null,

  syncing: false,
  syncError: null,
  syncStates: {},
  lastSyncedAt: null,

  directoryEntries: [],
  directoryLoaded: false,
  directoryLoading: false,

  receivedComments: {},
  myComments: [],
  commentsLoading: false,
  commentsError: null,
  lastCommentsSyncedAt: null,

  loadFollows: async () => {
    if (get().followsLoaded) return;
    const obj = await chrome.storage.local.get([
      STORAGE_KEYS.FOLLOWED_USERS,
      STORAGE_KEYS.SOCIAL_INBOX_CACHE,
    ]);
    const raw = obj[STORAGE_KEYS.FOLLOWED_USERS];
    const followedUsers: FollowedUser[] = Array.isArray(raw)
      ? (raw as FollowedUser[])
      : [];
    const cachedInbox = parseInboxCache(obj[STORAGE_KEYS.SOCIAL_INBOX_CACHE]);
    set({
      followedUsers,
      followsLoaded: true,
      ...(cachedInbox
        ? {
            inboxItems: cachedInbox.items,
            unreadCount: countUnread(cachedInbox.items),
            lastSyncedAt: cachedInbox.lastSyncedAt,
          }
        : {}),
    });
  },

  follow: async ({ url }) => {
    const folderId = extractFolderId(url.trim());
    if (!folderId) {
      throw new Error(
        "That doesn't look like a Drive folder link. Paste the URL of someone's Shared/ folder.",
      );
    }
    const existing = get().followedUsers.find(
      (f) => f.sharedFolderId === folderId,
    );
    if (existing) {
      // Idempotent — re-pull their index but don't dupe.
      const index = await readShareIndex(folderId);
      if (index) {
        const refreshed: FollowedUser = {
          ...existing,
          profile: index.owner,
          lastPulledAt: new Date().toISOString(),
        };
        const next = get().followedUsers.map((f) =>
          f.sharedFolderId === folderId ? refreshed : f,
        );
        set({ followedUsers: next });
        await persistFollows(next);
        return refreshed;
      }
      return existing;
    }
    const index = await readShareIndex(folderId);
    if (!index) {
      throw new Error(
        "Couldn't read that user's Shared folder. Make sure they've published it (Anyone with the link).",
      );
    }
    const now = new Date().toISOString();
    const fresh: FollowedUser = {
      sharedFolderId: folderId,
      profile: index.owner,
      lastPulledAt: now,
      // Mark every existing entry as already-seen on first follow so the
      // user doesn't get spammed with a backlog. The Inbox shows new posts
      // from this user going forward.
      lastSeenEntryId: index.entries[0]?.id,
      followedAt: now,
    };
    const next = [...get().followedUsers, fresh];
    set({ followedUsers: next });
    await persistFollows(next);
    // Recompute inbox to surface the user's most recent entries (all
    // marked read, since lastSeenEntryId = newest).
    await get().syncInbox().catch(() => undefined);
    return fresh;
  },

  unfollow: async (sharedFolderId) => {
    const next = get().followedUsers.filter(
      (f) => f.sharedFolderId !== sharedFolderId,
    );
    set({ followedUsers: next });
    await persistFollows(next);
    // Drop their items from the cached inbox so the UI updates immediately.
    const inbox = get().inboxItems.filter(
      (i) => i.sourceFolderId !== sharedFolderId,
    );
    set({ inboxItems: inbox, unreadCount: countUnread(inbox) });
    await persistInbox(inbox, get().lastSyncedAt);
  },

  syncInbox: async () => {
    if (get().syncing) return;
    if (!get().followsLoaded) await get().loadFollows();
    const follows = get().followedUsers;
    if (follows.length === 0) {
      set({
        inboxItems: [],
        unreadCount: 0,
        syncing: false,
        syncError: null,
        lastSyncedAt: Date.now(),
        syncStates: {},
      });
      await persistInbox([], Date.now());
      return;
    }
    set({
      syncing: true,
      syncError: null,
      syncStates: Object.fromEntries(
        follows.map((f) => [f.sharedFolderId, { status: "syncing" }]),
      ),
    });
    const pulled: Array<{ follow: FollowedUser; index: ShareIndex | null; error?: string }> = [];
    // Simple bounded-concurrency pool. Drive's request queue does its own
    // rate limiting; the limit here just stops a 50-follow account from
    // spawning a single waterfall.
    const queue = [...follows];
    async function worker() {
      while (queue.length > 0) {
        const f = queue.shift();
        if (!f) return;
        try {
          const index = await readShareIndex(f.sharedFolderId);
          pulled.push({ follow: f, index });
        } catch (e) {
          pulled.push({
            follow: f,
            index: null,
            error: e instanceof Error ? e.message : "Pull failed",
          });
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_PULLS, follows.length) }, worker),
    );

    // Flatten into one newest-first list. Each row tags the source folder
    // and author so the UI can render attribution without joins.
    const items: InboxItem[] = [];
    const refreshedFollows: FollowedUser[] = [];
    const states: Record<string, FollowSyncState> = {};
    for (const { follow, index, error } of pulled) {
      if (error || !index) {
        states[follow.sharedFolderId] = { status: "error", error };
        // Keep the existing follow record on error so we don't lose track.
        refreshedFollows.push(follow);
        // Keep the previous rows from this follow visible. An offline blip
        // should mark the source as stale, not blank out their shelf.
        items.push(
          ...get().inboxItems.filter(
            (i) => i.sourceFolderId === follow.sharedFolderId,
          ),
        );
        continue;
      }
      states[follow.sharedFolderId] = {
        status: "ok",
        pulledCount: index.entries.length,
      };
      refreshedFollows.push({
        ...follow,
        profile: index.owner,
        lastPulledAt: new Date().toISOString(),
      });
      for (const entry of index.entries) {
        items.push({
          entry,
          author: index.owner,
          sourceFolderId: follow.sharedFolderId,
          isUnread: isEntryUnread(entry, index.entries, follow.lastSeenEntryId),
        });
      }
    }

    items.sort((a, b) => (a.entry.sharedAt < b.entry.sharedAt ? 1 : -1));

    const lastSyncedAt = Date.now();
    set({
      inboxItems: items,
      unreadCount: countUnread(items),
      followedUsers: refreshedFollows,
      syncing: false,
      syncStates: states,
      lastSyncedAt,
    });
    await persistFollows(refreshedFollows);
    await persistInbox(items, lastSyncedAt);
  },

  markAllRead: async () => {
    const next = get().followedUsers.map((f) => {
      // Newest entry the inbox has seen for this follow becomes the
      // lastSeenEntryId. If nothing has been pulled, leave the field alone.
      const newest = get().inboxItems.find(
        (i) => i.sourceFolderId === f.sharedFolderId,
      );
      return newest ? { ...f, lastSeenEntryId: newest.entry.id } : f;
    });
    const inbox = get().inboxItems.map((i) => ({ ...i, isUnread: false }));
    set({
      followedUsers: next,
      inboxItems: inbox,
      unreadCount: 0,
    });
    await persistFollows(next);
    await persistInbox(inbox, get().lastSyncedAt);
  },

  importShareTarget: async ({ target, title }) => {
    return await importShareTargetToDrive(target, title, {
      priority: "normal",
    });
  },

  markFollowRead: async (sharedFolderId) => {
    const newest = get().inboxItems.find(
      (i) => i.sourceFolderId === sharedFolderId,
    );
    if (!newest) return;
    const next = get().followedUsers.map((f) =>
      f.sharedFolderId === sharedFolderId
        ? { ...f, lastSeenEntryId: newest.entry.id }
        : f,
    );
    const inbox = get().inboxItems.map((i) =>
      i.sourceFolderId === sharedFolderId ? { ...i, isUnread: false } : i,
    );
    set({
      followedUsers: next,
      inboxItems: inbox,
      unreadCount: countUnread(inbox),
    });
    await persistFollows(next);
    await persistInbox(inbox, get().lastSyncedAt);
  },

  loadMyIndex: async (opts) => {
    if (get().myIndexLoaded && !opts?.force) return get().myIndex;
    set({ myIndexLoading: true, myIndexError: null });
    try {
      const folders =
        (await getCachedShareFolders()) ??
        (await useSharingStore.getState().ensureFolders());
      const index = await readShareIndex(folders.root);
      set({ myIndex: index, myIndexLoaded: true, myIndexLoading: false });
      return index;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load shares.";
      set({
        myIndex: null,
        myIndexLoaded: true,
        myIndexLoading: false,
        myIndexError: msg,
      });
      return null;
    }
  },

  unshare: async (entryId) => {
    const current = get().myIndex;
    if (!current) throw new Error("Load your shares before unsharing.");
    if (!current.entries.some((e) => e.id === entryId)) return;
    const folders =
      (await getCachedShareFolders()) ??
      (await useSharingStore.getState().ensureFolders());
    // One queued Drive mutation removes the inlined entry from the manifest;
    // followers stop seeing it on their next sync.
    const next = await mutateShareIndex(folders.root, (latest) => {
      const base = latest ?? current;
      if (!base.entries.some((e) => e.id === entryId)) return base;
      return removeIndexEntry(base, entryId);
    });
    set({ myIndex: next });
  },

  loadDirectory: async (opts) => {
    if (get().directoryLoading) return;
    // First paint: surface whatever's in the cache immediately so the
    // Discover rail doesn't flash an empty state during the network call.
    if (!get().directoryLoaded) {
      const cached = await getCachedDirectory();
      set({ directoryEntries: cached, directoryLoaded: true });
    }
    set({ directoryLoading: true });
    try {
      const fresh = await fetchDirectory({ force: opts?.force });
      set({
        directoryEntries: fresh,
        directoryLoaded: true,
        directoryLoading: false,
      });
    } catch {
      set({ directoryLoading: false });
    }
  },

  postComment: async ({ sharedFolderId, shareId, text }) => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Comment can't be empty.");
    const sharing = useSharingStore.getState();
    const profile = sharing.profile;
    if (!profile) {
      throw new Error("Pick a share handle before commenting.");
    }
    const folders =
      (await getCachedShareFolders()) ?? (await sharing.ensureFolders());
    const author = profileToAuthor(profile);
    const comment: ShareComment = {
      v: 1,
      id: generateShareId(),
      sharedFolderId,
      shareId,
      at: new Date().toISOString(),
      author,
      text: trimmed,
    };
    await appendComment(folders.root, comment);
    // Optimistic local insertion — saves an extra Drive read for the
    // common "post and look at it" path. A subsequent loadMyComments()
    // will reconcile if anything drifted.
    set({ myComments: [comment, ...get().myComments] });
    return comment;
  },

  loadMyComments: async (opts) => {
    if (get().commentsLoading) return;
    const sharing = useSharingStore.getState();
    set({ commentsLoading: true, commentsError: null });
    try {
      const folders =
        (await getCachedShareFolders()) ?? (await sharing.ensureFolders());
      const list = await readComments(folders.root);
      // Drive returns whatever order; sort newest-first here so the UI
      // doesn't have to think about it.
      list.sort((a, b) => (a.at < b.at ? 1 : -1));
      set({
        myComments: list,
        commentsLoading: false,
        commentsError: null,
      });
      void opts; // reserved for future incremental refresh logic
    } catch (e) {
      set({
        commentsLoading: false,
        commentsError:
          e instanceof Error ? e.message : "Couldn't read your comments.",
      });
    }
  },

  loadReceivedComments: async () => {
    if (get().commentsLoading) return;
    if (!get().followsLoaded) await get().loadFollows();
    const follows = get().followedUsers;
    if (follows.length === 0) {
      set({
        receivedComments: {},
        commentsLoading: false,
        commentsError: null,
        lastCommentsSyncedAt: Date.now(),
      });
      return;
    }
    const sharing = useSharingStore.getState();
    set({ commentsLoading: true, commentsError: null });
    try {
      const folders =
        (await getCachedShareFolders()) ?? (await sharing.ensureFolders());
      const { comments, errors } = await aggregateComments(
        follows.map((f) => f.sharedFolderId),
      );
      // Keep only comments targeting *my* shares — followers' streams
      // contain everything they've ever posted, including comments on
      // people who aren't me.
      const onMyShares = comments.filter(
        (c) => c.sharedFolderId === folders.root,
      );
      // Dedupe by id (two reads might double up if a worker re-ran).
      const seen = new Set<string>();
      const deduped: ShareComment[] = [];
      for (const c of onMyShares) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        deduped.push(c);
      }
      // Bucket by shareId; newest-first within each bucket.
      const buckets: Record<string, ShareComment[]> = {};
      for (const c of deduped) {
        (buckets[c.shareId] ??= []).push(c);
      }
      for (const list of Object.values(buckets)) {
        list.sort((a, b) => (a.at < b.at ? 1 : -1));
      }
      set({
        receivedComments: buckets,
        commentsLoading: false,
        commentsError:
          errors.length > 0
            ? `${errors.length} follower${errors.length === 1 ? "" : "s"} couldn't be read.`
            : null,
        lastCommentsSyncedAt: Date.now(),
      });
    } catch (e) {
      set({
        commentsLoading: false,
        commentsError:
          e instanceof Error ? e.message : "Couldn't aggregate comments.",
      });
    }
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function persistFollows(followedUsers: FollowedUser[]): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.FOLLOWED_USERS]: followedUsers,
  });
}

async function persistInbox(
  items: InboxItem[],
  lastSyncedAt: number | null,
): Promise<void> {
  const cache: InboxCache = { v: 1, items, lastSyncedAt };
  await chrome.storage.local.set({
    [STORAGE_KEYS.SOCIAL_INBOX_CACHE]: cache,
  });
}

function parseInboxCache(raw: unknown): InboxCache | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as { v?: unknown }).v !== 1 ||
    !Array.isArray((raw as { items?: unknown }).items)
  ) {
    return null;
  }
  const cache = raw as Partial<InboxCache>;
  const items = (cache.items ?? []).filter(isInboxItem);
  return {
    v: 1,
    items,
    lastSyncedAt:
      typeof cache.lastSyncedAt === "number" ? cache.lastSyncedAt : null,
  };
}

function isInboxItem(value: unknown): value is InboxItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<InboxItem>;
  return (
    !!item.entry &&
    typeof item.entry.id === "string" &&
    item.entry.v === 2 &&
    !!item.author &&
    typeof item.author.handle === "string" &&
    typeof item.sourceFolderId === "string" &&
    typeof item.isUnread === "boolean"
  );
}

function countUnread(items: InboxItem[]): number {
  let n = 0;
  for (const i of items) if (i.isUnread) n++;
  return n;
}

/**
 * Decide whether an entry is unread for a given follow's `lastSeenEntryId`.
 *
 * The index is newest-first, so anything appearing *before* the lastSeen id
 * in the list is newer than the user has seen. If lastSeen is missing
 * (followed-but-never-synced), nothing is unread by default — first-follow
 * marks the existing list as the baseline so the user isn't spammed with
 * a 200-entry backlog the moment they hit follow.
 */
function isEntryUnread(
  entry: ShareEntry,
  feed: ShareEntry[],
  lastSeenEntryId: string | undefined,
): boolean {
  if (!lastSeenEntryId) return false;
  const seenIdx = feed.findIndex((e) => e.id === lastSeenEntryId);
  if (seenIdx === -1) {
    // The user's last-seen entry has aged out of the manifest (over
    // MAX_SHARE_INDEX_ENTRIES). Treat everything as fresh.
    return true;
  }
  const entryIdx = feed.indexOf(entry);
  return entryIdx > -1 && entryIdx < seenIdx;
}
