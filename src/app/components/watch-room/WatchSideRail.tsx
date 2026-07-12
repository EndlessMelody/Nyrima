/**
 * WatchSideRail — the slim tech-HUD column on the left of the watch room.
 *
 * It is purely informational. Its job is twofold: visually it balances the
 * player against the full header width (pushing the height-capped 16:9 frame
 * off the left edge so the rail · player · episode-list trio spans the
 * header), and it surfaces the current episode marker plus a glanceable
 * "Signal" readout of the stream — source, resolution, codec, container,
 * duration, audio, subtitles, size. No controls live here; those stay in the
 * header and the control strip below the player.
 */

import cn from "classnames";

export interface WatchSpec {
  label: string;
  value: string;
  muted?: boolean;
}

interface Props {
  episodeNumber?: string | null;
  progressPct: number;
  specs: WatchSpec[];
}

export function WatchSideRail({ episodeNumber, progressPct, specs }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(progressPct)));
  // Pad pure-digit episode numbers ("1" → "01"); leave tagged forms ("00v3")
  // as authored.
  const epDisplay = episodeNumber
    ? /^\d+$/.test(episodeNumber)
      ? episodeNumber.padStart(2, "0")
      : episodeNumber
    : null;
  return (
    <aside className="watch-side-rail" aria-label="Stream info">
      <div className="watch-side-rail__head">
        <span className="watch-side-rail__ep">
          <span className="watch-side-rail__ep-kicker">
            {epDisplay ? "EP" : "Film"}
          </span>
          {epDisplay && (
            <strong className="watch-side-rail__ep-num">{epDisplay}</strong>
          )}
        </span>
        <span className="watch-side-rail__progress" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="watch-side-rail__pct">{pct}% watched</span>
      </div>

      <div className="watch-side-rail__specs">
        <dl className="watch-side-rail__spec-list">
          {specs.map((s) => (
            <div
              key={s.label}
              className={cn("watch-side-rail__spec", { "is-muted": s.muted })}
            >
              <dt>{s.label}</dt>
              <dd title={s.value}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  );
}
