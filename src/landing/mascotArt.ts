/**
 * Ny-chan's expressions + the shared scene background. One PNG per emotion,
 * dropped in public/ny_chan. The mascot portrait crossfades between these as the
 * active section/subsection (landing), menu, or login form-state changes.
 * To add or swap an expression, add a PNG and map it here.
 */
export type Emotion =
  | "neutral"
  | "proud"
  | "smug"
  | "happy"
  | "pointing"
  | "thinking"
  | "adoring"
  | "confused"
  | "determined"
  | "panicked"
  | "pouting"
  | "shy"
  | "sleepy"
  | "surprised"
  | "teary";

const MASCOT_BASE = "/ny_chan";

export const EMOTION_ART: Record<Emotion, string> = {
  neutral: `${MASCOT_BASE}/neutral.png`,
  proud: `${MASCOT_BASE}/proud.png`,
  smug: `${MASCOT_BASE}/smug.png`,
  happy: `${MASCOT_BASE}/happy.png`,
  pointing: `${MASCOT_BASE}/pointing.png`,
  thinking: `${MASCOT_BASE}/thinking.png`,
  adoring: `${MASCOT_BASE}/adoring.png`,
  confused: `${MASCOT_BASE}/confused.png`,
  determined: `${MASCOT_BASE}/determined.png`,
  panicked: `${MASCOT_BASE}/panicked.png`,
  pouting: `${MASCOT_BASE}/pouting.png`,
  shy: `${MASCOT_BASE}/shy.png`,
  sleepy: `${MASCOT_BASE}/sleepy.png`,
  surprised: `${MASCOT_BASE}/surprised.png`,
  teary: `${MASCOT_BASE}/teary.png`,
};

/** The ambient scene backdrop shared by the VN sky, start menu, and loader. */
export const BACKGROUND_ART = `${MASCOT_BASE}/background.png`;

/** Every mascot/scene asset, handy for preloaders. */
export const ALL_MASCOT_ART: readonly string[] = [
  BACKGROUND_ART,
  ...Object.values(EMOTION_ART),
];
