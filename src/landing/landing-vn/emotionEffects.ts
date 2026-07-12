import type { Emotion } from "./mascotArt";

/**
 * Per-emotion presentation: a short, self-contained `motion` pop applied to
 * the mascot portrait when its expression changes, plus an optional `fx`
 * overlay layer (sparkles, blush, tears, …) rendered alongside the frame.
 *
 * Both are CSS-driven (see `.lvn-mascot[data-motion]` / `.lvn-mascot__fx[data-fx]`
 * in landing-vn.scss) and reduced-motion safe: `blush`/`tears`/`alert`/`sweat`
 * have a static visible base state, while `sparkles`/`zzz` (inherently
 * animated) are hidden under reduced motion / muted effects.
 */
export interface EmotionEffect {
  motion: "none" | "bounce" | "shake" | "sway-slow" | "perk" | "droop" | "lean";
  fx: "none" | "sparkles" | "blush" | "sweat" | "tears" | "zzz" | "alert";
}

export const EMOTION_EFFECTS: Record<Emotion, EmotionEffect> = {
  neutral: { motion: "none", fx: "none" },
  happy: { motion: "bounce", fx: "none" },
  proud: { motion: "perk", fx: "sparkles" },
  smug: { motion: "perk", fx: "none" },
  pointing: { motion: "perk", fx: "none" },
  thinking: { motion: "sway-slow", fx: "none" },
  confused: { motion: "sway-slow", fx: "none" },
  determined: { motion: "perk", fx: "none" },
  adoring: { motion: "sway-slow", fx: "sparkles" },
  shy: { motion: "lean", fx: "blush" },
  pouting: { motion: "lean", fx: "none" },
  sleepy: { motion: "droop", fx: "zzz" },
  teary: { motion: "droop", fx: "tears" },
  surprised: { motion: "bounce", fx: "alert" },
  panicked: { motion: "shake", fx: "sweat" },
};
