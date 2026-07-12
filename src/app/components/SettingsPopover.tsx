/**
 * SettingsPopover — player control manager.
 *
 * Three equal tabs keep the player chrome calm:
 *   - Audio & Subs: audio track, subtitle track, volume, quick subtitle size
 *   - Subtitles: full typography panel
 *   - Playback: speed, loop, auto-play, skip duration
 */

import { useState, type ReactNode } from "react";
import cn from "classnames";
import { useSettingsStore } from "../stores/settings-store";
import { SubtitleConfigPanel } from "./SubtitleConfigPanel";
import type { SubtitleTrack } from "./DrivePlayer";

const SKIP_OPTIONS = [5, 10, 15, 30] as const;

type SettingsTab = "audio" | "subtitles" | "playback";

export interface PlayerAudioTrack {
  id: string;
  label: string;
  language?: string;
  enabled: boolean;
  /**
   * True when the user can't switch INTO this track. Currently set for MKV
   * audio tracks whose codec the MSE remuxer can't repack AND that aren't
   * the muxer-default (which native playback picks automatically). The track
   * still appears in the picker so the user knows the file has it; the row
   * just renders muted and ignores clicks.
   */
  disabled?: boolean;
  /** Optional explanation shown in `title` when the row is disabled. */
  disabledReason?: string;
  /** Optional short status label shown at the right edge of the row. */
  badge?: string;
}

interface Props {
  onClose: () => void;
  audioTracks: PlayerAudioTrack[];
  activeAudioId: string | null;
  onPickAudio: (id: string) => void;
  subtitleTracks: SubtitleTrack[];
  activeSubId: string | null;
  onPickSubtitle: (id: string | null) => void;
  subDelay: number;
  onAdjustSubDelay: (delta: number) => void;
  volumePct: number;
  muted: boolean;
  onSetVolumePct: (pct: number) => void;
  onToggleMute: () => void;
  speed: number;
  speeds: readonly number[];
  onChangeSpeed: (speed: number) => void;
  looping: boolean;
  onToggleLoop: () => void;
}

