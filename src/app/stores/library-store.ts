/**
 * Zustand store for the browse / library state.
 *
 * Reads route through DriveMetadataService so navigating between Lobby /
 * Library / Player reuses the cached folder scan instead of re-listing
 * Drive each time. When the cache is stale, the store returns the cached
 * data immediately AND triggers a background revalidation; consumers can
 * watch `refreshing` to surface a subtle "syncing…" hint.
 */

import { create } from "zustand";
import {
  listFolder as cachedListFolder,
  classifyFolder,
  invalidateFolder,
  onFolderChange,
} from "../services/drive/metadata-service";
import { DriveAccessError, type DriveAccessReason } from "../services/errors";
import type { DriveFile } from "@shared/types";

interface ClassifiedVideo {
  video: DriveFile;
  subtitles: DriveFile[];
}

interface LibraryState {
  folderId: string | null;
  loading: boolean;
  /** True when we have cached data on-screen and a revalidation is in flight. */
  refreshing: boolean;
  /** Epoch ms of the cache snapshot currently rendered, or 0 if fresh. */
  cacheAgeAt: number;
  error: string | null;
  errorReason: DriveAccessReason | null;
  allFiles: DriveFile[];
  subfolders: DriveFile[];
  videos: ClassifiedVideo[];
  loadFolder: (folderId: string) => Promise<void>;
  /** Force a network re-scan, bypassing the cache. */
  refresh: () => Promise<void>;
  reset: () => void;
}

let unsubscribeChange: (() => void) | null = null;

export const useLibraryStore = create<LibraryState>((set, get) => {
  // Subscribe once so background revalidations re-classify into the store.
  if (!unsubscribeChange) {
    unsubscribeChange = onFolderChange((folderId) => {
      if (get().folderId !== folderId) return;
      // Re-read from cache to pick up the updated entry. cacheOnly: true so
      // this doesn't trigger another revalidation loop.
      void cachedListFolder(folderId, { cacheOnly: true }).then((result) => {
        const classified = classifyFolder(result.files);
        set({
          allFiles: classified.files,
          subfolders: classified.subfolders,
          videos: classified.videos,
          refreshing: false,
          cacheAgeAt: result.fromCache ? result.scannedAt : 0,
        });
      });
    });
  }

  return {
    folderId: null,
    loading: false,
    refreshing: false,
    cacheAgeAt: 0,
    error: null,
    errorReason: null,
    allFiles: [],
    subfolders: [],
    videos: [],

    loadFolder: async (folderId: string) => {
      // Same folder + already classified — no-op so route changes within the
      // same library don't trash the cached scan from the store.
      if (get().folderId === folderId && get().allFiles.length > 0) return;

      set({
        folderId,
        loading: true,
        refreshing: false,
        error: null,
        errorReason: null,
      });

      try {
        const result = await cachedListFolder(folderId);
        const classified = classifyFolder(result.files);
        set({
          allFiles: classified.files,
          subfolders: classified.subfolders,
          videos: classified.videos,
          loading: false,
          refreshing: result.revalidating,
          cacheAgeAt: result.fromCache ? result.scannedAt : 0,
        });
      } catch (e) {
        if (e instanceof DriveAccessError) {
          set({
            loading: false,
            refreshing: false,
            error: e.message,
            errorReason: e.reason,
          });
        } else {
          set({
            loading: false,
            refreshing: false,
            error: e instanceof Error ? e.message : "Failed to load folder",
            errorReason: "unknown",
          });
        }
      }
    },

    refresh: async () => {
      const folderId = get().folderId;
      if (!folderId) return;
      set({ refreshing: true, error: null, errorReason: null });
      await invalidateFolder(folderId);
      try {
        const result = await cachedListFolder(folderId, { forceRefresh: true });
        const classified = classifyFolder(result.files);
        set({
          allFiles: classified.files,
          subfolders: classified.subfolders,
          videos: classified.videos,
          refreshing: false,
          cacheAgeAt: 0,
        });
      } catch (e) {
        if (e instanceof DriveAccessError) {
          set({
            refreshing: false,
            error: e.message,
            errorReason: e.reason,
          });
        } else {
          set({
            refreshing: false,
            error: e instanceof Error ? e.message : "Failed to refresh folder",
            errorReason: "unknown",
          });
        }
      }
    },

    reset: () =>
      set({
        folderId: null,
        allFiles: [],
        subfolders: [],
        videos: [],
        cacheAgeAt: 0,
        refreshing: false,
        error: null,
        errorReason: null,
      }),
  };
});
