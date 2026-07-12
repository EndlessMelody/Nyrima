import type { DialogueLine } from "./landingSections";
import type { Emotion } from "./mascotArt";

/**
 * Poke / affection — a lightweight "how much have you interacted with
 * Ny-chan" tally, persisted across visits. Pokes, picked dialogue choices,
 * opened chapters, and the completion reward all nudge `points` up (capped);
 * crossing a tier threshold unlocks a one-time easter-egg reaction.
 *
 * All functions here are pure; `LandingVNPage` owns the React state and calls
 * `readStoredAffection`/`writeStoredAffection` (same defensive-storage pattern
 * as `vnControls.ts`: injectable storage, normalize-on-read).
 */

export const AFFECTION_STORAGE_KEY = "nyrima.vn.affection";

type AffectionStorage = Pick<Storage, "getItem" | "setItem">;

export interface AffectionState {
  points: number;
  pokeCount: number;
  /** Ids of AFFECTION_TIERS already unlocked — guards against re-firing a
   *  tier's easter egg on a later session where points start above it. */
  unlockedTierIds: string[];
}

export const DEFAULT_AFFECTION_STATE: AffectionState = {
  points: 0,
  pokeCount: 0,
  unlockedTierIds: [],
};

/** Top tier threshold == the gauge's max (5 pips x 6 points). */
export const AFFECTION_CAP = 30;
export const AFFECTION_PIP_COUNT = 5;

export const AFFECTION_GAIN = {
  poke: 1,
  choice: 3,
  chapterComplete: 2,
  completionReward: 5,
} as const;

/** Minimum time between accepted pokes — extra clicks within this window are ignored. */
export const POKE_DEBOUNCE_MS = 400;

/** A poke reaction or tier easter egg: a short aside + the emotion it shows. */
export interface Reaction {
  lines: DialogueLine[];
  emotion: Emotion;
}

export interface AffectionTier {
  id: string;
  threshold: number;
  reaction: Reaction;
}

export const AFFECTION_TIERS: AffectionTier[] = [
  {
    id: "tier-5",
    threshold: 5,
    reaction: {
      lines: ["Ehehe... okay, that was kind of sweet of you."],
      emotion: "shy",
    },
  },
  {
    id: "tier-15",
    threshold: 15,
    reaction: {
      lines: ["Heehee, we're getting along great, aren't we?"],
      emotion: "proud",
    },
  },
  {
    id: "tier-30",
    threshold: AFFECTION_CAP,
    reaction: {
      lines: [
        "...Thank you for spending so much time with me.",
        "It really does mean a lot, you know.",
      ],
      emotion: "adoring",
    },
  },
];

/** Cycled through on ordinary pokes, by poke count. */
export const POKE_REACTIONS: Reaction[] = [
  { lines: ["H-hey! What was that for?"], emotion: "surprised" },
  { lines: ["Mou~ poking is rude, you know."], emotion: "pouting" },
  { lines: ["Oho? Feeling brave today, hm?"], emotion: "smug" },
  { lines: ["A-ah... do that again and I might just get used to it."], emotion: "shy" },
];

/** Shown instead of POKE_REACTIONS when several pokes land in quick succession. */
export const RAPID_POKE_REACTIONS: Reaction[] = [
  { lines: ["H-hey hey HEY— okay! Okay! I surrender!"], emotion: "panicked" },
  { lines: ["Pfft— mercy! Mercy! I'm ticklish, I swear!"], emotion: "panicked" },
];

export const RAPID_POKE_WINDOW_MS = 2500;
export const RAPID_POKE_THRESHOLD = 3;

/** Add `amount` points, clamped to [0, AFFECTION_CAP]. */
export function addAffection(state: AffectionState, amount: number): AffectionState {
  return {
    ...state,
    points: Math.max(0, Math.min(AFFECTION_CAP, state.points + amount)),
  };
}

/** addAffection(poke) + bump the poke counter used to cycle reactions. */
export function recordPoke(state: AffectionState): AffectionState {
  return {
    ...addAffection(state, AFFECTION_GAIN.poke),
    pokeCount: state.pokeCount + 1,
  };
}

export function markTiersUnlocked(state: AffectionState, tierIds: readonly string[]): AffectionState {
  if (tierIds.length === 0) return state;
  const merged = new Set(state.unlockedTierIds);
  for (const id of tierIds) merged.add(id);
  return { ...state, unlockedTierIds: [...merged] };
}

/**
 * Tiers crossed by an increase from `prevPoints` to `nextPoints` that haven't
 * already fired (per `alreadyUnlockedIds`). A single gain can cross more than
 * one tier (returned in threshold order).
 */
export function newlyUnlockedTiers(
  prevPoints: number,
  nextPoints: number,
  alreadyUnlockedIds: readonly string[],
): AffectionTier[] {
  const seen = new Set(alreadyUnlockedIds);
  return AFFECTION_TIERS.filter(
    (tier) => !seen.has(tier.id) && prevPoints < tier.threshold && nextPoints >= tier.threshold,
  );
}

/** Cycle POKE_REACTIONS (or RAPID_POKE_REACTIONS) by 1-based poke count. */
export function pickPokeReaction(pokeCount: number, rapid: boolean): Reaction {
  const pool = rapid ? RAPID_POKE_REACTIONS : POKE_REACTIONS;
  const index = ((pokeCount - 1) % pool.length + pool.length) % pool.length;
  return pool[index];
}

/**
 * True if at least RAPID_POKE_THRESHOLD of `timestamps` (ms, ascending, the
 * latest poke last) fall within RAPID_POKE_WINDOW_MS of the latest one.
 */
export function isRapidPoke(timestamps: readonly number[]): boolean {
  if (timestamps.length < RAPID_POKE_THRESHOLD) return false;
  const latest = timestamps[timestamps.length - 1];
  const windowStart = latest - RAPID_POKE_WINDOW_MS;
  return timestamps.filter((t) => t >= windowStart).length >= RAPID_POKE_THRESHOLD;
}

function getStorage(storage?: AffectionStorage): AffectionStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function normalizeAffectionState(value: unknown): AffectionState {
  if (!value || typeof value !== "object") return DEFAULT_AFFECTION_STATE;
  const raw = value as Partial<AffectionState>;
  const points =
    typeof raw.points === "number" && Number.isFinite(raw.points)
      ? Math.max(0, Math.min(AFFECTION_CAP, raw.points))
      : DEFAULT_AFFECTION_STATE.points;
  const pokeCount =
    typeof raw.pokeCount === "number" && Number.isFinite(raw.pokeCount) && raw.pokeCount >= 0
      ? Math.floor(raw.pokeCount)
      : DEFAULT_AFFECTION_STATE.pokeCount;
  const unlockedTierIds = Array.isArray(raw.unlockedTierIds)
    ? raw.unlockedTierIds.filter((id): id is string => typeof id === "string")
    : DEFAULT_AFFECTION_STATE.unlockedTierIds;
  return { points, pokeCount, unlockedTierIds };
}

export function readStoredAffection(storage?: AffectionStorage): AffectionState {
  try {
    const raw = getStorage(storage)?.getItem(AFFECTION_STORAGE_KEY);
    if (!raw) return DEFAULT_AFFECTION_STATE;
    return normalizeAffectionState(JSON.parse(raw));
  } catch {
    return DEFAULT_AFFECTION_STATE;
  }
}

export function writeStoredAffection(state: AffectionState, storage?: AffectionStorage) {
  try {
    getStorage(storage)?.setItem(AFFECTION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage can be unavailable in private contexts; the UI state still works.
  }
}
