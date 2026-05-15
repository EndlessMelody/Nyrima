/**
 * Playback startup telemetry — lightweight performance.mark/measure plumbing.
 *
 * We mark these checkpoints during a single playback start:
 *   player:init
 *   drive:metadata:start     drive:metadata:end
 *   media:first-range:start  media:first-range:end
 *   remux:start              remux:first-segment-ready
 *   video:first-frame        video:canplay
 *
 * On canplay we log a console.table of stage durations so we can compare runs.
 * Marks are cleared at the start of each playback so navigation doesn't
 * accumulate stale entries.
 */

export const PLAYBACK_MARKS = [
  "player:init",
  "playback:mode-initial",
  "drive:metadata:start",
  "drive:metadata:end",
  "media:first-range:start",
  "media:first-range:end",
  "remux:start",
  "remux:first-segment-ready",
  "playback:fallback-to-mse",
  "video:first-frame",
  "video:canplay",
] as const;

export type PlaybackMark = (typeof PLAYBACK_MARKS)[number];

interface MeasureSpec {
  name: string;
  from: PlaybackMark;
  to: PlaybackMark;
}

const PLAYBACK_MEASURES: MeasureSpec[] = [
  { name: "drive metadata", from: "drive:metadata:start", to: "drive:metadata:end" },
  { name: "mode decided", from: "player:init", to: "playback:mode-initial" },
  { name: "first range fetch", from: "media:first-range:start", to: "media:first-range:end" },
  { name: "remux init → first segment", from: "remux:start", to: "remux:first-segment-ready" },
  { name: "native → MSE fallback", from: "playback:mode-initial", to: "playback:fallback-to-mse" },
  { name: "init → first frame", from: "player:init", to: "video:first-frame" },
  { name: "init → canplay", from: "player:init", to: "video:canplay" },
];

export function resetPlaybackTelemetry(): void {
  for (const m of PLAYBACK_MARKS) {
    try {
      performance.clearMarks(m);
    } catch {
      // ignore
    }
  }
  for (const m of PLAYBACK_MEASURES) {
    try {
      performance.clearMeasures(m.name);
    } catch {
      // ignore
    }
  }
}

export function markPlayback(name: PlaybackMark): void {
  try {
    performance.mark(name);
  } catch {
    // ignore — performance.mark is best-effort instrumentation
  }
}

/**
 * Compute measures for every stage that has both ends marked, then log them
 * as a single table. Stages with a missing endpoint are skipped silently.
 */
export function summarizePlaybackStartup(label: string): void {
  const rows: Array<{ stage: string; ms: number }> = [];
  for (const spec of PLAYBACK_MEASURES) {
    const fromEntry = performance.getEntriesByName(spec.from, "mark").at(-1);
    const toEntry = performance.getEntriesByName(spec.to, "mark").at(-1);
    if (!fromEntry || !toEntry) continue;
    try {
      performance.measure(spec.name, spec.from, spec.to);
      const measure = performance.getEntriesByName(spec.name, "measure").at(-1);
      if (measure) rows.push({ stage: spec.name, ms: Math.round(measure.duration) });
    } catch {
      // ignore
    }
  }
  if (rows.length === 0) return;
  // eslint-disable-next-line no-console
  console.log(`[playback] startup timings — ${label}`);
  // eslint-disable-next-line no-console
  console.table(rows);
}
