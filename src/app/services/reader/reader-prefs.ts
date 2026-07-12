/**
 * Reader typography + theme preferences.
 *
 * One global preference set is applied to every book — the user tunes the
 * reading experience once and it follows them. Catalogs (themes, fonts) and
 * the numeric ranges live here so the sidebar controls and the rendered page
 * agree on a single source of truth.
 */

// Three dark themes + three light. Nyrima is dark-mode-first, so the default
// is a soft charcoal "Dark"; the calm cream/paper look is offered as a light
// option for daytime reading.
export type ReaderThemeId =
  | "midnight"
  | "dark"
  | "slate"
  | "light"
  | "cream"
  | "sepia";
export type ReaderMode = "scroll" | "paged";
export type ReaderParagraphStyle = "spaced" | "indented";
export type ReaderFontWeight = 400 | 700;

export interface ReaderPrefs {
  theme: ReaderThemeId;
  /** Key into FONT_CATALOG. */
  fontFamily: string;
  /** Body font size in px. */
  fontSize: number;
  /** Body font weight. */
  fontWeight: ReaderFontWeight;
  /** Unitless line-height multiplier. */
  lineHeight: number;
  /** Space between paragraphs, in em. */
  paragraphSpacing: number;
  /** Paragraph rhythm: blank-line spaced vs. first-line indent (LN-style). */
  paragraphStyle: ReaderParagraphStyle;
  /** Max width of the reading column, in px. */
  pageWidth: number;
  /** Horizontal breathing room inside the column, in px ("margin density"). */
  margin: number;
  /** Justify body text vs. left-align. */
  justify: boolean;
  /** Comfort dim — 0.6 (dimmest) … 1 (full). */
  brightness: number;
  /** Continuous scroll vs. column-paged reading. */
  mode: ReaderMode;
  /** Soften bright illustrations on dark themes for night comfort. */
  dimImages: boolean;
  /** Dim every paragraph except the one near the centre of the view. */
  focusMode: boolean;
}

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  theme: "dark",
  fontFamily: "lora",
  fontSize: 20,
  fontWeight: 400,
  lineHeight: 1.75,
  paragraphSpacing: 0.9,
  paragraphStyle: "spaced",
  pageWidth: 880,
  margin: 32,
  justify: false,
  brightness: 1,
  mode: "scroll",
  dimImages: true,
  focusMode: false,
};

export interface ReaderThemeDef {
  id: ReaderThemeId;
  label: string;
  /** Page (reading surface) background. */
  page: string;
  /** Body text color. */
  text: string;
  /** Muted text (meta, captions). */
  muted: string;
  /** Hairline divider color. */
  border: string;
  /** Accent used for the slim progress + active states. */
  accent: string;
  /** Whether the chrome should adopt a dark tone for this theme. */
  dark: boolean;
}

export const READER_THEMES: ReaderThemeDef[] = [
  // --- Dark family (Nyrima is dark-first) ---------------------------------
  {
    id: "dark",
    label: "Dark",
    // Soft warm charcoal — ink-on-paper feel inverted. Warm gold accent keeps
    // it calm rather than clinical-blue.
    page: "#17181b",
    text: "#dad6cd",
    muted: "#8b877e",
    border: "#2b2c31",
    accent: "#c9a26a",
    dark: true,
  },
  {
    id: "midnight",
    label: "Midnight",
    // Near-black for OLED panels and late-night reading; text dimmed slightly
    // so it doesn't glare on true black.
    page: "#0a0a0c",
    text: "#cdc9c0",
    muted: "#7c7870",
    border: "#1f2024",
    accent: "#caa46d",
    dark: true,
  },
  {
    id: "slate",
    label: "Slate",
    // Cool blue-gray dark for readers who find warm darks muddy.
    page: "#1a1f26",
    text: "#ccd3db",
    muted: "#808a96",
    border: "#2a313b",
    accent: "#7fa8c9",
    dark: true,
  },
  // --- Light family --------------------------------------------------------
  {
    id: "cream",
    label: "Cream",
    page: "#f6efe1",
    text: "#3a3022",
    muted: "#8a7c63",
    border: "#e3d7c0",
    accent: "#b07d48",
    dark: false,
  },
  {
    id: "light",
    label: "Light",
    page: "#ffffff",
    text: "#1d1d1f",
    muted: "#6b6b70",
    border: "#e7e7ea",
    accent: "#b07d48",
    dark: false,
  },
  {
    id: "sepia",
    label: "Sepia",
    page: "#eadcc3",
    text: "#433521",
    muted: "#8a7550",
    border: "#d6c4a3",
    accent: "#a26b3a",
    dark: false,
  },
];

/** Theme ids grouped for the swatch picker. */
export const DARK_THEME_IDS: ReaderThemeId[] = ["dark", "midnight", "slate"];
export const LIGHT_THEME_IDS: ReaderThemeId[] = ["cream", "light", "sepia"];

export const FONT_WEIGHTS: Array<{ value: ReaderFontWeight; label: string }> = [
  { value: 400, label: "Regular" },
  { value: 700, label: "Bold" },
];

