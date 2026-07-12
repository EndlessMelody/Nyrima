/**
 * Rotating "system log" lines for the brand console (left sector of the start
 * menu). The first entry is the canonical light-novel tagline and is always
 * shown first; the rest cycle as in-character status quips delivered through
 * the console's typewriter.
 *
 * `accent` is the substring rendered in pink — the typewriter keeps the split
 * so the highlight survives mid-type. Pure data only; `BrandConsole` owns the
 * timers and typing state.
 */
export interface BrandLine {
  /** Full text, typed left-to-right. */
  text: string;
  /** Trailing portion of `text` painted in the pink accent colour. */
  accent?: string;
}

export const BRAND_LINES: BrandLine[] = [
  { text: "My Reliance on Anime Sites Was Wrong, ", accent: "As I Expected~!!!" },
  { text: "Your drive. Your shelf. ", accent: "Your cinema." },
  { text: "No ads. No trackers. ", accent: "No excuses." },
  { text: "Blu-ray rips, native subs — ", accent: "exactly as the fansub intended." },
  { text: "Booting the personal cinema... ", accent: "ready when you are." },
];
