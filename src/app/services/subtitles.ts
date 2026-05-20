/**
 * Subtitle cue management.
 *
 * Converts external subtitle files (SRT / VTT / ASS) and MKV embedded subtitle
 * packets into a unified internal cue format. The overlay renderer consumes
 * this format so it doesn't need to know the original source.
 */

export interface SubCue {
  id: string;
  start: number; // seconds
  end: number;   // seconds
  text: string;
  styles?: SubStyles;
}

/**
 * Module-level empty cue array — shared so consumers that compute
 * `tracks.find(...)?.cues ?? EMPTY_CUES` don't allocate a new array on every
 * render, which would invalidate downstream memos on the subtitle hot path.
 */
export const EMPTY_CUES: readonly SubCue[] = Object.freeze([]);

const LANG_LABELS: Record<string, string> = {
  en: "English",
  vi: "Tiếng Việt",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
  th: "ไทย",
  id: "Bahasa Indonesia",
};

/** Map ISO language code → native label; falls back to UPPERCASE(code). */
export function prettyLangLabel(code: string, _filename?: string): string {
  return LANG_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}

/** Detect a 2/3-letter language code from "Movie.en.srt" / "Movie.vi.ass". */
export function detectLang(filename: string): string {
  const m = filename.match(/\.([a-z]{2,3})\.(srt|vtt|ass|ssa)$/i);
  return m ? m[1].toLowerCase() : "und";
}

export interface SubStyles {
  color?: string;
  fontSize?: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  linePosition?: number; // 0-100 % from top
}

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

export function parseSrt(source: string): SubCue[] {
  const cues: SubCue[] = [];
  const blocks = source
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    // First line may be cue number; skip it.
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx++;
    const timeLine = lines[idx]?.trim() ?? "";
    const text = lines.slice(idx + 1).join("\n").trim();
    if (!timeLine || !text) continue;

    const m = timeLine.match(
      /^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    );
    if (!m) continue;

    const start = hmsToSec(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
    const end = hmsToSec(Number(m[5]), Number(m[6]), Number(m[7]), Number(m[8]));
    cues.push({
      id: `${cues.length + 1}`,
      start,
      end,
      text: stripHtmlTags(text).replace(/\n/g, " "),
    });
  }
  return cues;
}

// ---------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------

export function parseVtt(source: string): SubCue[] {
  const cues: SubCue[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  // Skip WEBVTT header
  if (lines[0]?.startsWith("WEBVTT")) i++;
  while (i < lines.length && lines[i].trim() === "") i++;

  while (i < lines.length) {
    // Optional cue ID
    if (lines[i].includes("-->")) {
      // No ID line
    } else {
      i++; // skip ID
    }
    const timeLine = lines[i]?.trim() ?? "";
    i++;
    if (!timeLine.includes("-->")) {
      while (i < lines.length && lines[i].trim() !== "") i++;
      continue;
    }
    const m = timeLine.match(
      /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
    );
    if (!m) {
      while (i < lines.length && lines[i].trim() !== "") i++;
      continue;
    }
    const start = hmsToSec(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
    const end = hmsToSec(Number(m[5]), Number(m[6]), Number(m[7]), Number(m[8]));

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i].trim());
      i++;
    }
    const text = textLines.join(" ").trim();
    if (text) {
      cues.push({
        id: `${cues.length + 1}`,
        start,
        end,
        text: stripHtmlTags(text),
      });
    }
    while (i < lines.length && lines[i].trim() === "") i++;
  }
  return cues;
}

// ---------------------------------------------------------------------------
// ASS / SSA (basic dialogue extraction)
// ---------------------------------------------------------------------------

