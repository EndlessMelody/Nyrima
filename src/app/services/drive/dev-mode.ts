/**
 * Dev safe-mode + debug toggles.
 *
 * The Nyrima dev loop hits Drive a lot — opening / closing the lobby,
 * scrubbing the player, retrying a fix. Without a cap, it's easy to burn
 * through the daily quota in an afternoon. This store exposes a few
 * opt-in throttles wired into DriveRequestQueue:
 *
 *   - rpmCap        — hard ceiling on Drive requests per minute
 *   - disablePrefetch — controller suspends background reads
 *   - cacheOnly       — metadata reads NEVER touch the network
 *   - mockMode        — drive-api short-circuits to canned fixtures (TBD)
 *
 * State is persisted in chrome.storage.local so it survives reloads.
 * Toggles can be flipped at runtime from the debug panel; the queue's
 * dispatch gate is updated reactively.
 */

import { create } from "zustand";
import { driveQueue } from "./request-queue";
import { idbClear, STORES } from "./idb";
import { clearDedup } from "./dedup";

const STORAGE_KEY = "dc.devMode";

interface DevModeFlags {
  /** Hard RPM ceiling. 0 = no cap. */
  rpmCap: number;
  /** When true, prefetch / background revalidation is suspended. */
  disablePrefetch: boolean;
  /** When true, all metadata reads return cached values only. */
  cacheOnly: boolean;
  /** When true, drive-api returns fixtures instead of hitting Drive. */
  mockMode: boolean;
  /** When true, the floating debug panel is rendered. */
  showDebugPanel: boolean;
}

const DEFAULTS: DevModeFlags = {
  rpmCap: 0,
  disablePrefetch: false,
  cacheOnly: false,
  mockMode: false,
  showDebugPanel: false,
};

interface DevModeState extends DevModeFlags {
  initialized: boolean;
  load: () => Promise<void>;
  patch: (p: Partial<DevModeFlags>) => Promise<void>;
  clearAllCaches: () => Promise<void>;
}

// Rolling window of request timestamps for the RPM gate.
const rpmWindow: number[] = [];

function pushRpm(): void {
  const now = Date.now();
  rpmWindow.push(now);
  // Trim anything older than 60s.
  while (rpmWindow.length > 0 && now - rpmWindow[0] > 60_000) {
    rpmWindow.shift();
  }
}

/** Public helper — called from authedFetch on every successful dispatch. */
export function trackRequest(): void {
  pushRpm();
}

export function getRpm(): number {
  const now = Date.now();
  while (rpmWindow.length > 0 && now - rpmWindow[0] > 60_000) {
    rpmWindow.shift();
  }
  return rpmWindow.length;
}

export const useDevModeStore = create<DevModeState>((set, get) => ({
  ...DEFAULTS,
  initialized: false,

  load: async () => {
    let stored: Partial<DevModeFlags> = {};
    try {
      const obj = await chrome.storage.local.get(STORAGE_KEY);
      stored = (obj[STORAGE_KEY] as Partial<DevModeFlags>) ?? {};
    } catch {
      // ignore — running outside chrome.storage
    }
    const merged = { ...DEFAULTS, ...stored };
    set({ ...merged, initialized: true });
    applyToQueue(merged);
  },

  patch: async (p) => {
    const next = { ...currentFlags(get()), ...p };
    set(next);
    applyToQueue(next);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
    } catch {
      // ignore
    }
  },

  clearAllCaches: async () => {
    await Promise.all([
      idbClear(STORES.FOLDER_SCAN),
      idbClear(STORES.FILE_METADATA),
      idbClear(STORES.SUBTITLE),
      idbClear(STORES.THUMBNAIL),
      idbClear(STORES.MEDIA_SEGMENT),
    ]);
    clearDedup();
  },
}));

function currentFlags(s: DevModeState): DevModeFlags {
  return {
    rpmCap: s.rpmCap,
    disablePrefetch: s.disablePrefetch,
    cacheOnly: s.cacheOnly,
    mockMode: s.mockMode,
    showDebugPanel: s.showDebugPanel,
  };
}

function applyToQueue(flags: DevModeFlags): void {
  if (flags.rpmCap > 0) {
    driveQueue.setDispatchGate(() => {
      const used = getRpm();
      if (used < flags.rpmCap) return 0;
      // We're at or above the cap — wait until the oldest entry falls off
      // the 60s window.
      const oldest = rpmWindow[0] ?? Date.now();
      return Math.max(100, 60_000 - (Date.now() - oldest));
    });
  } else {
    driveQueue.setDispatchGate(null);
  }
}

/** True when caller code should suppress background prefetch / revalidation. */
export function shouldSuppressPrefetch(): boolean {
  return useDevModeStore.getState().disablePrefetch;
}
