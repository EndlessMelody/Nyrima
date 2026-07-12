/**
 * Shared types + helpers for the watch-room (anime/movie player) chrome.
 *
 * Watch tuning maps to *real* effects on the <video> element:
 *   - brightness / contrast / saturation  → GPU-cheap CSS filter functions
 *   - gamma                               → an inline SVG feComponentTransfer
 *   - sharpness                           → an inline SVG feConvolveMatrix
 *   - warmth (temperature)                → an inline SVG feColorMatrix
 *     (the last three are applied via `url(#…)` filter references the page
 *      renders once)
 */

export interface WatchTuning {
  /** Percent, 100 = neutral. */
  brightness: number;
  /** Percent, 100 = neutral. */
  contrast: number;
  /** Percent, 100 = neutral. */
  saturation: number;
  /** SVG gamma exponent, 1 = neutral. */
  gamma: number;
  /** Unsharp-mask amount, 0 = none .. 100 = strong. */
  sharpness: number;
  /** Color temperature, −100 (cool/blue) .. 0 (neutral) .. +100 (warm/orange). */
  warmth: number;
}

export type TuningPreset =
  | "Cinema"
  | "Night"
  | "Dialogue Boost"
  | "Fansub Focus"
  | "Casual Watch"
  | "Custom";

/** No enhancement — the reset target. */
export const NEUTRAL_TUNING: WatchTuning = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  gamma: 1,
  sharpness: 0,
  warmth: 0,
};

/** Ids used by the inline SVG filters the page renders once. */
export const WATCH_GAMMA_FILTER_ID = "ny-watch-gamma";
export const WATCH_SHARPEN_FILTER_ID = "ny-watch-sharpen";
export const WATCH_WARMTH_FILTER_ID = "ny-watch-warmth";

export const TUNING_PRESETS: Record<
  Exclude<TuningPreset, "Custom">,
  WatchTuning
> = {
  Cinema: {
    brightness: 96,
    contrast: 110,
    saturation: 108,
    gamma: 1.05,
    sharpness: 15,
    warmth: 8,
  },
  Night: {
    brightness: 82,
    contrast: 96,
    saturation: 90,
    gamma: 1.18,
    sharpness: 0,
    warmth: 14,
  },
  "Dialogue Boost": {
    brightness: 104,
    contrast: 106,
    saturation: 100,
    gamma: 0.98,
    sharpness: 20,
    warmth: 0,
  },
  "Fansub Focus": {
    brightness: 100,
    contrast: 114,
    saturation: 110,
    gamma: 1,
    sharpness: 35,
    warmth: 0,
  },
  "Casual Watch": NEUTRAL_TUNING,
};

export const TUNING_PRESET_ORDER: TuningPreset[] = [
  "Cinema",
  "Night",
  "Dialogue Boost",
  "Fansub Focus",
  "Casual Watch",
  "Custom",
];

export function tuningIsNeutral(t: WatchTuning): boolean {
  return (
    t.brightness === 100 &&
    t.contrast === 100 &&
    t.saturation === 100 &&
    Math.abs(t.gamma - 1) < 0.001 &&
    t.sharpness === 0 &&
    t.warmth === 0
  );
}

/** Build the CSS `filter` value for the <video>. Empty string = no filter. */
export function buildVideoFilter(t: WatchTuning): string {
  if (tuningIsNeutral(t)) return "";
  const parts = [
    `brightness(${(t.brightness / 100).toFixed(3)})`,
    `contrast(${(t.contrast / 100).toFixed(3)})`,
    `saturate(${(t.saturation / 100).toFixed(3)})`,
  ];
  if (Math.abs(t.gamma - 1) > 0.001) {
    parts.push(`url(#${WATCH_GAMMA_FILTER_ID})`);
  }
  if (t.warmth !== 0) parts.push(`url(#${WATCH_WARMTH_FILTER_ID})`);
  if (t.sharpness > 0) parts.push(`url(#${WATCH_SHARPEN_FILTER_ID})`);
  return parts.join(" ");
}

/** Match the current tuning to a named preset, else "Custom". */
export function presetForTuning(t: WatchTuning): TuningPreset {
  for (const [name, preset] of Object.entries(TUNING_PRESETS) as [
    Exclude<TuningPreset, "Custom">,
    WatchTuning,
  ][]) {
    if (
      preset.brightness === t.brightness &&
      preset.contrast === t.contrast &&
      preset.saturation === t.saturation &&
      Math.abs(preset.gamma - t.gamma) < 0.001 &&
      preset.sharpness === t.sharpness &&
      preset.warmth === t.warmth
    ) {
      return name;
    }
  }
  return "Custom";
}
