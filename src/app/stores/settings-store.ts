/**
 * Zustand store for AppSettings, backed by chrome.storage.local.
 *
 * The store hydrates lazily on first read (initialized = false until then) so
 * components can render with DEFAULT_SETTINGS while we wait for storage.
 * Every patch is mirrored to chrome.storage via saveSettings().
 *
 * The `subtitleCustomFontDataUrl` field is the heaviest payload here; we
 * lean on chrome.storage.local's ~5 MB default quota which is plenty for a
 * single woff2 (typically < 200 KB).
 */

import { create } from "zustand";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type SubtitleFontPreset,
} from "@shared/types";
import { getSettings, saveSettings } from "../services/storage";
import { ensureCustomFontRegistered } from "../services/subtitle-font";

interface SettingsState {
  settings: AppSettings;
  initialized: boolean;
  load: () => Promise<void>;
  patch: (p: Partial<AppSettings>) => Promise<void>;
  setScale: (scale: number) => Promise<void>;
  setFont: (font: SubtitleFontPreset) => Promise<void>;
  setCustomFont: (name: string, dataUrl: string) => Promise<void>;
  clearCustomFont: () => Promise<void>;
  setSkipSeconds: (s: AppSettings["skipSeconds"]) => Promise<void>;
  setDefaultVolume: (volume: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  initialized: false,

  load: async () => {
    const stored = await getSettings();
    if (stored.subtitleCustomFontDataUrl) {
      ensureCustomFontRegistered(stored.subtitleCustomFontDataUrl);
    }
    set({ settings: stored, initialized: true });
  },

  patch: async (p) => {
    const next = await saveSettings(p);
    set({ settings: next });
  },

  setScale: async (scale) => {
    const clamped = Math.max(0.5, Math.min(2.0, scale));
    await get().patch({ subtitleScale: clamped });
  },

  setFont: async (font) => {
    await get().patch({ subtitleFont: font });
  },

  setCustomFont: async (name, dataUrl) => {
    ensureCustomFontRegistered(dataUrl);
    await get().patch({
      subtitleFont: "custom",
      subtitleCustomFontName: name,
      subtitleCustomFontDataUrl: dataUrl,
    });
  },

  clearCustomFont: async () => {
    await get().patch({
      subtitleFont: "chinacat-teddybear",
      subtitleCustomFontName: undefined,
      subtitleCustomFontDataUrl: undefined,
    });
  },

  setSkipSeconds: async (s) => {
    await get().patch({ skipSeconds: s });
  },

  setDefaultVolume: async (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    await get().patch({ defaultVolume: clamped });
  },
}));