export function parseAss(source: string): SubCue[] {
  const cues: SubCue[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let counter = 1;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("Dialogue:")) continue;
    const fields = line.slice("Dialogue:".length).split(",");
    if (fields.length < 10) continue;
    const start = assTimeToSec(fields[1].trim());
    const end = assTimeToSec(fields[2].trim());
    const rawText = fields.slice(9).join(",");
    // Drop cues the script itself wants hidden — e.g. fansub "your player
    // doesn't support this" warnings tagged with \alpha&HFF& so libass
    // renders them invisible. Stripping override tags below would otherwise
    // turn that invisible warning into visible text under the CSS overlay.
    if (isAssCueHidden(rawText)) continue;
    const text = stripAssTags(rawText);
    if (!text) continue;
    const styles = extractAssStyles(fields[9]);
    cues.push({
      id: `${counter++}`,
      start,
      end,
      text,
      styles,
    });
  }
  return cues;
}

/**
 * Detect cues that an ASS script has explicitly hidden via override tags.
 * Libass renders these as transparent; the CSS fallback overlay strips
 * overrides wholesale, so without this filter the hidden text shows up as
 * bare visible content. Recognised hide patterns:
 *
 *   - `\alpha&HFF&`               — all four channels fully transparent
 *   - `\1a&HFF&` + `\3a&HFF&`     — fill + border invisible (the two
 *                                    channels that actually carry the glyph)
 *   - `\fade(N, M, …)` with both  — keyframed fade that begins and ends at
 *     N and M ≥ 250                  transparent (i.e. never appears)
 *
 * Note: positional hacks like `\pos(-9999, -9999)` aren't matched here —
 * they're rare in modern fansubs and risk false positives on legitimate
 * off-edge typesetting.
 */
export function isAssCueHidden(text: string): boolean {
  const blocks = text.match(/\{[^}]*\}/g);
  if (!blocks) return false;
  for (const block of blocks) {
    if (/\\alpha\s*&H[fF][fF]&/.test(block)) return true;
    const a1 = /\\1a\s*&H[fF][fF]&/.test(block);
    const a3 = /\\3a\s*&H[fF][fF]&/.test(block);
    if (a1 && a3) return true;
    const fade = block.match(/\\fade\(\s*(\d+)\s*,\s*(\d+)\s*,/);
    if (fade && Number(fade[1]) >= 250 && Number(fade[2]) >= 250) return true;
  }
  return false;
}

/**
 * Strip ASS/SSA override tags from a raw Dialogue text field, leaving only
 * the renderable plain text. The CSS fallback overlay consumes the output —
 * libass / JASSUB reads the raw script directly and never sees this.
 *
 * Handles the awkward cases that show up in real fansub scripts:
 *
 *   1. **Drawing mode** (`{\p1}m 0 0 l 100 100 b ...{\p0}` for typeset
 *      signs and ribbons). Without special handling, the inner brace strip
 *      would leave the bare path commands behind and the CSS overlay would
 *      render `m 936 690 l 997 691 1003 723 ...` as plain text on screen
 *      (which is what users saw in the Tonari no Alya BD release — the OP
 *      title card uses drawing-mode masks). We snip the entire
 *      `{\p1}…{\p0}` (or `{\p1}…EOL`) range first so no path data survives.
 *
 *   2. **Well-formed override blocks** (`{\b1}`, `{\an8}`, `{\c&H...&}`)
 *      stripped by the simple `\{[^{}]*\}` pass.
 *
 *   3. **Sliced overrides** at the field boundaries when a comma inside
 *      `\pos(x,y)` or `\fade(0,0,400,…)` mis-split the Dialogue row.
 *
 *   4. **ASS line-break escapes** (`\N`, `\n`, `\h`) converted to renderable
 *      whitespace.
 */
export function stripAssTags(text: string): string {
  let out = text;
  // 1. Drawing-mode sections come first — once `{\p1}` is stripped, the
  //    path data behind it (`m 936 690 l 997 691 …`) is indistinguishable
  //    from real dialogue. Match `{...\pN...}` where N ≥ 1, then everything
  //    up to either a closing `{\p0}` or EOL.
  out = out.replace(
    /\{[^{}]*\\p[1-9]\d*[^{}]*\}[\s\S]*?(?:\{[^{}]*\\p0[^{}]*\}|$)/g,
    "",
  );
  // 2. Well-formed { ... } override blocks.
  out = out.replace(/\{[^{}]*\}/g, "");
  // 3. Sliced-override cleanups.
  out = out.replace(/^[^{}]*?\\[a-zA-Z][^{}]*\}/, "");
  out = out.replace(/\{[^{}]*$/, "");
  return out
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\h/g, " ")
    .trim();
}

