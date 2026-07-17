/**
 * Per-block font catalog for posts. Lives outside both `editor/` and
 * `renderer/` since both sides need it: the editor's Block inspector picks
 * a font, the renderer (and the editor's own live preview) apply it. Only
 * always-loaded font families are listed here — the Light-Novel reader's
 * lazy-loaded fonts (Merriweather, Lora, etc.) stay behind that route's own
 * bundle and must never leak into the posts path.
 */

export interface PostFontOption {
  id: string;
  label: string;
  stack: string;
}

export const POST_FONT_CATALOG: PostFontOption[] = [
  { id: "display", label: "Display", stack: "var(--dc-font-display)" },
  { id: "mono", label: "Mono", stack: "var(--dc-font-mono)" },
  { id: "kana", label: "Rounded", stack: "var(--dc-font-kana)" },
  { id: "asap", label: "Asap", stack: '"Asap", var(--dc-font-body)' },
  { id: "cascadia", label: "Cascadia Mono", stack: '"Cascadia Mono", var(--dc-font-mono)' },
];

export const POST_FONT_IDS = new Set(POST_FONT_CATALOG.map((f) => f.id));

export function fontStackFor(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return POST_FONT_CATALOG.find((f) => f.id === id)?.stack;
}

export const POST_FONT_SIZE_RANGE = { min: 14, max: 32, step: 1 } as const;

export interface PostBlockFont {
  family?: string;
  size?: number;
}
