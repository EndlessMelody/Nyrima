/**
 * Zustand store for the Posts "Popular" discovery tab — Supabase-backed
 * (`posts_index` / `post_likes`), deliberately separate from `usePostsStore`
 * (which is Drive-only), the same split the codebase already draws between
 * `social-store` and `posts-store`.
 *
 * No persistent cache for v1 (unlike `posts-store`'s `feedItems`) — refetches
 * on each visit. Likes are applied optimistically and rolled back on error.
 */

import { create } from "zustand";
import {
  getMyLikedPostIds,
  likePost,
  listPopularPosts,
  listRecentPublicPosts,
  unlikePost,
  type PostIndexEntry,
} from "../services/social/posts-discovery-api";

interface PostsDiscoveryState {
  popularItems: PostIndexEntry[];
  popularLoaded: boolean;
  popularLoading: boolean;
  popularError: string | null;

  likedPostIds: Set<string>;

  loadPopular: (opts?: { force?: boolean }) => Promise<void>;
  toggleLike: (postId: string) => Promise<void>;
}

export const usePostsDiscoveryStore = create<PostsDiscoveryState>((set, get) => ({
  popularItems: [],
  popularLoaded: false,
  popularLoading: false,
  popularError: null,

  likedPostIds: new Set(),

  loadPopular: async (opts) => {
    if (get().popularLoaded && !opts?.force) return;
    if (get().popularLoading) return;
    set({ popularLoading: true, popularError: null });
    try {
      let items = await listPopularPosts();
      if (items.length === 0) items = await listRecentPublicPosts();
      const liked = await getMyLikedPostIds(items.map((i) => i.postId)).catch(
        () => new Set<string>(),
      );
      set({
        popularItems: items,
        popularLoaded: true,
        popularLoading: false,
        likedPostIds: liked,
      });
    } catch (e) {
      set({
        popularLoading: false,
        popularError: e instanceof Error ? e.message : "Couldn't load popular posts.",
      });
    }
  },

  toggleLike: async (postId) => {
    const wasLiked = get().likedPostIds.has(postId);
    const nextLiked = new Set(get().likedPostIds);
    if (wasLiked) nextLiked.delete(postId);
    else nextLiked.add(postId);
    set({
      likedPostIds: nextLiked,
      popularItems: get().popularItems.map((item) =>
        item.postId === postId
          ? { ...item, likeCount: Math.max(0, item.likeCount + (wasLiked ? -1 : 1)) }
          : item,
      ),
    });
    try {
      if (wasLiked) await unlikePost(postId);
      else await likePost(postId);
    } catch {
      // Roll back on failure.
      const rolledBack = new Set(get().likedPostIds);
      if (wasLiked) rolledBack.add(postId);
      else rolledBack.delete(postId);
      set({
        likedPostIds: rolledBack,
        popularItems: get().popularItems.map((item) =>
          item.postId === postId
            ? { ...item, likeCount: Math.max(0, item.likeCount + (wasLiked ? 1 : -1)) }
            : item,
        ),
      });
    }
  },
}));
