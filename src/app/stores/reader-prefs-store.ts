/**
 * Zustand store for the global reader preferences.
 *
 * Mirrors the pattern of `settings-store`: hydrate lazily on first use, render
 * with DEFAULT_READER_PREFS until then, and persist every patch to
 * chrome.storage via the reader-storage service.
 */

import { create } from "zustand";
import {
  DEFAULT_READER_PREFS,
  normalizeReaderPrefs,
  type ReaderPrefs,
} from "../services/reader/reader-prefs";
import { getReaderPrefs, saveReaderPrefs } from "../services/reader/reader-storage";

interface ReaderPrefsState {
  prefs: ReaderPrefs;
  initialized: boolean;
  load: () => Promise<void>;
  patch: (p: Partial<ReaderPrefs>) => void;
  reset: () => void;
}

export const useReaderPrefsStore = create<ReaderPrefsState>((set, get) => ({
  prefs: DEFAULT_READER_PREFS,
  initialized: false,

  load: async () => {
    if (get().initialized) return;
    const stored = await getReaderPrefs();
    set({ prefs: stored, initialized: true });
  },

  patch: (p) => {
    const next = normalizeReaderPrefs({ ...get().prefs, ...p });
    set({ prefs: next });
    void saveReaderPrefs(next);
  },

  reset: () => {
    set({ prefs: DEFAULT_READER_PREFS });
    void saveReaderPrefs(DEFAULT_READER_PREFS);
  },
}));
