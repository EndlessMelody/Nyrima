/**
 * SettingsPopover — pops out of the DrivePlayer's gear button.
 *
 * Exposes the persisted-settings knobs that the player can't usefully fit
 * into its own HUD: subtitle scale (50–200 %), font preset incl. custom
 * upload, full subtitle typography (weight / color / outline / shadow /
 * letter-spacing / vertical position), and the skip-back / skip-forward
 * jump duration. Reads/writes through useSettingsStore so changes survive
 * reloads and propagate to all open player instances.
 */

import { useEffect } from "react";
import cn from "classnames";
import { useSettingsStore } from "../stores/settings-store";
import { SubtitleConfigPanel } from "./SubtitleConfigPanel";

const SKIP_OPTIONS = [5, 10, 15, 30] as const;

interface Props {
  onClose: () => void;
}

export function SettingsPopover({ onClose }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const setSkipSeconds = useSettingsStore((s) => s.setSkipSeconds);

  return (
    <div className="dc-vlc__menu dc-vlc__menu--settings" role="menu">
      <div className="dc-vlc__menu-kana">設定 · Settings</div>

      <SubtitleConfigPanel />
      <div className="dc-vlc__menu-divider" />

      {/* Skip duration ---------------------------------------------------- */}
      <div className="dc-vlc__settings-section">
        <div className="dc-vlc__settings-label">
          <span>Skip duration</span>
        </div>
        <div className="dc-vlc__settings-pills">
          {SKIP_OPTIONS.map((s) => (
            <button
              type="button"
              key={s}
              className={cn("dc-vlc__pill", {
                "is-active": settings.skipSeconds === s,
              })}
              onClick={() => void setSkipSeconds(s)}
            >
              {s}s
            </button>
          ))}
        </div>
      </div>

      <div className="dc-vlc__menu-divider" />
      <button
        type="button"
        className="dc-vlc__menu-item"
        onClick={onClose}
        role="menuitem"
      >
        <span>Close</span>
        <span className="dc-vlc__menu-side">↵</span>
      </button>
    </div>
  );
}