export function SettingsPopover({
  onClose,
  audioTracks,
  activeAudioId,
  onPickAudio,
  subtitleTracks,
  activeSubId,
  onPickSubtitle,
  subDelay,
  onAdjustSubDelay,
  volumePct,
  muted,
  onSetVolumePct,
  onToggleMute,
  speed,
  speeds,
  onChangeSpeed,
  looping,
  onToggleLoop,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>("playback");
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);
  const setScale = useSettingsStore((s) => s.setScale);
  const setSkipSeconds = useSettingsStore((s) => s.setSkipSeconds);
  const subtitleScalePct = Math.round(settings.subtitleScale * 100);

  return (
    <div className="dc-vlc__menu dc-vlc__menu--settings" role="dialog" aria-label="Player settings">
      <div className="dc-vlc__settings-head">
        <div>
          <div className="dc-vlc__menu-kana">Settings</div>
          <div className="dc-vlc__settings-title">Player controls</div>
        </div>
        <button
          type="button"
          className="dc-vlc__settings-close"
          onClick={onClose}
          aria-label="Close player settings"
        >
          ×
        </button>
      </div>

      <div className="dc-vlc__settings-tabs" role="tablist" aria-label="Settings sections">
        {(
          [
            ["playback", "Playback"],
            ["audio", "Audio & Subs"],
            ["subtitles", "Subtitles"],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={cn("dc-vlc__settings-tab", { "is-active": tab === id })}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "audio" && (
        <div className="dc-vlc__settings-panel" role="tabpanel">
          <SettingsSection label="Audio track">
            <div className="dc-vlc__settings-list">
              {audioTracks.length > 0 ? (
                audioTracks.map((track) => (
                  <button
                    type="button"
                    key={track.id}
                    className={cn("dc-vlc__menu-item", {
                      "is-active": activeAudioId === track.id || track.enabled,
                      "is-disabled": track.disabled,
                    })}
                    disabled={track.disabled}
                    title={track.disabled ? track.disabledReason : undefined}
                    onClick={
                      track.disabled ? undefined : () => onPickAudio(track.id)
                    }
                  >
                    <span>{track.label}</span>
                    <span className="dc-vlc__menu-side">
                      {track.disabled
                        ? "Unsupported"
                        : track.badge ??
                          track.language?.toUpperCase() ??
                          "AUDIO"}
                    </span>
                  </button>
                ))
              ) : (
                <div className="dc-vlc__menu-item is-disabled">
                  <span>Browser default audio</span>
                  <span className="dc-vlc__menu-side">AUTO</span>
                </div>
              )}
            </div>
          </SettingsSection>

          <SettingsSection label="Volume">
            <div className="dc-vlc__settings-slider-card">
              <div className="dc-vlc__settings-slider-meta">
                <button
                  type="button"
                  className={cn("dc-vlc__pill dc-vlc__pill--compact", {
                    "is-active": muted || volumePct === 0,
                  })}
                  onClick={onToggleMute}
                >
                  {muted || volumePct === 0 ? "Muted" : "Mute"}
                </button>
                <span className="dc-vlc__settings-value">
                  {muted ? "0%" : `${volumePct}%`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={muted ? 0 : volumePct}
                onChange={(e) => onSetVolumePct(Number(e.target.value))}
                className="dc-vlc__range"
                style={{ ["--pct" as never]: `${muted ? 0 : volumePct}%` }}
                aria-label="Volume"
              />
            </div>
          </SettingsSection>

          <SettingsSection label="Subtitle track">
            <div className="dc-vlc__settings-list">
              <button
                type="button"
                className={cn("dc-vlc__menu-item", {
                  "is-active": activeSubId === null,
                })}
                onClick={() => onPickSubtitle(null)}
              >
                <span>Off</span>
                <span className="dc-vlc__menu-side">—</span>
              </button>
              {subtitleTracks.length === 0 && (
                <div className="dc-vlc__menu-item is-disabled">
                  <span>No subtitles found</span>
                </div>
              )}
              {subtitleTracks.map((track) => (
                <button
                  type="button"
                  key={track.id}
                  className={cn("dc-vlc__menu-item", {
                    "is-active": activeSubId === track.id,
                    "is-disabled": track.imageBased,
                  })}
                  onClick={() => {
                    if (!track.imageBased) onPickSubtitle(track.id);
                  }}
                  title={
                    track.imageBased
                      ? `${track.label} — ${describeImageBasedReason(track)}`
                      : track.label
                  }
                  disabled={track.imageBased}
                >
                  <span>{track.label}</span>
                  <span className="dc-vlc__menu-side">{subtitleTrackBadge(track)}</span>
                </button>
              ))}
            </div>
            {subtitleTracks.length > 0 && (
              <div className="dc-vlc__menu-row dc-vlc__menu-row--tight">
                <button
                  type="button"
                  className="dc-vlc__menu-mini"
                  onClick={() => onAdjustSubDelay(-0.5)}
                  title="Subtitle earlier"
                >
                  −0.5s
                </button>
                <span className="dc-vlc__menu-mid">
                  {subDelay > 0
                    ? `+${subDelay.toFixed(1)}s`
                    : `${subDelay.toFixed(1)}s`}
                </span>
                <button
                  type="button"
                  className="dc-vlc__menu-mini"
                  onClick={() => onAdjustSubDelay(0.5)}
                  title="Subtitle later"
                >
                  +0.5s
                </button>
              </div>
            )}
          </SettingsSection>

          <SettingsSection label="Subtitle size">
            <div className="dc-vlc__settings-slider-card">
              <div className="dc-vlc__settings-slider-meta">
                <span className="dc-vlc__settings-slider-name">Scale</span>
                <span className="dc-vlc__settings-value">{subtitleScalePct}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={200}
                step={5}
                value={subtitleScalePct}
                onChange={(e) => void setScale(Number(e.target.value) / 100)}
                className="dc-vlc__range"
                style={{
                  ["--pct" as never]: `${((subtitleScalePct - 50) / 150) * 100}%`,
                }}
                aria-label="Subtitle font size"
              />
            </div>
          </SettingsSection>
        </div>
      )}

      {tab === "subtitles" && (
        <div className="dc-vlc__settings-panel" role="tabpanel">
          <SubtitleConfigPanel />
        </div>
      )}

      {tab === "playback" && (
        <div className="dc-vlc__settings-panel" role="tabpanel">
          <SettingsSection label="Playback speed">
            <div className="dc-vlc__settings-pills dc-vlc__settings-pills--grid">
              {speeds.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={cn("dc-vlc__pill", {
                    "is-active": Math.abs(speed - s) < 0.01,
                  })}
                  onClick={() => onChangeSpeed(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection label="Playback behavior">
            <div className="dc-vlc__settings-toggles">
              <button
                type="button"
                className={cn("dc-vlc__menu-item", { "is-active": looping })}
                onClick={onToggleLoop}
              >
                <span>Loop current episode</span>
                <span className="dc-vlc__menu-side">{looping ? "ON" : "OFF"}</span>
              </button>
              <button
                type="button"
                className={cn("dc-vlc__menu-item", {
                  "is-active": settings.autoplayNext,
                })}
                onClick={() => void patch({ autoplayNext: !settings.autoplayNext })}
              >
                <span>Auto-play next</span>
                <span className="dc-vlc__menu-side">
                  {settings.autoplayNext ? "ON" : "OFF"}
                </span>
              </button>
            </div>
          </SettingsSection>

          <SettingsSection label="Skip duration">
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
          </SettingsSection>
        </div>
      )}
    </div>
  );
}

function SettingsSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="dc-vlc__settings-section">
      <div className="dc-vlc__settings-label">
        <span>{label}</span>
      </div>
      {children}
    </section>
  );
}

function subtitleTrackBadge(track: SubtitleTrack): string {
  if (track.imageBased || track.format === "image") return "IMG";
  if (track.assRenderer === "jassub") return "JASSUB";
  if (track.format) return track.format.toUpperCase();
  return track.lang.toUpperCase();
}

function describeImageBasedReason(track: SubtitleTrack): string {
  const normCodec = track.codecId?.toUpperCase().replace(/\s/g, "") ?? "";
  if (normCodec.includes("PGS")) {
    return "decoding Blu-ray bitmaps — try again in a few seconds";
  }
  if (normCodec.includes("VOBSUB")) {
    return "VobSub (DVD) bitmap subtitles aren't supported";
  }
  return "image-based subtitles can't be rendered in-browser";
}
