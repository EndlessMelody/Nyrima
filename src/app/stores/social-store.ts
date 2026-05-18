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
 *                        stamped on each row. Recomputed by `syncInbox()`.
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
  FollowedUser,
  ShareAuthor,
  ShareIndex,
  ShareIndexEntry,
} from "@shared/types";
import { STORAGE_KEYS } from "@shared/constants";
import { extractFolderId } from "@shared/parse-folder-url";
import {
  deleteShareEntry,
  readShareIndex,
  removeIndexEntry,
  writeShareIndex,
} from "../services/sharing";
import { getCachedShareFolders } from "../services/sharing/share-folder";
import { useSharingStore } from "./sharing-store";

/** A row rendered in the Inbox tab — one ShareIndexEntry from a followed
 *  user, with author + source folder stamped so the UI can render attribution
 *  + a "view on Drive" link without re-resolving anything. */
export interface InboxItem {
  /** The slim manifest entry (id, sharedAt, entryFileId, kind, title, poster). */
  entry: ShareIndexEntry;
  /** Author profile snapshot from the followed user's `ShareIndex.owner`. */
  author: ShareAuthor;
  /** Drive folder id of the author's `Shared/` folder. */
  sourceFolderId: string;
  /** True when this entry is newer than the follow's `lastSeenEntryId`.
   *  Used to drive the unread badge + visual "NEW" pill on the row. */
  isUnread: boolean;
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

  // ---- follow management ----
  loadFollows: () => Promise<void>;
  follow: (input: { url: string }) => Promise<FollowedUser>;
  unfollow: (sharedFolderId: string) => Promise<void>;

  // ---- inbox ----
  syncInbox: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markFollowRead: (sharedFolderId: string) => Promise<void>;

  // ---- my shares ----
  loadMyIndex: (opts?: { force?: boolean }) => Promise<ShareIndex | null>;
  unshare: (entryId: string) => Promise<void>;
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

  loadFollows: async () => {
    if (get().followsLoaded) return;
    const obj = await chrome.storage.local.get(STORAGE_KEYS.FOLLOWED_USERS);
    const raw = obj[STORAGE_KEYS.FOLLOWED_USERS];
    const followedUsers: FollowedUser[] = Array.isArray(raw)
      ? (raw as FollowedUser[])
      : [];
    set({ followedUsers, followsLoaded: true });
    // Re-derive inbox state from cached entries if a previous session
    // persisted any. For now the inbox is recomputed at sync time only.
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

    set({
      inboxItems: items,
      unreadCount: countUnread(items),
      followedUsers: refreshedFollows,
      syncing: false,
      syncStates: states,
      lastSyncedAt: Date.now(),
    });
    await persistFollows(refreshedFollows);
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
    set({
      followedUsers: next,
      inboxItems: get().inboxItems.map((i) => ({ ...i, isUnread: false })),
      unreadCount: 0,
    });
    await persistFollows(next);
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
    const target = current.entries.find((e) => e.id === entryId);
    if (!target) return;
    const folders =
      (await getCachedShareFolders()) ??
      (await useSharingStore.getState().ensureFolders());
    // Index-first: a partial failure leaves the entry file orphaned (a
    // missing pointer is worse than a missing payload for followers).
    const next = removeIndexEntry(current, entryId);
    await writeShareIndex(folders.root, next);
    set({ myIndex: next });
    try {
      await deleteShareEntry(target.entryFileId);
    } catch {
      // Best-effort. The index no longer points at it — orphan stays
      // private inside `Shared/entries/` until a future cleanup pass.
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
  entry: ShareIndexEntry,
  feed: ShareIndexEntry[],
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

