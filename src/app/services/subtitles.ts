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
    const text = fields
      .slice(9)
      .join(",")
      .replace(/\\N/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\{[^}]*\}/g, "")
      .trim();
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

function extractAssStyles(textField: string): SubStyles | undefined {
  // Very basic: look for {\c&HBBGGRR&} color tags and {\i1} italic
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
  if (/\\an[1-3]/.test(textField)) styles.align = "left";
  if (/\\an[4-6]/.test(textField)) styles.align = "center";
  if (/\\an[7-9]/.test(textField)) styles.align = "right";
  return Object.keys(styles).length > 0 ? styles : undefined;
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
