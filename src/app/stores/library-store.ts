/**
 * Zustand store for the browse / library state.
 *
 * Holds the current folder listing + classification of files into videos,
 * subtitles, and subfolders. Encapsulates loading state so pages don't need
 * to manage useState pyramids.
 */

import { create } from "zustand";
import {
  listFolderAll,
  isFolder,
  isVideoFile,
  matchSubtitlesForVideo,
} from "../services/drive-api";
import { DriveAccessError, type DriveAccessReason } from "../services/errors";
import type { DriveFile } from "@shared/types";

interface ClassifiedVideo {
  video: DriveFile;
  subtitles: DriveFile[];
}

interface LibraryState {
  folderId: string | null;
  loading: boolean;
  error: string | null;
  /** Typed error reason so the UI can render the right "fix this" CTA. */
  errorReason: DriveAccessReason | null;
  allFiles: DriveFile[];
  subfolders: DriveFile[];
  videos: ClassifiedVideo[];
  loadFolder: (folderId: string) => Promise<void>;
  reset: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  folderId: null,
  loading: false,
  error: null,
  errorReason: null,
  allFiles: [],
  subfolders: [],
  videos: [],

  loadFolder: async (folderId: string) => {
    if (get().folderId === folderId && get().allFiles.length > 0) return;
    set({ folderId, loading: true, error: null, errorReason: null });
    try {
      const files = await listFolderAll(folderId);
      const subfolders = files.filter(isFolder);
      const videoFiles = files.filter(isVideoFile);
      const videos: ClassifiedVideo[] = videoFiles.map((v) => ({
        video: v,
        subtitles: matchSubtitlesForVideo(v, files),
      }));
      set({ allFiles: files, subfolders, videos, loading: false });
    } catch (e) {
      if (e instanceof DriveAccessError) {
        set({ loading: false, error: e.message, errorReason: e.reason });
      } else {
        set({
          loading: false,
          error: e instanceof Error ? e.message : "Failed to load folder",
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
      error: null,
      errorReason: null,
    }),
}));
