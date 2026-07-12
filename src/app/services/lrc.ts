/**
 * Minimal `.lrc` lyrics parser.
 *
 * Supports the common LRC subset Nyrima needs for synced playback:
 *   - One or more `[mm:ss.xx]` (or `[mm:ss]`) time tags per line.
 *   - Repeated time tags on a single text line (karaoke duplicates).
 *   - ID-tag lines like `[ti:..]`, `[ar:..]`, `[offset:..]` — `offset` is
 *     applied (ms, positive = shift lyrics later); the rest are ignored.
 *   - Plain (un-timed) lines fall through as a single 0:00 entry block so the
 *     panel can still show static lyrics.
 */

export interface LrcLine {
  /** Absolute time in seconds the line becomes active. */
  timeSec: number;
  text: string;
}

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const INLINE_KARAOKE_TAG = /<\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?>/g;
const ID_TAG = /^\[(ti|ar|al|by|offset|length|re|ve):(.*)\]$/i;

/**
 * Parse LRC text into time-sorted lyric lines. Returns `[]` for empty/blank
 * input. When no timestamps are present at all, every non-empty line is
 * emitted at t=0 so the caller can still render static lyrics.
 */
export function parseLrc(raw: string): LrcLine[] {
  if (!raw) return [];
  const text = raw.replace(/\r\n?/g, "\n");
  const rawLines = text.split("\n");

  let offsetMs = 0;
  const out: LrcLine[] = [];
  let sawTimestamp = false;

  for (const rawLine of rawLines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const idMatch = ID_TAG.exec(line.trim());
    if (idMatch) {
      if (idMatch[1].toLowerCase() === "offset") {
        const parsed = Number.parseInt(idMatch[2].trim(), 10);
        if (Number.isFinite(parsed)) offsetMs = parsed;
      }
      // Only treat as a pure metadata line if there's no trailing lyric text.
      const afterTag = line.replace(/^\[[^\]]*\]/, "").trim();
      if (!afterTag) continue;
    }

    TIME_TAG.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = TIME_TAG.exec(line)) !== null) {
      const mins = Number(match[1]);
      const secs = Number(match[2]);
      const fracRaw = match[3] ?? "0";
      // Normalise centi/milli-seconds: "5" -> .5, "50" -> .50, "500" -> .500.
      const frac = Number(`0.${fracRaw}`);
      stamps.push(mins * 60 + secs + frac);
    }

    const lyric = line.replace(TIME_TAG, "").trim();
    if (stamps.length > 0) {
      sawTimestamp = true;
      for (const stamp of stamps) {
        out.push({ timeSec: Math.max(0, stamp), text: lyric });
      }
    } else if (!ID_TAG.test(line.trim())) {
      // Un-timed lyric line — keep as static text at the head.
      out.push({ timeSec: 0, text: lyric });
    }
  }

  if (offsetMs !== 0 && sawTimestamp) {
    const shift = offsetMs / 1000;
    for (const line of out) line.timeSec = Math.max(0, line.timeSec + shift);
  }

  out.sort((a, b) => a.timeSec - b.timeSec);
  return out;
}

/**
 * Extract readable lyric text without synced/karaoke timing. This is used by
 * the music player panel when lyrics should be displayed as text instead of
 * animated against the playback clock.
 */
export function parseDisplayLyrics(raw: string): LrcLine[] {
  if (!raw) return [];
  const text = raw.replace(/\r\n?/g, "\n");
  const out: LrcLine[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || ID_TAG.test(line)) continue;
    const lyric = line
      .replace(TIME_TAG, "")
      .replace(INLINE_KARAOKE_TAG, "")
      .replace(/\s+/g, " ")
      .trim();
    if (lyric) out.push({ timeSec: 0, text: lyric });
  }

  return out;
}

/**
 * Index of the line that should be highlighted at `currentSec`, or -1 before
 * the first timestamp. Assumes `lines` is time-sorted (parseLrc guarantees it).
 */
export function activeLrcIndex(lines: LrcLine[], currentSec: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeSec <= currentSec) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/** True when the parsed lyrics carry real timestamps (i.e. are syn-able). */
export function isSyncedLrc(lines: LrcLine[]): boolean {
  return lines.some((line) => line.timeSec > 0);
}
