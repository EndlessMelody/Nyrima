/**
 * Zustand store mirroring the recent-folders list in chrome.storage.local.
 */

import { create } from "zustand";
import {
  getRecentFolders,
  upsertRecentFolder,
  removeRecentFolder,
  togglePinRecentFolder,
} from "../services/storage";
import { markProfileStatsDirty } from "../services/social/dirty-signal";
import type { RecentFolder } from "@shared/types";

interface RecentState {
  folders: RecentFolder[];
  loading: boolean;
  load: () => Promise<void>;
  upsert: (folder: RecentFolder) => Promise<void>;
  remove: (folderId: string) => Promise<void>;
  togglePin: (folderId: string) => Promise<void>;
}

export const useRecentStore = create<RecentState>((set) => ({
  folders: [],
  loading: false,

  load: async () => {
    set({ loading: true });
    const folders = await getRecentFolders();
    set({ folders, loading: false });
  },

  upsert: async (folder) => {
    const next = await upsertRecentFolder(folder);
    set({ folders: next });
    markProfileStatsDirty();
  },

  remove: async (folderId) => {
    const next = await removeRecentFolder(folderId);
    set({ folders: next });
  },

  togglePin: async (folderId) => {
    const next = await togglePinRecentFolder(folderId);
    set({ folders: next });
  },
}));

// Keep store in sync if storage changes from elsewhere (background, popup).
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const change = changes["dc.recentFolders"];
    if (!change) return;
    useRecentStore.setState({ folders: (change.newValue as RecentFolder[]) ?? [] });
  });
}
