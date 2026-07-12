/**
 * Presentation content for the Nyrima login *scene*.
 *
 * The login page is a fixed, single-viewport scene — not a long marketing page.
 * The left companion panel carries the identity row (home + feature badges), a
 * Nyrima player preview, and a compact VN mascot dialogue card where Ny-chan
 * reacts to the form; the auth card on the right is the gate. This module owns
 * only the copy and the mascot's per-state reactions; behaviour lives in
 * LoginPage / AuthProvider.
 */

import { AudioLines, Captions, History, LibraryBig, type LucideIcon } from "lucide-react";
import { type Emotion } from "@/landing/mascotArt";

export const loginPosterUrl = "/poster.png";

/** The mascot's name tag / dialogue speaker. */
export const mascotSpeaker = "Ny-chan";

/** Optional helper line under the resting greeting. */
export const mascotHelper = "Sign in when you're ready.";

/**
 * Ny-chan's reactions to the auth flow. The page picks one mood from the form's
 * state (focus → submitting → error → success) so she feels like a live guide,
 * not a static illustration. Each mood maps to one of her portrait expressions
 * (see landing/mascotArt) plus a short, readable line or two.
 */
export type MascotMood =
  | "default"
  | "signup"
  | "email"
  | "password"
  | "loading"
  | "error"
  | "success";

export interface MascotMoodContent {
  emotion: Emotion;
  lines: readonly [string] | readonly [string, string];
}

export const mascotMoods: Record<MascotMood, MascotMoodContent> = {
  default: {
    emotion: "neutral",
    lines: ["Welcome back.", "Your next episode is still waiting."],
  },
  signup: {
    emotion: "proud",
    lines: ["Let's set up your cinema.", "I'll keep your seat ready."],
  },
  email: {
    emotion: "pointing",
    lines: ["Use the email linked to your library."],
  },
  password: {
    emotion: "shy",
    lines: ["Don't worry, I won't peek."],
  },
  loading: {
    emotion: "determined",
    lines: ["Opening the gate…"],
  },
  error: {
    emotion: "confused",
    lines: ["Mm, that didn't match.", "Try once more?"],
  },
  success: {
    emotion: "adoring",
    lines: ["Welcome home."],
  },
};

/** Quiet supporting badges for the identity row — what's waiting inside. */
export const featureChips: ReadonlyArray<{ icon: LucideIcon; label: string }> = [
  { icon: LibraryBig, label: "Personal Libraries" },
  { icon: History, label: "Watch History" },
  { icon: Captions, label: "Subtitles" },
  { icon: AudioLines, label: "Multi-audio" },
];

export const signInCopy = {
  panelHeading: "Welcome back.",
  panelBody: "Sign in to reach your libraries, watch history, and player settings.",
  submitLabel: "Sign in",
} as const;

export const signUpCopy = {
  panelHeading: "Create your cinema.",
  panelBody: "Make an account to keep your libraries, history, and settings in sync.",
  submitLabel: "Create account",
} as const;

export const loginLegalLinks = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
] as const;

/**
 * "Try Nyrima" guest CTA — a real, welcoming product path under the main
 * sign-in options (NOT a hidden debug toggle). Lets visitors into the app
 * without creating a Nyrima account; they can still connect their own Drive.
 */
export const guestCta = {
  /** Small divider lead-in above the card. */
  eyebrow: "Not ready to sign in?",
  title: "Try Nyrima",
  description:
    "Watch from your Drive without creating a Nyrima account. Social features unlock when you sign in.",
  button: "Try Nyrima",
  note: "Google Drive access still requires your permission.",
} as const;
