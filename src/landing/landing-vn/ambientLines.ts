import type { DialogueLine } from "./landingSections";
import type { Emotion } from "./mascotArt";

/**
 * Ambient content: time-of-day greetings, idle remarks, chapter-hover
 * comments, revisit greetings, and the completion reward — all delivered
 * through the dialogue box (the intro's first line, or an interjection).
 *
 * Pure data + pure selectors only; `LandingVNPage` owns the timers/state that
 * decide *when* to show these.
 */

export type TimeOfDayBucket = "morning" | "afternoon" | "evening" | "lateNight";

/** [05:00, 11:00) morning · [11:00, 17:00) afternoon · [17:00, 23:00) evening · else lateNight. */
export function getTimeOfDayBucket(date: Date = new Date()): TimeOfDayBucket {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 23) return "evening";
  return "lateNight";
}

/** Prepended to the intro's lines as a one-time, time-aware first line. */
export const TIME_GREETINGS: Record<TimeOfDayBucket, DialogueLine> = {
  morning: "Good morning! Perfect timing to queue something up before the day gets busy.",
  afternoon: "Good afternoon! Taking a little break, or just here for a look around?",
  evening: "Evening~ this is exactly the kind of hour Nyrima was made for.",
  lateNight: {
    text: "...Still up? Okay, okay — let's keep this nice and quiet, then.",
    emotion: "sleepy",
  },
};

/**
 * A short aside: a few lines plus the emotion to show while delivering them.
 * Per-line `emotion` overrides (see `resolveEmotion`) still win, so a line can
 * shift the expression mid-aside (e.g. the completion reward's teary→adoring).
 */
export interface AmbientLine {
  id: string;
  lines: DialogueLine[];
  emotion: Emotion;
}

/** Idle remarks, in two tiers (page owns the actual delay): a light "still
 *  there?" tier (~25s), then a sleepy tier (~60s) if nothing happened. */
export const IDLE_LINES: { tier1: AmbientLine[]; tier2: AmbientLine[] } = {
  tier1: [
    { id: "idle-thinking", emotion: "thinking", lines: ["Hm? Take your time — I'm not exactly going anywhere."] },
    { id: "idle-confused", emotion: "confused", lines: ["...Did I lose you, or are you just thinking it over?"] },
    { id: "idle-pointing", emotion: "pointing", lines: ["Psst — the chapters are still right there whenever you're ready."] },
    { id: "idle-smug", emotion: "smug", lines: ["I could hold this pose all day, you know. I'm very patient."] },
    { id: "idle-happy", emotion: "happy", lines: ["No pressure! Reading at your own pace is half the fun."] },
  ],
  tier2: [
    { id: "idle-sleepy-1", emotion: "sleepy", lines: ["Mn... did you wander off somewhere?"] },
    { id: "idle-sleepy-2", emotion: "sleepy", lines: ["*yawn* ...I'll just rest my eyes for a moment here."] },
  ],
};

/** One remark per chapter, shown on a debounced index-card hover. */
export const HOVER_REMARKS: Record<string, AmbientLine> = {
  welcome: {
    id: "hover-welcome",
    emotion: "happy",
    lines: ["That one's a good place to start if this is your first visit."],
  },
  tech: {
    id: "hover-tech",
    emotion: "smug",
    lines: ["Careful — I get a little proud once we start talking tech."],
  },
  trust: {
    id: "hover-trust",
    emotion: "determined",
    lines: ["Good. Read this one. I mean that."],
  },
  behind: {
    id: "hover-behind",
    emotion: "shy",
    lines: ["Ehehe... that one's a bit personal, just so you know."],
  },
};

/** Picked deterministically (by `visited.size % length`) for the index's
 *  dialogue once the visitor has opened at least one chapter. */
export const REVISIT_GREETINGS: AmbientLine[] = [
  { id: "revisit-welcome-back", emotion: "happy", lines: ["Back already? Let's see what's left to explore."] },
  { id: "revisit-pouting", emotion: "pouting", lines: ["Mou~ leaving me to go stare at folders again, I see."] },
  { id: "revisit-pointing", emotion: "pointing", lines: ["Still curious about something? Go ahead, pick another."] },
  { id: "revisit-adoring", emotion: "adoring", lines: ["You're really going through all of it, huh? I like that."] },
];

/** Fired once, the first time every trackable node has been visited. */
export const COMPLETION_REWARD: AmbientLine = {
  id: "completion-reward",
  emotion: "teary",
  lines: [
    { text: "...Wait. You actually went through everything, didn't you?", emotion: "teary" },
    { text: "Thank you — really. That means more to me than you probably know.", emotion: "adoring" },
  ],
};

/**
 * Pick an item that hasn't been used yet (per `usedIds`); once every item in
 * `pool` has been used, the pool "resets" and picks (with possible repeats)
 * from the full pool again. `rng` is injectable for deterministic tests and
 * must return a value in `[0, 1)` (values >= 1 are clamped).
 */
export function pickAmbient<T extends { id: string }>(
  pool: readonly T[],
  usedIds: ReadonlySet<string>,
  rng: () => number = Math.random,
): T | null {
  if (pool.length === 0) return null;
  const unused = pool.filter((item) => !usedIds.has(item.id));
  const candidates = unused.length > 0 ? unused : pool;
  const index = Math.min(Math.floor(rng() * candidates.length), candidates.length - 1);
  return candidates[index];
}
