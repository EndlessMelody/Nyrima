/**
 * Global Drive cooldown signal.
 *
 * The queue notifies this store whenever it sees a 403-rate-limit / 429 /
 * Retry-After, so anywhere in the UI can render a "Drive is cooling down"
 * banner without prop-drilling. Components subscribe via useRateLimitStore.
 *
 * Background prefetch (e.g. MSE controller) reads `isCooling` to know it
 * should suspend any non-critical work until cooldown lifts.
 */

import { create } from "zustand";

interface RateLimitState {
  /** Epoch ms when cooldown ends, or 0 when not cooling. */
  coolingUntil: number;
  /** Number of consecutive rate-limit hits without a success in between. */
  hitCount: number;
  /** True when coolingUntil > now. */
  isCooling: boolean;
  beginCooldown: (durationMs: number) => void;
  recordSuccess: () => void;
  clear: () => void;
}

export const useRateLimitStore = create<RateLimitState>((set, get) => ({
  coolingUntil: 0,
  hitCount: 0,
  isCooling: false,

  beginCooldown: (durationMs: number) => {
    const now = Date.now();
    const current = get().coolingUntil;
    const proposed = now + Math.max(1000, durationMs);
    // Extend only — never shorten a longer cooldown that's already in effect.
    const next = Math.max(current, proposed);
    set({
      coolingUntil: next,
      hitCount: get().hitCount + 1,
      isCooling: true,
    });
    // Auto-clear flag when the cooldown expires.
    const ms = next - now;
    setTimeout(() => {
      // Only flip back to false if no fresh cooldown has been pushed past now.
      if (Date.now() >= get().coolingUntil) {
        set({ isCooling: false });
      }
    }, ms + 50);
  },

  recordSuccess: () => {
    if (get().hitCount === 0 && !get().isCooling) return;
    set({ hitCount: 0 });
  },

  clear: () => set({ coolingUntil: 0, hitCount: 0, isCooling: false }),
}));

/** Imperative read for non-React callers (queue, mse-controller). */
export function isCoolingDown(): boolean {
  const { coolingUntil } = useRateLimitStore.getState();
  return coolingUntil > Date.now();
}

export function coolingMsRemaining(): number {
  const { coolingUntil } = useRateLimitStore.getState();
  return Math.max(0, coolingUntil - Date.now());
}