function extractAssStyles(textField: string): SubStyles | undefined {
  const styles: SubStyles = {};
  const colorMatch = textField.match(/\\c&H([0-9A-Fa-f]{6})&/);
  if (colorMatch) {
    // ASS stores BBGGRR
    const bbggrr = colorMatch[1];
    const r = bbggrr.slice(4, 6);
    const g = bbggrr.slice(2, 4);
    const b = bbggrr.slice(0, 2);
    styles.color = `#${r}${g}${b}`;
  }
  if (/\\i1/.test(textField)) styles.italic = true;
  if (/\\b1/.test(textField)) styles.bold = true;
  if (/\\u1/.test(textField)) styles.underline = true;
  // Honor explicit \an positioning so the CSS overlay can at least show
  // top vs. bottom and align left/center/right while JASSUB is booting.
  // libass on the JASSUB path re-parses the raw script anyway, so this
  // costs nothing there.
  const anMatch = textField.match(/\\an([1-9])/);
  if (anMatch) {
    const placement = alignmentToPlacement(parseInt(anMatch[1], 10));
    if (placement) {
      styles.align = placement.align;
      styles.linePosition = placement.linePosition;
    }
  }
  // \pos(x, y) — y is interpreted relative to PlayResY=1080 (the default the
  // synthesised header uses); fansub scripts may declare a different PlayResY
  // but the relative band (top / mid / bottom) is what the CSS overlay needs.
  const posMatch = textField.match(/\\pos\(\s*[-\d.]+\s*,\s*([-\d.]+)\s*\)/);
  if (posMatch) {
    const y = parseFloat(posMatch[1]);
    if (!Number.isNaN(y)) {
      styles.linePosition = Math.max(0, Math.min(100, (y / 1080) * 100));
    }
  }
  return Object.keys(styles).length > 0 ? styles : undefined;
}

/**
 * Map an ASS `\an{N}` / Style.Alignment value to a CSS-friendly placement.
 *
 *   1 bottom-left   2 bottom-center  3 bottom-right
 *   4 middle-left   5 middle-center  6 middle-right
 *   7 top-left      8 top-center     9 top-right
 */
export function alignmentToPlacement(
  n: number,
): { align: "left" | "center" | "right"; linePosition: number } | null {
  if (!Number.isFinite(n) || n < 1 || n > 9) return null;
  const horizontal = ((n - 1) % 3) as 0 | 1 | 2;
  const vertical = Math.floor((n - 1) / 3); // 0 bottom, 1 middle, 2 top
  const align: "left" | "center" | "right" =
    horizontal === 0 ? "left" : horizontal === 1 ? "center" : "right";
  const linePosition = vertical === 2 ? 10 : vertical === 1 ? 50 : 90;
  return { align, linePosition };
}

/**
 * Family name JASSUB registers the bundled fallback woff2 under. Kept in
 * sync with `BUNDLED_FONT_FAMILY` in JassubOverlay.tsx — rewriting every
 * Style.Fontname column to this exact value short-circuits libass's font
 * lookup so it never fans out to the OS font catalogue or Google Fonts.
 */
export const BUNDLED_ASS_FONT_FAMILY = "liberation sans";

/**
 * Rewrite Fontname references in an ASS/SSA script header to the single
 * bundled fallback face JASSUB ships with.
 *
 * Why: Nyrima intentionally does not load arbitrary fonts (no `queryFonts:
 * "local"`, no attachment mounting). When the script references a Fontname
 * the user doesn't have, libass would otherwise spend startup querying for
 * the missing face. Forcing every Fontname to the bundled family lets libass
 * resolve on the first try while every other style attribute (color, bold,
 * italic, alignment, outline, karaoke) survives untouched.
 *
 * Only the `Fontname` column in `[V4 Styles]` / `[V4+ Styles]` Style rows is
 * rewritten. Per-cue `\fn` overrides and Fontsize are left alone — we still
 * honor sizing decisions even when we can't honor the typeface choice.
 */
