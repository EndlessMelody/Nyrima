/**
 * PlaybackCard — the "Playback" panel in the deep row, in three sections:
 * playback speed (six options, 2 rows of 3), the A-B loop, and subtitle timing.
 * Skip controls live on the player bar; track selection lives in the Subtitles
 * & Audio panel.
 */

import cn from "classnames";
import { Gauge, Repeat, Clock } from "lucide-react";
import { formatTimecode } from "../../services/formatters";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface Props {
  speed: number;
  onChangeSpeed: (speed: number) => void;
  abLoop: { a: number | null; b: number | null };
  onSetLoopA: () => void;
  onSetLoopB: () => void;
  onClearLoop: () => void;
  subDelay?: number;
  onSetSubDelay: (seconds: number) => void;
}

export function PlaybackCard({
  speed,
  onChangeSpeed,
  abLoop,
  onSetLoopA,
  onSetLoopB,
  onClearLoop,
  subDelay,
  onSetSubDelay,
}: Props) {
  const loopActive =
    abLoop.a !== null && abLoop.b !== null && abLoop.b > abLoop.a;
  // Guard against an absent/NaN delay so the readout never shows "NaN ms" —
  // a missing subtitle offset means no offset, i.e. 0 ms.
  const safeDelay = Number.isFinite(subDelay) ? (subDelay as number) : 0;
  const ms = Math.round(safeDelay * 1000);
  const nudge = (deltaMs: number) =>
    onSetSubDelay(Math.round((safeDelay + deltaMs / 1000) * 1000) / 1000);

  return (
    <section className="watch-panel playback-card" aria-label="Playback">
      <header className="watch-panel__header">
        <span className="watch-panel__icon" aria-hidden="true">
          <Gauge />
        </span>
        <div>
          <span>Playback</span>
          <h2>Speed &amp; Timing</h2>
        </div>
      </header>

      <div className="playback-card__body">
        <div className="watch-control">
          <span className="watch-control__label">
            <Gauge aria-hidden="true" />
            Speed
          </span>
          <div
            className="watch-pills watch-pills--grid3"
            role="group"
            aria-label="Playback speed"
          >
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={cn("watch-pill ny-focusable", {
                  "is-active": Math.abs(speed - s) < 0.01,
                })}
                onClick={() => onChangeSpeed(s)}
                aria-pressed={Math.abs(speed - s) < 0.01}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>

        <div className="watch-control">
          <span className="watch-control__label">
            <Repeat aria-hidden="true" />
            A-B Loop
          </span>
          <div className="watch-control__buttons">
            <button
              type="button"
              className={cn("watch-action ny-focusable", {
                "is-active": abLoop.a !== null,
              })}
              onClick={onSetLoopA}
              title="Set loop start to the current time"
            >
              A {abLoop.a !== null ? formatTimecode(abLoop.a) : "—"}
            </button>
            <button
              type="button"
              className={cn("watch-action ny-focusable", {
                "is-active": abLoop.b !== null,
              })}
              onClick={onSetLoopB}
              title="Set loop end to the current time"
            >
              B {abLoop.b !== null ? formatTimecode(abLoop.b) : "—"}
            </button>
            <button
              type="button"
              className="watch-action ny-focusable"
              onClick={onClearLoop}
              disabled={abLoop.a === null && abLoop.b === null}
              title="Clear the A-B loop"
            >
              Clear
            </button>
          </div>
          {loopActive && (
            <span className="watch-control__hint is-live">Looping A → B</span>
          )}
        </div>

        <div className="watch-control">
          <span className="watch-control__label">
            <Clock aria-hidden="true" />
            Subtitle Timing
            <output className={cn("playback-card__offset", { "is-live": ms !== 0 })}>
              {ms > 0 ? `+${ms}` : ms} ms
            </output>
          </span>
          <div
            className="watch-pills watch-pills--row"
            role="group"
            aria-label="Subtitle offset"
          >
            <button
              type="button"
              className="watch-pill ny-focusable"
              onClick={() => nudge(-500)}
            >
              −500
            </button>
            <button
              type="button"
              className="watch-pill ny-focusable"
              onClick={() => nudge(-100)}
            >
              −100
            </button>
            <button
              type="button"
              className={cn("watch-pill ny-focusable", { "is-active": ms === 0 })}
              onClick={() => onSetSubDelay(0)}
            >
              0
            </button>
            <button
              type="button"
              className="watch-pill ny-focusable"
              onClick={() => nudge(100)}
            >
              +100
            </button>
            <button
              type="button"
              className="watch-pill ny-focusable"
              onClick={() => nudge(500)}
            >
              +500
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
