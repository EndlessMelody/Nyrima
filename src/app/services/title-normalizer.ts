/**
 * Normalize a raw video filename into a clean movie title + metadata.
 *
 * Pipeline:
 *   1. Strip extension
 *   2. Remove release-group brackets / parentheses
 *   3. Strip scene tags (quality, codec, source, audio, edition flags)
 *   4. Replace dots/underscores with spaces
 *   5. Title-case the result
 *   6. Extract a 4-digit year (1900–current+1)
 */

export interface NormalizedTitle {
  title: string;
  year: number | null;
  quality: string | null;
}

const SCENE_TAGS = [
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

const TAG_RE = new RegExp(
  "(?:\\b|\\[|\\(|\\.|_)" +
    SCENE_TAGS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
    "(?:\\b|\\]|\\)|\\.|_)",
  "gi",
);

export function normalizeMovieTitle(filename: string): NormalizedTitle {
  // 1. Strip extension
  let raw = filename.replace(/\.[^.]+$/, "");

  // 2. Remove release-group brackets / parentheses
  raw = raw.replace(/\[[^\]]+\]/g, "").replace(/\([^)]{3,}\)/g, "");

  // 3. Strip scene tags
  raw = raw.replace(TAG_RE, " ");

  // 4. Replace separators with spaces
  raw = raw.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();

  // 5. Extract year
  const now = new Date().getFullYear();
  const yearMatch = raw.match(/\b(19\d{2}|20\d{2})\b/);
  let year: number | null = null;
  if (yearMatch) {
    const y = Number(yearMatch[1]);
    if (y >= 1900 && y <= now + 1) {
      year = y;
      raw = raw.replace(yearMatch[0], "").trim();
    }
  }

  // 6. Detect quality from original filename
  let quality: string | null = null;
  const lower = filename.toLowerCase();
  if (lower.includes("2160p") || lower.includes("4k")) quality = "4K";
  else if (lower.includes("1080p")) quality = "1080p";
  else if (lower.includes("720p")) quality = "720p";
  else if (lower.includes("480p")) quality = "480p";

  // 7. Title-case
  const title = toTitleCase(raw);

  return { title, year, quality };
}

function toTitleCase(str: string): string {
  return str
    .split(" ")
    .map((w) => {
      if (!w) return w;
      const lower = w.toLowerCase();
      const small = ["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "from", "by", "in", "of", "with"];
      if (small.includes(lower) && w !== str.split(" ")[0]) return lower;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Folder-aware "Episode N" titles
//
// The PlayerPage already has the parent folder name (we navigate via
// `/play/:folderId/:fileId`) and the raw filename. `buildDisplayTitle`
// merges them into the cinematic header the user sees on the player:
//
//   Folder: "Gimai Seikatsu"
//   File:   "[GS]07.mkv"
//   →       "Gimai Seikatsu - Ep07"
//
// Episode detection is conservative: 4-digit numbers that look like years
// (1900-2099) and known resolution/codec stems (1080p, 720p, x264…) are
// excluded so movie filenames like "Inception 2010.mkv" don't get tagged
// as "Episode 2010".
// ---------------------------------------------------------------------------

export interface ParsedTitle {
  folderName: string;
  rawFileName: string;
  displayTitle: string;
  episodeNumber?: string;
  cleanedFileName: string;
}

// Tokens we strip before looking for an episode number.
const NOISE_TOKEN_PATTERNS = [
  /\[[^\]]+\]/g, // bracketed groups like [Erai-raws], [GS], [1080p]
  /\([^)]+\)/g, // parenthesised tags
  /\b(?:1080p|720p|480p|2160p|4k|hdr|hevc|x265|x264|h\.?264|h\.?265|aac|flac|ac3|dts|atmos|web-?dl|web-?rip|bluray|bd-?rip|hd-?rip|dvd-?rip|remux|10bit|8bit|multi|subbed|dubbed)\b/gi,
];

const EPISODE_PATTERNS: RegExp[] = [
  /\bS\d{1,2}E(\d{1,3})\b/i, // S01E07
  /\b(?:episode|ep|epi)[\s._-]*?(\d{1,3})\b/i, // Episode 07, Ep07
  /\bE(\d{1,3})\b/, // E07 (uppercase E to avoid matching "Erai")
  // Standalone numeric segment preceded by any common separator (incl.
  // `]` and `)` so bracket-prefix styles like `[GS]07` match too).
  /(?:^|[\s\-_.\]\)])(\d{1,3})(?=\s*(?:v\d)?\s*(?:\[|\(|$|\.|\s))/,
];

/** Strip release-group/quality/codec tags and the file extension. */
function cleanFileName(rawFileName: string): string {
  let s = rawFileName.replace(/\.[^.]+$/, "");
  for (const re of NOISE_TOKEN_PATTERNS) s = s.replace(re, " ");
  s = s.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
  // Trailing/leading dashes left after token removal.
  s = s.replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();
  return s;
}

/** Extract an episode number string, preserving the source's leading zero
 *  where possible (so `07` stays `07`, not `7`). Returns `undefined` when
 *  the filename has no recognizable episode marker. */
function extractEpisodeNumber(rawFileName: string): string | undefined {
  const stem = rawFileName.replace(/\.[^.]+$/, "");

  for (const re of EPISODE_PATTERNS) {
    const match = stem.match(re);
    if (!match) continue;
    const num = match[1];
    if (!num) continue;
    const value = Number(num);
    // Filter out four-digit "years" so movie filenames don't get tagged.
    if (num.length === 4 && value >= 1900 && value <= 2099) continue;
    // Two-digit numbers that are actually resolution stems (1080, 720, etc.)
    // are already swallowed by NOISE_TOKEN_PATTERNS, but guard episode <= 200
    // anyway so `1080p`-adjacent matches don't sneak through.
    if (value > 200) continue;
    // Preserve the source's padding so `07` stays `07`; pad shorter numbers
    // to two digits because that's what fansub naming conventions use.
    return num.length >= 2 ? num : num.padStart(2, "0");
  }
  return undefined;
}

/**
 * Build the player's display title from the Drive parent-folder name and
 * the raw video filename.
 *
 * - When an episode number is detected, format as `${folder} - Ep${nn}`.
 * - When not (movies, one-shots), fall back to the cleaned filename so
 *   `Movie Collection / Your Name.mkv` → `Your Name`.
 * - Both inputs are trimmed; a blank folder collapses to the filename.
 */
export function buildDisplayTitle(
  folderName: string,
  rawFileName: string,
): ParsedTitle {
  const folder = (folderName ?? "").trim();
  const cleaned = cleanFileName(rawFileName);
  const episodeNumber = extractEpisodeNumber(rawFileName);

  let displayTitle: string;
  if (episodeNumber && folder) {
    displayTitle = `${folder} - Ep${episodeNumber}`;
  } else if (cleaned) {
    displayTitle = cleaned;
  } else if (folder) {
    displayTitle = folder;
  } else {
    displayTitle = rawFileName;
  }

  return {
    folderName: folder,
    rawFileName,
    displayTitle,
    episodeNumber,
    cleanedFileName: cleaned,
  };
}
