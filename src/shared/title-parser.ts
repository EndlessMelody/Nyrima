/**
 * Folder-aware title parser.
 *
 * The Drive layout under Nyrima is:
 *
 *   Nyrima/
 *     Gimai Seikatsu/
 *       [GS]01.mkv          → "GIMAI SEIKATSU - EP01"
 *       GS OVA.mkv          → "GIMAI SEIKATSU - OVA"
 *     Yahari Ore.../
 *       Kan/
 *         [SubsPlease] Yahari Ore - 03.mkv  → "YAHARI ORE... - KAN - EP03"
 *       Zoku/
 *         …
 *
 * The **folder** is the source of truth for the show name. Filenames vary
 * wildly across release groups, so we never try to recover the show title
 * from `[GS]` or `[SubsPlease]` prefixes. The parser only extracts:
 *
 *   - episode number (if present), OR
 *   - a special tag (OVA / SP / MOVIE / OP / ED / NCOP / NCED), OR
 *   - a cleaned filename fallback when neither matches.
 *
 * Output:
 *   - `fullTitle`   — header shown on the player page
 *   - `shortLabel`  — what the playlist sidebar shows for each entry
 *   - structured fields so other UI surfaces can rebuild their own format
 *
 * This module is pure and free of chrome.* / DOM dependencies so it can be
 * imported from app code, content scripts, and the background worker alike.
 */

export interface ParsedVideoTitle {
  /** Uppercase show name, derived from the show folder. */
  showTitle: string;
  /** Uppercase season label when the video lives inside a recognized season
   *  subfolder (Kan / Zoku / Season 2 / S2 / …). Otherwise undefined. */
  seasonLabel?: string;
  /** Numeric episode, padded to two digits. Undefined when no episode number
   *  was recoverable (movies, specials, OVAs, etc.). */
  episodeNumber?: string;
  /** Detected special tag (OVA / SP / MOVIE / OP / ED / NCOP / NCED). */
  specialTag?: SpecialTag;
  /** Header line for the player page. */
  fullTitle: string;
  /** Short label for playlist rows — show context is already on the page. */
  shortLabel: string;
  /** Cleaned filename (extension + group brackets + scene tags stripped). */
  cleanedFileName: string;
}

export interface TitleParserInput {
  /** Raw video filename including extension. */
  filename: string;
  /** Immediate parent folder name. Should be the **show** folder when the
   *  video lives directly in it, or the **season** folder when nested. */
  parentFolder: string;
  /** The show folder when the video is inside a season subfolder. Leave
   *  undefined when parentFolder IS the show folder. */
  showFolder?: string;
}

export type SpecialTag = "OVA" | "SP" | "MOVIE" | "OP" | "ED" | "NCOP" | "NCED";

// Recognized special tags. Order matters: NCOP/NCED before OP/ED so the
// longer match wins. Detected case-insensitively on word boundaries.
const SPECIAL_TAGS: SpecialTag[] = [
  "NCOP",
  "NCED",
  "OVA",
  "MOVIE",
  "SPECIAL" as unknown as SpecialTag, // mapped → SP below
  "SP",
  "OP",
  "ED",
];

// SCENE/RIP/CODEC junk we strip before looking for episode numbers, so e.g.
// `1080p` doesn't get picked up as episode 1080. Same list the existing
// title-normalizer uses — duplicated here so this module stays standalone.
const NOISE_TOKEN_PATTERNS: RegExp[] = [
  /\[[^\]]+\]/g,
  /\([^)]+\)/g,
  /\b(?:1080p|720p|480p|2160p|4k|hdr|hevc|x265|x264|h\.?264|h\.?265|aac|flac|ac3|dts|atmos|web-?dl|web-?rip|bluray|bd-?rip|hd-?rip|dvd-?rip|remux|10bit|8bit|multi|subbed|dubbed)\b/gi,
];