export function stripAssFontReferences(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let section: "styles" | "other" = "other";
  let stylesFormat: string[] = [];
  let stylesFontIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^\[V4\+?\s*Styles\]$/i.test(trimmed)) {
      section = "styles";
      stylesFormat = [];
      stylesFontIdx = -1;
      continue;
    }
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      section = "other";
      continue;
    }
    if (section === "styles" && /^Format\s*:/i.test(trimmed)) {
      stylesFormat = trimmed
        .slice(trimmed.indexOf(":") + 1)
        .split(",")
        .map((s) => s.trim().toLowerCase());
      stylesFontIdx = stylesFormat.indexOf("fontname");
      continue;
    }
    if (
      section === "styles" &&
      stylesFontIdx >= 0 &&
      /^Style\s*:/i.test(trimmed)
    ) {
      const colonAt = lines[i].indexOf(":");
      const head = lines[i].slice(0, colonAt + 1);
      const fields = lines[i].slice(colonAt + 1).split(",");
      if (stylesFontIdx < fields.length) {
        const leading = fields[stylesFontIdx].match(/^\s*/)?.[0] ?? "";
        fields[stylesFontIdx] = `${leading}${BUNDLED_ASS_FONT_FAMILY}`;
        lines[i] = `${head}${fields.join(",")}`;
      }
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// ASS post-processing — force-center dialogue
// ---------------------------------------------------------------------------

/**
 * Rewrite an ASS/SSA source so dialogue is forced to bottom-center alignment.
 *
 * Why: the user prefers all dialogue centered in the Nyrima player, even when
 * fansub scripts pin lines to the left or right via `\an1` / `\an4` / `\an7`.
 *
 * What we touch:
 *   - In `[V4 Styles]` / `[V4+ Styles]`: every dialogue-flavored Style row
 *     (named `Default`, `Dialogue`, `Main`, `Alt`, `Sub`, …) has its
 *     `Alignment` column forced to `2` (bottom-center).
 *   - In `[Events]`: every Dialogue row whose Text DOES NOT contain `\pos(`
 *     or `\move(` (i.e. flowing dialogue, not a positioned sign) has any
 *     `\an{1,3,4,6,7,9}` rewritten to `\an{2,5,8}` — preserving the vertical
 *     band (bottom / middle / top) while collapsing the horizontal anchor
 *     to center.
 *
 * What we deliberately leave alone:
 *   - Positioned signs (typeset titles, episode credits, on-screen labels).
 *     Anything with `\pos`/`\move` relies on a specific alignment anchor and
 *     would shift visually if we centered it.
 *   - Non-dialogue Style rows (Sign, Title, Karaoke, …). These exist so the
 *     typesetters can anchor signs precisely; rewriting them would move signs.
 */
export function forceCenterDialogueInAss(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = new Array(lines.length);

  let section: "styles" | "events" | "other" = "other";
  let stylesFormat: string[] = [];
  let stylesNameIdx = -1;
  let stylesAlignIdx = -1;
  let eventsFormat: string[] = [];
  let eventsTextIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^\[V4\+?\s*Styles\]$/i.test(trimmed)) {
      section = "styles";
      stylesFormat = [];
      stylesNameIdx = -1;
      stylesAlignIdx = -1;
      out[i] = line;
      continue;
    }
    if (/^\[Events\]$/i.test(trimmed)) {
      section = "events";
      eventsFormat = [];
      eventsTextIdx = -1;
      out[i] = line;
      continue;
    }
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      section = "other";
      out[i] = line;
      continue;
    }

    if (section === "styles" && /^Format\s*:/i.test(trimmed)) {
      stylesFormat = trimmed
        .slice(trimmed.indexOf(":") + 1)
        .split(",")
        .map((s) => s.trim().toLowerCase());
      stylesNameIdx = stylesFormat.indexOf("name");
      stylesAlignIdx = stylesFormat.indexOf("alignment");
      out[i] = line;
      continue;
    }
    if (
      section === "styles" &&
      stylesAlignIdx >= 0 &&
      /^Style\s*:/i.test(trimmed)
    ) {
      const colonAt = trimmed.indexOf(":");
      const fields = trimmed.slice(colonAt + 1).split(",");
      const name =
        stylesNameIdx >= 0 && stylesNameIdx < fields.length
          ? fields[stylesNameIdx].trim()
          : "";
      if (isDialogueStyleName(name) && stylesAlignIdx < fields.length) {
        fields[stylesAlignIdx] = "2";
      }
      out[i] = `Style: ${fields.join(",")}`;
      continue;
    }

    if (section === "events" && /^Format\s*:/i.test(trimmed)) {
      eventsFormat = trimmed
        .slice(trimmed.indexOf(":") + 1)
        .split(",")
        .map((s) => s.trim().toLowerCase());
      eventsTextIdx = eventsFormat.indexOf("text");
      out[i] = line;
      continue;
    }
    if (
      section === "events" &&
      eventsTextIdx >= 0 &&
      /^Dialogue\s*:/i.test(trimmed)
    ) {
      const colonAt = trimmed.indexOf(":");
      const body = trimmed.slice(colonAt + 1);
      const parts = body.split(",");
      if (parts.length > eventsTextIdx) {
        const head = parts.slice(0, eventsTextIdx);
        const text = parts.slice(eventsTextIdx).join(",");
        out[i] = `Dialogue: ${head.join(",")},${centerAnInDialogueText(text)}`;
        continue;
      }
    }

    out[i] = line;
  }
  return out.join("\n");
}