/** Highlight palette. `id` is persisted; `value` drives the mark background. */
export const HIGHLIGHT_COLORS: Array<{ id: string; label: string; value: string }> = [
  { id: "yellow", label: "Yellow", value: "#f4c64a" },
  { id: "green", label: "Green", value: "#76c98a" },
  { id: "pink", label: "Pink", value: "#f08bb4" },
  { id: "blue", label: "Blue", value: "#6db4f0" },
];

export interface ReaderFontDef {
  id: string;
  label: string;
  /** CSS font-family stack. CJK fallbacks are appended for Japanese LNs. */
  stack: string;
  kind: "serif" | "sans";
}

// Every face below covers the Latin + Vietnamese ranges (Times New Roman via
// the OS; the rest ship `vietnamese` subsets through @fontsource — see
// reader-fonts.ts). Fallbacks stay within the same style family so a missing
// glyph degrades gracefully without breaking Vietnamese diacritics.
const SERIF_FALLBACK = `Georgia, "Times New Roman", serif`;
const SANS_FALLBACK = `system-ui, -apple-system, "Segoe UI", sans-serif`;

export const FONT_CATALOG: ReaderFontDef[] = [
  {
    id: "times",
    label: "Times New Roman",
    stack: `"Times New Roman", Tinos, ${SERIF_FALLBACK}`,
    kind: "serif",
  },
  {
    id: "merriweather",
    label: "Merriweather",
    stack: `"Merriweather", ${SERIF_FALLBACK}`,
    kind: "serif",
  },
  {
    id: "lora",
    label: "Lora",
    stack: `"Lora", ${SERIF_FALLBACK}`,
    kind: "serif",
  },
  {
    id: "roboto",
    label: "Roboto",
    stack: `"Roboto", ${SANS_FALLBACK}`,
    kind: "sans",
  },
  {
    id: "noto-sans",
    label: "Noto Sans",
    stack: `"Noto Sans", ${SANS_FALLBACK}`,
    kind: "sans",
  },
  {
    id: "nunito",
    label: "Nunito",
    stack: `"Nunito", ${SANS_FALLBACK}`,
    kind: "sans",
  },
];

export function fontStack(id: string): string {
  return (FONT_CATALOG.find((f) => f.id === id) ?? FONT_CATALOG[0]!).stack;
}

export function readerTheme(id: ReaderThemeId): ReaderThemeDef {
  return (
    READER_THEMES.find((t) => t.id === id) ??
    READER_THEMES.find((t) => t.id === DEFAULT_READER_PREFS.theme) ??
    READER_THEMES[0]!
  );
}

// --- Numeric bounds (shared by sidebar steppers + sanitizers) --------------

export const FONT_SIZE_RANGE = { min: 14, max: 32, step: 1 } as const;
export const LINE_HEIGHT_RANGE = { min: 1.3, max: 2.2, step: 0.05 } as const;
export const PARAGRAPH_SPACING_RANGE = { min: 0, max: 2, step: 0.1 } as const;
export const PAGE_WIDTH_RANGE = { min: 560, max: 1280, step: 20 } as const;
export const MARGIN_RANGE = { min: 0, max: 120, step: 8 } as const;
export const BRIGHTNESS_RANGE = { min: 0.6, max: 1, step: 0.02 } as const;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

const VALID_WEIGHTS: ReaderFontWeight[] = [400, 700];

/** Coerce a stored/partial prefs blob into a valid, fully-populated set. */
export function normalizeReaderPrefs(input: Partial<ReaderPrefs> | undefined): ReaderPrefs {
  const p = { ...DEFAULT_READER_PREFS, ...(input ?? {}) };
  return {
    theme: READER_THEMES.some((t) => t.id === p.theme) ? p.theme : DEFAULT_READER_PREFS.theme,
    fontFamily: FONT_CATALOG.some((f) => f.id === p.fontFamily)
      ? p.fontFamily
      : DEFAULT_READER_PREFS.fontFamily,
    fontSize: clamp(p.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max),
    fontWeight: VALID_WEIGHTS.includes(p.fontWeight)
      ? p.fontWeight
      : DEFAULT_READER_PREFS.fontWeight,
    lineHeight: clamp(p.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max),
    paragraphSpacing: clamp(
      p.paragraphSpacing,
      PARAGRAPH_SPACING_RANGE.min,
      PARAGRAPH_SPACING_RANGE.max,
    ),
    paragraphStyle: p.paragraphStyle === "indented" ? "indented" : "spaced",
    pageWidth: clamp(p.pageWidth, PAGE_WIDTH_RANGE.min, PAGE_WIDTH_RANGE.max),
    margin: clamp(p.margin, MARGIN_RANGE.min, MARGIN_RANGE.max),
    justify: !!p.justify,
    brightness: clamp(p.brightness, BRIGHTNESS_RANGE.min, BRIGHTNESS_RANGE.max),
    mode: p.mode === "paged" ? "paged" : "scroll",
    dimImages: p.dimImages !== false,
    focusMode: !!p.focusMode,
  };
}
