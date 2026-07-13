/**
 * Owns the profile-dashboard sync: computing local aggregates + heatmap
 * buckets from already-loaded state (see `services/social/profile-stats.ts`)
 * and pushing them to Supabase, plus loading another user's published
 * dashboard data for viewing.
 *
 * Event-driven, not polled (matches the app's existing pull-based sync
 * ethos — see `syncInbox`/`syncFeed`): one-shot on sign-in/app load via
 * `startAutoSync`, plus a debounced recompute whenever local watch/library
 * state changes (`dirty-signal.ts`). Guests and unconfigured-Supabase
 * sessions never sync — this is a no-op for them.
 */

import { create } from "zustand";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getProfileStats,
  getActivityDays,
  listUserBadges,
  listBadgeDefs,
  upsertMyProfileStats,
  upsertMyActivityDays,
  getCommentsGivenCount,
  listFriendships,
  type ProfileStats,
  type ActivityDay,
  type BadgeDef,
  type UserBadge,
} from "../services/social/social-api";
import {
  computeLocalAggregates,
  computeActivityDayBuckets,
} from "../services/social/profile-stats";
import { getAllPlaybackPositions, getRecentFolders } from "../services/storage";
import { onProfileStatsDirty } from "../services/social/dirty-signal";
import { usePostsStore } from "./posts-store";
import { useSocialStore } from "./social-store";

const SYNC_DEBOUNCE_MS = 30_000;

interface UserProfileData {
  stats: ProfileStats | null;
  activity: ActivityDay[];
  badges: UserBadge[];
}

interface ProfileStatsState {
  byUser: Record<string, UserProfileData>;
  badgeDefs: BadgeDef[];
  badgeDefsLoaded: boolean;
  syncingMine: boolean;

  /** Read-only load of someone's (or your own) published dashboard data. */
  loadForUser: (userId: string) => Promise<void>;
  loadBadgeDefs: () => Promise<void>;
  /** Recompute local aggregates and push them for the signed-in user. */
  syncMine: (userId: string) => Promise<void>;
  /** Runs `syncMine` once immediately, then again on every dirty signal
   *  (debounced). Returns an unsubscribe function. */
  startAutoSync: (userId: string) => () => void;
}

export const useProfileStatsStore = create<ProfileStatsState>((set, get) => ({
  byUser: {},
  badgeDefs: [],
  badgeDefsLoaded: false,
  syncingMine: false,

  loadForUser: async (userId) => {
    if (!isSupabaseConfigured()) return;
    const [stats, activity, badges] = await Promise.all([
      getProfileStats(userId).catch(() => null),
      getActivityDays(userId).catch(() => []),
      listUserBadges(userId).catch(() => []),
    ]);
    set((s) => ({ byUser: { ...s.byUser, [userId]: { stats, activity, badges } } }));
  },

  loadBadgeDefs: async () => {
    if (get().badgeDefsLoaded || !isSupabaseConfigured()) return;
    try {
      const defs = await listBadgeDefs();
      set({ badgeDefs: defs, badgeDefsLoaded: true });
    } catch {
      // Best-effort — the dashboard still renders without the catalog.
    }
  },

  syncMine: async (userId) => {
    if (!isSupabaseConfigured() || get().syncingMine) return;
    set({ syncingMine: true });
    try {
      const [folders, positions] = await Promise.all([
        getRecentFolders(),
        getAllPlaybackPositions(),
      ]);
      const positionMap = Object.fromEntries(positions.map((p) => [p.fileId, p]));
      const local = computeLocalAggregates(folders, positionMap);
      const buckets = computeActivityDayBuckets(positions);

      const [friendships, commentsGivenCount] = await Promise.all([
        listFriendships().catch(() => []),
        getCommentsGivenCount(userId).catch(() => 0),
      ]);
      const friendsCount = friendships.filter((f) => f.status === "accepted").length;

      await useSocialStore
        .getState()
        .loadReceivedComments()
        .catch(() => undefined);
      const commentsReceivedCount = Object.values(
        useSocialStore.getState().receivedComments,
      ).reduce((sum, list) => sum + list.length, 0);

      await usePostsStore
        .getState()
        .loadMyPosts()
        .catch(() => undefined);
      const postsCount = usePostsStore.getState().myPosts.length;

      const stats = await upsertMyProfileStats({
        minutesWatched: local.minutesWatched,
        completedCount: local.completedCount,
        librariesOwned: local.librariesOwned,
        postsCount,
        commentsGivenCount,
        commentsReceivedCount,
        friendsCount,
        currentStreakDays: local.currentStreakDays,
        longestStreakDays: local.longestStreakDays,
        lastActiveDay: local.lastActiveDay,
      });
      await upsertMyActivityDays(buckets).catch(() => undefined);

      set((s) => ({
        byUser: {
          ...s.byUser,
          [userId]: { stats, activity: buckets, badges: s.byUser[userId]?.badges ?? [] },
        },
      }));
    } catch {
      // Best-effort sync — the local numbers (LibraryHealthCard etc.) are
      // already correct regardless of whether the push succeeded.
    } finally {
      set({ syncingMine: false });
    }
  },

  startAutoSync: (userId) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void get().syncMine(userId), SYNC_DEBOUNCE_MS);
    };
    void get().syncMine(userId);
    const unsubscribe = onProfileStatsDirty(trigger);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  },
}));