function isDialogueStyleName(name: string): boolean {
  // Style names that fansubs use for flowing dialogue. Conservative on purpose:
  // anything outside this list (Sign, Title, Karaoke, Credits, OP/ED, Note, …)
  // is left untouched so positioned typesetting stays put.
  if (!name) return true; // unnamed → assume dialogue
  return /^(default|dialogue|dialog|main|alt|sub|line|talk|narration)\b/i.test(
    name,
  );
}

/**
 * Rewrite `\an{1,3,4,6,7,9}` → `\an{2,5,8}` inside a Dialogue Text field,
 * but only when the text doesn't pin its position via `\pos(` / `\move(`.
 *
 * Mapping preserves the vertical band:
 *   bottom-left (1)  → bottom-center (2)
 *   bottom-right (3) → bottom-center (2)
 *   middle-left (4)  → middle-center (5)
 *   middle-right (6) → middle-center (5)
 *   top-left (7)     → top-center (8)
 *   top-right (9)    → top-center (8)
 */
function centerAnInDialogueText(text: string): string {
  if (/\\pos\s*\(/.test(text) || /\\move\s*\(/.test(text)) return text;
  return text.replace(/\\an([1-9])/g, (_, n: string) => {
    switch (n) {
      case "1":
      case "3":
        return "\\an2";
      case "4":
      case "6":
        return "\\an5";
      case "7":
      case "9":
        return "\\an8";
      default:
        return `\\an${n}`;
    }
  });
}

// ---------------------------------------------------------------------------
// Generic dispatch
// ---------------------------------------------------------------------------

export function parseSubtitles(content: string, ext: string): SubCue[] {
  switch (ext.toLowerCase()) {
    case "srt":
      return parseSrt(content);
    case "vtt":
      return parseVtt(content);
    case "ass":
    case "ssa":
      return parseAss(content);
    default:
      // Try SRT first, then VTT
      const srt = parseSrt(content);
      if (srt.length > 0) return srt;
      return parseVtt(content);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hmsToSec(h: number, m: number, s: number, ms: number): number {
  return h * 3600 + m * 60 + s + ms / 1000;
}

function assTimeToSec(t: string): number {
  const m = t.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) return 0;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const s = Number(m[3]);
  const cs = Number(m[4]);
  return h * 3600 + mm * 60 + s + cs / 100;
}

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}
