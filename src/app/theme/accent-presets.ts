/**
 * Accent presets — user-selectable "lamp" colors for the whole app.
 *
 * anime-theme.scss hand-tunes the default neon-pink `--brand-*` family per
 * theme. A non-default preset re-derives that family from a small set of
 * authored hexes and injects it as a `<style id="ny-accent-override">` tag at
 * the end of <head>, with one block per theme, so it wins the cascade over
 * the stylesheet without touching inline styles. Picking the default preset
 * removes the tag entirely — zero drift from the hand-tuned values.
 *
 * Each preset authors four hexes per theme (matching the roles the stylesheet
 * gives them); every alpha/border variant is derived at apply time.
 */

export interface AccentThemeColors {
  /** --brand-solid-strong / --brand-background-strong — the lamp itself. */
  solid: string;
  /** --brand-solid-medium — one step toward the theme's mid tone. */
  solidMedium: string;
  /** --brand-solid-weak — the deepest step. */
  solidWeak: string;
  /** --brand-on-background-strong — readable text/hover tint on the page. */
  onBackgroundStrong: string;
}

export interface AccentPreset {
  id: string;
  label: string;
  /** Swatch shown in the picker (the dark-theme solid). */
  swatch: string;
  dark: AccentThemeColors;
  light: AccentThemeColors;
}

export const DEFAULT_ACCENT_PRESET = "nyrima-pink";

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: "nyrima-pink",
    label: "Nyrima Pink",
    swatch: "#ff4fd8",
    // Values mirror anime-theme.scss; never injected (default removes the tag).
    dark: {
      solid: "#ff4fd8",
      solidMedium: "#d946ef",
      solidWeak: "#a21caf",
      onBackgroundStrong: "#ff9bea",
    },
    light: {
      solid: "#d6149a",
      solidMedium: "#c0179e",
      solidWeak: "#a3128a",
      onBackgroundStrong: "#b0179a",
    },
  },
  {
    id: "violet",
    label: "Violet",
    swatch: "#a78bfa",
    dark: {
      solid: "#a78bfa",
      solidMedium: "#8b5cf6",
      solidWeak: "#6d28d9",
      onBackgroundStrong: "#c4b5fd",
    },
    light: {
      solid: "#7c3aed",
      solidMedium: "#6d28d9",
      solidWeak: "#5b21b6",
      onBackgroundStrong: "#6d28d9",
    },
  },
  {
    id: "cyan",
    label: "Cyan",
    swatch: "#22d3ee",
    dark: {
      solid: "#22d3ee",
      solidMedium: "#06b6d4",
      solidWeak: "#0e7490",
      onBackgroundStrong: "#67e8f9",
    },
    light: {
      solid: "#0891b2",
      solidMedium: "#0e7490",
      solidWeak: "#155e75",
      onBackgroundStrong: "#0e7490",
    },
  },
  {
    id: "amber",
    label: "Amber",
    swatch: "#fbbf24",
    dark: {
      solid: "#fbbf24",
      solidMedium: "#f59e0b",
      solidWeak: "#b45309",
      onBackgroundStrong: "#fcd34d",
    },
    light: {
      solid: "#d97706",
      solidMedium: "#b45309",
      solidWeak: "#92400e",
      onBackgroundStrong: "#b45309",
    },
  },
  {
    id: "crimson",
    label: "Crimson",
    swatch: "#fb7185",
    dark: {
      solid: "#fb7185",
      solidMedium: "#f43f5e",
      solidWeak: "#be123c",
      onBackgroundStrong: "#fda4af",
    },
    light: {
      solid: "#e11d48",
      solidMedium: "#be123c",
      solidWeak: "#9f1239",
      onBackgroundStrong: "#be123c",
    },
  },
  {
    id: "emerald",
    label: "Emerald",
    swatch: "#34d399",
    dark: {
      solid: "#34d399",
      solidMedium: "#10b981",
      solidWeak: "#047857",
      onBackgroundStrong: "#6ee7b7",
    },
    light: {
      solid: "#059669",
      solidMedium: "#047857",
      solidWeak: "#065f46",
      onBackgroundStrong: "#047857",
    },
  },
];

export function getAccentPreset(id: string): AccentPreset {
  return ACCENT_PRESETS.find((p) => p.id === id) ?? ACCENT_PRESETS[0];
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Builds the CSS declarations for one theme's brand family. Alpha steps
 *  mirror anime-theme.scss's dark/light ratios closely enough for both. */
function brandBlock(c: AccentThemeColors, dark: boolean): string {
  const onBg = dark ? "#07090f" : "#fdf7fc";
  return [
    `--brand-on-background-strong: ${c.onBackgroundStrong};`,
    `--brand-on-background-medium: ${c.solid};`,
    `--brand-on-background-weak: ${c.solidMedium};`,
    `--brand-on-solid-strong: ${onBg};`,
    `--brand-background-strong: ${c.solid};`,
    `--brand-background-medium: ${c.solidMedium};`,
    `--brand-background-weak: ${c.solidWeak};`,
    `--brand-solid-strong: ${c.solid};`,
    `--brand-solid-medium: ${c.solidMedium};`,
    `--brand-solid-weak: ${c.solidWeak};`,
    `--brand-alpha-strong: ${hexToRgba(c.solid, dark ? 0.28 : 0.24)};`,
    `--brand-alpha-medium: ${hexToRgba(c.solid, dark ? 0.14 : 0.12)};`,
    `--brand-alpha-weak: ${hexToRgba(c.solid, dark ? 0.07 : 0.06)};`,
    `--brand-border-strong: ${hexToRgba(c.solid, dark ? 0.36 : 0.3)};`,
    `--brand-border-medium: ${hexToRgba(c.solid, dark ? 0.18 : 0.16)};`,
    `--brand-border-weak: ${hexToRgba(c.solid, dark ? 0.1 : 0.08)};`,
    // Legacy aliases that hard-code the pink in the stylesheet.
    `--dc-gold: ${c.solid};`,
    `--dc-gold-soft: ${c.onBackgroundStrong};`,
    `--dc-sakura: ${c.solid};`,
    `--hairline-pink: ${hexToRgba(c.solid, dark ? 0.28 : 0.24)};`,
  ].join("\n  ");
}

const OVERRIDE_TAG_ID = "ny-accent-override";

/** Injects (or removes, for the default) the accent override style tag. */
export function applyAccentPreset(presetId: string): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(OVERRIDE_TAG_ID);
  if (presetId === DEFAULT_ACCENT_PRESET) {
    existing?.remove();
    return;
  }
  const preset = getAccentPreset(presetId);
  const css = [
    `:root[data-theme="dark"] {\n  ${brandBlock(preset.dark, true)}\n}`,
    `:root[data-theme="light"],\n:root:not([data-theme="dark"]) {\n  ${brandBlock(preset.light, false)}\n}`,
  ].join("\n\n");
  const tag = existing ?? document.createElement("style");
  tag.id = OVERRIDE_TAG_ID;
  tag.textContent = css;
  // Append (or re-append) at the very end of <head> so the override always
  // wins the cascade over the bundled stylesheet, even after HMR reorders.
  document.head.appendChild(tag);
}
