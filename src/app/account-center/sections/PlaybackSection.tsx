/**
 * Playback — default player behavior, ported from the old UserCenter
 * dropdown: auto-play next, default volume, skip duration.
 */

import cn from "classnames";
import { useSettingsStore } from "@app/stores/settings-store";
import type { AppSettings } from "@shared/types";
import type { SectionProps } from "../registry";

const SKIP_OPTIONS: AppSettings["skipSeconds"][] = [5, 10, 15, 30];

export function PlaybackSection({ highlightSettingId: _ }: SectionProps) {
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);
  const setDefaultVolume = useSettingsStore((s) => s.setDefaultVolume);
  const defaultVolumePct = Math.round(settings.defaultVolume * 100);

  return (
    <div className="ny-ac__section-body">
      <div className="ny-ac__card" data-setting-id="playback-autoplay">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Auto-play next</div>
            <div className="ny-ac__row-sub">
              Start the next episode when the current one ends.
            </div>
          </div>
          <button
            type="button"
            className={cn("ny-ac__toggle", { "is-on": settings.autoplayNext })}
            role="switch"
            aria-checked={settings.autoplayNext}
            aria-label="Toggle auto-play next"
            onClick={() => void patch({ autoplayNext: !settings.autoplayNext })}
          >
            <span className="ny-ac__toggle-knob" />
          </button>
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="playback-volume">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Default volume</div>
            <div className="ny-ac__row-sub">Starting volume for every video.</div>
          </div>
          <div className="ny-ac__range-control">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={defaultVolumePct}
              onChange={(e) => void setDefaultVolume(Number(e.target.value) / 100)}
              className="ny-ac__range"
              style={{ ["--pct" as never]: `${defaultVolumePct}%` }}
              aria-label="Default volume"
            />
            <span className="ny-ac__range-value">{defaultVolumePct}%</span>
          </div>
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="playback-skip">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Skip duration</div>
            <div className="ny-ac__row-sub">
              How far the skip buttons and arrow keys jump.
            </div>
          </div>
          <div className="ny-ac__pills">
            {SKIP_OPTIONS.map((s) => (
              <button
                type="button"
                key={s}
                className={cn("ny-ac__pill", {
                  "is-active": settings.skipSeconds === s,
                })}
                onClick={() => void patch({ skipSeconds: s })}
              >
                {s}s
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
