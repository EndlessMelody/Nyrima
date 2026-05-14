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
