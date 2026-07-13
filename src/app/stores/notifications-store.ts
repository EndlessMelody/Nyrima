/**
 * Zustand store for the topbar Notifications bell.
 *
 * Distinct from `social-store`'s `unreadCount` (new share entries from
 * followed users, surfaced on the Social button) — this store surfaces the
 * two social events that have no other UI yet: incoming friend requests and
 * comments left on the user's own shared folders. No new DB tables: both are
 * derived from the existing `friendships` / `folder_comments` Supabase tables
 * via `social-api.ts`.
 *
 * Unread tracking is a local-only watermark (`localStorage`, per-user) —
 * deliberately not synced to the DB, since the social layer stays
 * friends-and-comments only.
 */

import { create } from "zustand";
import {
  SocialAuthRequiredError,
  getProfilesByIds,
  listFolderComments,
  listFriendships,
  respondToFriendRequest,
  type FolderComment,
  type SocialProfile,
} from "../services/social/social-api";
import { getCachedShareFolders } from "../services/sharing/share-folder";

export type NotificationItem =
  | {
      kind: "friend-request";
      id: string;
      at: number;
      friendshipId: string;
      from: SocialProfile | null;
    }
  | {
      kind: "comment";
      id: string;
      at: number;
      comment: FolderComment;
    };

const MAX_ITEMS = 30;

function lastSeenKey(userId: string): string {
  return `nyrima.notifications.lastSeen.${userId}`;
}

function readLastSeen(userId: string): number {
  try {
    const raw = window.localStorage.getItem(lastSeenKey(userId));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeLastSeen(userId: string, at: number): void {
  try {
    window.localStorage.setItem(lastSeenKey(userId), String(at));
  } catch {
    /* private mode — watermark just won't persist */
  }
}

interface NotificationsState {
  items: NotificationItem[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** True when the caller has no Supabase session (guest / signed out). */
  locked: boolean;
  unreadCount: number;

  refresh: (myUserId: string) => Promise<void>;
  markAllSeen: (myUserId: string) => void;
  respondToRequest: (
    myUserId: string,
    friendshipId: string,
    status: "accepted" | "blocked",
  ) => Promise<void>;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  loaded: false,
  loading: false,
  error: null,
  locked: false,
  unreadCount: 0,

  refresh: async (myUserId) => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const [requests, comments] = await Promise.all([
        loadIncomingFriendRequests(myUserId),
        loadCommentsOnMyShares(myUserId),
      ]);
      const items = [...requests, ...comments]
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_ITEMS);
      const lastSeen = readLastSeen(myUserId);
      set({
        items,
        loaded: true,
        loading: false,
        locked: false,
        unreadCount: items.filter((i) => i.at > lastSeen).length,
      });
    } catch (e) {
      if (e instanceof SocialAuthRequiredError) {
        set({ items: [], loaded: true, loading: false, locked: true, unreadCount: 0 });
        return;
      }
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Couldn't load notifications.",
      });
    }
  },

  markAllSeen: (myUserId) => {
    const now = Date.now();
    writeLastSeen(myUserId, now);
    set({ unreadCount: 0 });
  },

  respondToRequest: async (myUserId, friendshipId, status) => {
    await respondToFriendRequest(friendshipId, status);
    set({ items: get().items.filter((i) => !(i.kind === "friend-request" && i.friendshipId === friendshipId)) });
    await get().refresh(myUserId);
  },
}));

async function loadIncomingFriendRequests(
  myUserId: string,
): Promise<Extract<NotificationItem, { kind: "friend-request" }>[]> {
  const friendships = await listFriendships();
  const incoming = friendships.filter(
    (f) => f.friendUserId === myUserId && f.status === "pending",
  );
  if (incoming.length === 0) return [];
  const profiles = await getProfilesByIds(incoming.map((f) => f.userId));
  return incoming.map((f) => ({
    kind: "friend-request",
    id: f.id,
    at: f.createdAt,
    friendshipId: f.id,
    from: profiles[f.userId] ?? null,
  }));
}

async function loadCommentsOnMyShares(
  myUserId: string,
): Promise<Extract<NotificationItem, { kind: "comment" }>[]> {
  const folders = await getCachedShareFolders();
  if (!folders) return [];
  const comments = await listFolderComments(folders.root);
  return comments
    .filter((c) => c.authorUserId !== myUserId)
    .map((c) => ({ kind: "comment", id: c.id, at: c.createdAt, comment: c }));
}