// Episode-number patterns. First match wins.
const EPISODE_PATTERNS: RegExp[] = [
  /\bS\d{1,2}E(\d{1,3})\b/i,
  /\b(?:episode|ep|epi)[\s._-]*?(\d{1,3})\b/i,
  /\bE(\d{1,3})\b/,
  // Standalone numeric segment preceded by a common separator (incl.
  // `]` and `)` so bracket-prefix styles like `[GS]07` match too).
  /(?:^|[\s\-_.\]\)])(\d{1,3})(?=\s*(?:v\d)?\s*(?:\[|\(|$|\.|\s))/,
];

// Season-subfolder detection.
//
// We treat a folder as a "season" when its name matches one of:
//   - Kan / Zoku / Kai / Ni / San   — common JP suffixes (Yahari Ore Kan etc.)
//   - "Season 2", "S2", "2nd Season"
//   - a bare ordinal: "Season 1", "Part 2"
//
// The check is case-insensitive against the whole folder name (with hyphens
// and underscores normalized to spaces).
const SEASON_PATTERNS: RegExp[] = [
  /^(kan|zoku|kai|ni|san|yon|go|roku)$/i,
  /^s\d{1,2}$/i,
  /^season\s*\d{1,2}$/i,
  /^\d{1,2}(?:st|nd|rd|th)?\s+season$/i,
  /^part\s*\d{1,2}$/i,
  /^cour\s*\d{1,2}$/i,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseTitle(input: TitleParserInput): ParsedVideoTitle {
  const filename = input.filename;
  const parentFolder = (input.parentFolder ?? "").trim();
  const explicitShow = (input.showFolder ?? "").trim();

  // Detect whether parentFolder is itself a season folder.
  const parentIsSeason = isSeasonFolderName(parentFolder);
  const showFolder = explicitShow || (parentIsSeason ? "" : parentFolder);
  const seasonFolder = parentIsSeason ? parentFolder : undefined;

  const showTitle = showFolder ? showFolder.toUpperCase() : "";
  const seasonLabel = seasonFolder ? formatSeason(seasonFolder) : undefined;

  const specialTag = extractSpecialTag(filename);
  const episodeNumber = specialTag ? undefined : extractEpisodeNumber(filename);
  const cleanedFileName = cleanFileName(filename);

  const fullTitle = buildFullTitle({
    showTitle,
    seasonLabel,
    episodeNumber,
    specialTag,
    cleanedFileName,
    filename,
  });
  const shortLabel = buildShortLabel({
    episodeNumber,
    specialTag,
    cleanedFileName,
    filename,
  });

  return {
    showTitle,
    seasonLabel,
    episodeNumber,
    specialTag,
    fullTitle,
    shortLabel,
    cleanedFileName,
  };
}

/** True when the folder name matches a known season-naming convention. */
export function isSeasonFolderName(folderName: string): boolean {
  const norm = folderName.replace(/[._-]+/g, " ").trim();
  return SEASON_PATTERNS.some((re) => re.test(norm));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

// ---------------------------------------------------------------------------
// Filename-only normalization
//
// Used by lobby / player surfaces that need a clean display label from a
// bare filename. `parseTitle` above handles the folder-aware case; this
// one is for the cold-start / movie / suggestion-card path where only a
// filename is in hand.
//
// This block was originally a separate `services/title-normalizer.ts` module
// that drifted out of sync with the parser's regex set. It now lives next
// to `parseTitle` so there's one source of truth for both.
// ---------------------------------------------------------------------------

export interface NormalizedTitle {
  title: string;
  year: number | null;
  quality: string | null;
}

// Scene tags worth stripping for the *movie* normalizer — the wider set
// (REMUX, IMAX, edition flags, etc.) that `parseTitle`'s NOISE_TOKEN_PATTERNS
// doesn't bother with because the parser already extracts a structured
// episode number and doesn't need to clean cosmetic tags.
const MOVIE_SCENE_TAGS = [
  "1080p", "720p", "480p", "2160p", "4k", "4K",
  "x265", "x264", "xvid", "XviD", "XVID",
  "hevc", "HEVC", "avc", "AVC", "h264", "H264", "H.264",
  "aac", "AAC", "ac3", "AC3", "dts", "DTS", "dd5.1", "DD5.1",
  "atmos", "Atmos", "ATMOS",
  "bluray", "BluRay", "BLURAY", "bdrip", "BDRip", "BDRIP",
  "web-dl", "WEB-DL", "webdl", "WEBDL",
  "webrip", "WEBRip", "WEBRIP",
  "hdrip", "HDRip", "HDRIP",
  "dvdrip", "DVDRip", "DVDRIP",
  "remux", "Remux", "REMUX",
  "extended", "EXTENDED", "unrated", "UNRATED",
  "directors cut", "director's cut", " Directors Cut",
  "imax", "IMAX",
  "proper", "Proper", "PROPER",
  "repack", "Repack", "REPACK",
  "readnfo", "READNFO",
  "subbed", "SUBBED", "dubbed", "DUBBED",
  "multi", "MULTI",
  "hdr", "HDR", "dv", "DV", "dolby vision", "Dolby Vision",
];

const MOVIE_TAG_RE = new RegExp(
  "(?:\\b|\\[|\\(|\\.|_)" +
    MOVIE_SCENE_TAGS.map((t) =>
      t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).join("|") +
    "(?:\\b|\\]|\\)|\\.|_)",
  "gi",
);

const TITLE_CASE_SMALL = [
  "a", "an", "the", "and", "but", "or", "for", "nor",
  "on", "at", "to", "from", "by", "in", "of", "with",
];

function toTitleCase(str: string): string {
  const parts = str.split(" ");
  return parts
    .map((w, i) => {
      if (!w) return w;
      const lower = w.toLowerCase();
      if (i > 0 && TITLE_CASE_SMALL.includes(lower)) return lower;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Normalize a raw video filename into a clean movie title + extracted year
 * and quality flag. Used as the display label on lobby surfaces that don't
 * have folder context.
 */
export function normalizeMovieTitle(filename: string): NormalizedTitle {
  let raw = stripExtension(filename);

  // Extract the year BEFORE stripping parens, so `Tenki no Ko (2019).mkv`
  // keeps the year intact. We pull from the raw stem (after extension)
  // because parenthesised year is the common fansub style for movies.
  const now = new Date().getFullYear();
  const yearMatch = raw.match(/\b(19\d{2}|20\d{2})\b/);
  let year: number | null = null;
  if (yearMatch) {
    const y = Number(yearMatch[1]);
    if (y >= 1900 && y <= now + 1) {
      year = y;
    }
  }

  raw = raw.replace(/\[[^\]]+\]/g, "").replace(/\([^)]{3,}\)/g, "");
  raw = raw.replace(MOVIE_TAG_RE, " ");
  raw = raw.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
  // Strip any bare year that survived (e.g. `Inception 2010` with no parens).
  if (year != null) {
    raw = raw.replace(new RegExp(`\\b${year}\\b`), "").trim();
  }

  let quality: string | null = null;
  const lower = filename.toLowerCase();
  if (lower.includes("2160p") || lower.includes("4k")) quality = "4K";
  else if (lower.includes("1080p")) quality = "1080p";
  else if (lower.includes("720p")) quality = "720p";
  else if (lower.includes("480p")) quality = "480p";

  return { title: toTitleCase(raw), year, quality };
}

/**
 * True when the filename, on its own, doesn't contain enough title to query
 * a metadata API (`[GS]01.mkv` → `"01"`). Callers should fall back to the
 * parent folder name as the query string in these cases.
 */
export function isEpisodicFilename(rawFileName: string): boolean {
  const normalized = normalizeMovieTitle(rawFileName).title.trim();
  if (!normalized) return true;
  if (/^\d{1,3}$/.test(normalized)) return true;
  if (/\bS\d{1,2}E\d{1,3}\b/i.test(rawFileName)) return true;
  if (/\b(?:episode|ep|epi)[\s._-]*\d{1,3}\b/i.test(rawFileName)) return true;
  return false;
}

function cleanFileName(rawFileName: string): string {
  let s = stripExtension(rawFileName);
  for (const re of NOISE_TOKEN_PATTERNS) s = s.replace(re, " ");
  s = s.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();
  return s;
}

function extractSpecialTag(rawFileName: string): SpecialTag | undefined {
  const stem = stripExtension(rawFileName);
  // Normalize the parts that aren't word characters so e.g. "GS-OVA" still
  // matches a word-boundary "OVA".
  const normalized = stem.replace(/[._-]+/g, " ");
  for (const tag of SPECIAL_TAGS) {
    const re = new RegExp(`(?:^|\\W)${tag}(?:$|\\W)`, "i");
    if (re.test(normalized)) {
      // "SPECIAL" maps to "SP" for compactness on screen.
      return (tag === ("SPECIAL" as unknown as SpecialTag)
        ? "SP"
        : tag) as SpecialTag;
    }
  }
  return undefined;
}

function extractEpisodeNumber(rawFileName: string): string | undefined {
  const stem = stripExtension(rawFileName);
  for (const re of EPISODE_PATTERNS) {
    const match = stem.match(re);
    if (!match) continue;
    const num = match[1];
    if (!num) continue;
    const value = Number(num);
    // Drop four-digit "years" so `Inception 2010` isn't tagged Ep2010.
    if (num.length === 4 && value >= 1900 && value <= 2099) continue;
    // Bound to keep noise like resolution stems out (1080, 720, …).
    if (value > 200) continue;
    return num.length >= 2 ? num : num.padStart(2, "0");
  }
  return undefined;
}

function formatSeason(folderName: string): string {
  return folderName.replace(/[._-]+/g, " ").trim().toUpperCase();
}

function buildFullTitle(args: {
  showTitle: string;
  seasonLabel?: string;
  episodeNumber?: string;
  specialTag?: SpecialTag;
  cleanedFileName: string;
  filename: string;
}): string {
  const base = [args.showTitle, args.seasonLabel].filter(Boolean).join(" - ");
  if (args.episodeNumber) {
    return base ? `${base} - EP${args.episodeNumber}` : `EP${args.episodeNumber}`;
  }
  if (args.specialTag) {
    return base ? `${base} - ${args.specialTag}` : args.specialTag;
  }
  // Fallback: no recognizable episode/tag — show the cleaned filename
  // alongside the show context. e.g. "GIMAI SEIKATSU - MOVIE NIGHT".
  const fallback = (args.cleanedFileName || args.filename).toUpperCase();
  return base ? `${base} - ${fallback}` : fallback;
}

function buildShortLabel(args: {
  episodeNumber?: string;
  specialTag?: SpecialTag;
  cleanedFileName: string;
  filename: string;
}): string {
  if (args.episodeNumber) return `Episode ${Number(args.episodeNumber)}`;
  if (args.specialTag) return args.specialTag;
  return args.cleanedFileName || args.filename;
}
