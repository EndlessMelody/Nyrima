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

import { useMemo, useRef, type ChangeEvent, type CSSProperties } from "react";
import cn from "classnames";
import { useSettingsStore } from "../stores/settings-store";
import { fontStackFor, readFontFile } from "../services/subtitle-font";
import type {
  AppSettings,
  SubtitleFontPreset,
} from "@shared/types";

const FONT_PRESETS: { id: SubtitleFontPreset; label: string }[] = [
  { id: "anime-brush", label: "Anime Brush" },
  { id: "comic-dialogue", label: "Comic Dialogue" },
  { id: "clean-sans", label: "Clean Sans" },
  { id: "system", label: "System UI" },
];

const SKIP_OPTIONS: AppSettings["skipSeconds"][] = [5, 10, 15, 30];
const WEIGHT_OPTIONS: AppSettings["subtitleWeight"][] = [400, 600, 700, 800];
const PREVIEW_TEXT = "ASAMURA-KUN CAME HOME LATE TODAY.";

interface Props {
  onClose: () => void;
}

export function SettingsPopover({ onClose }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const setScale = useSettingsStore((s) => s.setScale);
  const setFont = useSettingsStore((s) => s.setFont);
  const setCustomFont = useSettingsStore((s) => s.setCustomFont);
  const clearCustomFont = useSettingsStore((s) => s.clearCustomFont);
  const setSkipSeconds = useSettingsStore((s) => s.setSkipSeconds);
  const patch = useSettingsStore((s) => s.patch);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build the same CSS-variable bag the SubtitleOverlay uses so the preview
  // pill renders exactly like a real cue would on the video frame.
  const previewStyle = useMemo<CSSProperties>(
    () => ({
      fontFamily: fontStackFor(settings.subtitleFont),
      fontWeight: settings.subtitleWeight,
      color: settings.subtitleColor,
      letterSpacing: `${settings.subtitleLetterSpacing}em`,
      // text-stroke is a non-standard prop that React's CSSProperties type
      // doesn't declare; cast through `as never` to keep the typing strict
      // elsewhere without `any`.
      ["-webkit-text-stroke" as never]: `${settings.subtitleOutlineWidth}px ${settings.subtitleOutlineColor}`,
      paintOrder: "stroke fill",
      textShadow: `0 0 ${2 * settings.subtitleShadow}px rgba(0,0,0,${0.9 * settings.subtitleShadow}), 0 2px ${4 * settings.subtitleShadow}px rgba(0,0,0,${0.6 * settings.subtitleShadow})`,
    }),
    [
      settings.subtitleFont,
      settings.subtitleWeight,
      settings.subtitleColor,
      settings.subtitleOutlineColor,
      settings.subtitleOutlineWidth,
      settings.subtitleShadow,
      settings.subtitleLetterSpacing,
    ],
  );

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFontFile(file);
      await setCustomFont(file.name, dataUrl);
    } catch {
      // Read failures are rare; swallow silently rather than wiring a toast.
    } finally {
      // Reset so re-uploading the same file still triggers `change`.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="dc-vlc__menu dc-vlc__menu--settings" role="menu">
      <div className="dc-vlc__menu-kana">設定 · Settings</div>

      {/* Font picker + live preview --------------------------------------- */}
      <div className="dc-vlc__settings-section">
        <div className="dc-vlc__settings-label">
          <span>Subtitle font</span>
        </div>
        <div className="dc-vlc__settings-pills">
          {FONT_PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              className={cn("dc-vlc__pill", {
                "is-active": settings.subtitleFont === p.id,
              })}
              onClick={() => void setFont(p.id)}
            >
              {p.label}
            </button>
          ))}
          {settings.subtitleCustomFontDataUrl && (
            <button
              type="button"
              className={cn("dc-vlc__pill", {
                "is-active": settings.subtitleFont === "custom",
              })}
              onClick={() => void setFont("custom")}
              title={settings.subtitleCustomFontName ?? "Custom font"}
            >
              {settings.subtitleCustomFontName?.slice(0, 18) ?? "Custom"}
            </button>
          )}
        </div>

        {/* Live preview pill — mirrors the active SubtitleOverlay style so
            the user can dial weight/color/outline/shadow without leaving
            the popover. */}
        <div className="dc-vlc__sub-preview" aria-label="Subtitle preview">
          <span className="dc-vlc__sub-preview-text" style={previewStyle}>
            {PREVIEW_TEXT}
          </span>
        </div>

        <div className="dc-vlc__settings-row">
          <input
            ref={fileInputRef}
            type="file"
            accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
            onChange={onUpload}
            style={{ display: "none" }}
            aria-label="Upload custom subtitle font"
          />
          <button
            type="button"
            className="dc-vlc__menu-mini"
            onClick={() => fileInputRef.current?.click()}
          >
            Upload .ttf / .otf / .woff2
          </button>
          {settings.subtitleCustomFontDataUrl && (
            <button
              type="button"
              className="dc-vlc__menu-mini"
              onClick={() => void clearCustomFont()}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="dc-vlc__menu-divider" />

      {/* Size + weight ---------------------------------------------------- */}
      <div className="dc-vlc__settings-section">
        <label
          className="dc-vlc__settings-label"
          htmlFor="dc-vlc-sub-scale"
        >
          <span>Subtitle size</span>
          <span className="dc-vlc__menu-mid">
            {Math.round(settings.subtitleScale * 100)}%
          </span>
        </label>
        <input
          id="dc-vlc-sub-scale"
          type="range"
          min={50}
          max={200}
          step={5}
          value={Math.round(settings.subtitleScale * 100)}
          onChange={(e) => void setScale(Number(e.target.value) / 100)}
          className="dc-vlc__range"
          style={{
            ["--pct" as never]: `${
              ((Math.round(settings.subtitleScale * 100) - 50) / 150) * 100
            }%`,
          }}
          aria-label="Subtitle size"
        />

        <div className="dc-vlc__settings-label">
          <span>Weight</span>
        </div>
        <div className="dc-vlc__settings-pills">
          {WEIGHT_OPTIONS.map((w) => (
            <button
              type="button"
              key={w}
              className={cn("dc-vlc__pill", {
                "is-active": settings.subtitleWeight === w,
              })}
              onClick={() => void patch({ subtitleWeight: w })}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="dc-vlc__menu-divider" />

      {/* Color + outline -------------------------------------------------- */}
      <div className="dc-vlc__settings-section">
        <div className="dc-vlc__settings-label">
          <span>Color</span>
        </div>
        <div className="dc-vlc__settings-row dc-vlc__settings-row--colors">
          <label className="dc-vlc__color-chip">
            <input
              type="color"
              value={settings.subtitleColor}
              onChange={(e) =>
                void patch({ subtitleColor: e.target.value })
              }
              aria-label="Text color"
            />
            <span>Text</span>
          </label>
          <label className="dc-vlc__color-chip">
            <input
              type="color"
              value={settings.subtitleOutlineColor}
              onChange={(e) =>
                void patch({ subtitleOutlineColor: e.target.value })
              }
              aria-label="Outline color"
            />
            <span>Outline</span>
          </label>
        </div>

        <label
          className="dc-vlc__settings-label"
          htmlFor="dc-vlc-sub-stroke"
        >
          <span>Outline width</span>
          <span className="dc-vlc__menu-mid">
            {settings.subtitleOutlineWidth.toFixed(1)}px
          </span>
        </label>
        <input
          id="dc-vlc-sub-stroke"
          type="range"
          min={0}
          max={6}
          step={0.5}
          value={settings.subtitleOutlineWidth}
          onChange={(e) =>
            void patch({ subtitleOutlineWidth: Number(e.target.value) })
          }
          className="dc-vlc__range"
          style={{
            ["--pct" as never]: `${(settings.subtitleOutlineWidth / 6) * 100}%`,
          }}
          aria-label="Outline width"
        />

        <label
          className="dc-vlc__settings-label"
          htmlFor="dc-vlc-sub-shadow"
        >
          <span>Shadow</span>
          <span className="dc-vlc__menu-mid">
            {Math.round(settings.subtitleShadow * 100)}%
          </span>
        </label>
        <input
          id="dc-vlc-sub-shadow"
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={settings.subtitleShadow}
          onChange={(e) =>
            void patch({ subtitleShadow: Number(e.target.value) })
          }
          className="dc-vlc__range"
          style={{
            ["--pct" as never]: `${(settings.subtitleShadow / 2) * 100}%`,
          }}
          aria-label="Shadow strength"
        />
      </div>

      <div className="dc-vlc__menu-divider" />

      {/* Spacing + position ----------------------------------------------- */}
      <div className="dc-vlc__settings-section">
        <label
          className="dc-vlc__settings-label"
          htmlFor="dc-vlc-sub-letter"
        >
          <span>Letter spacing</span>
          <span className="dc-vlc__menu-mid">
            {settings.subtitleLetterSpacing.toFixed(2)}em
          </span>
        </label>
        <input
          id="dc-vlc-sub-letter"
          type="range"
          min={-0.05}
          max={0.2}
          step={0.01}
          value={settings.subtitleLetterSpacing}
          onChange={(e) =>
            void patch({ subtitleLetterSpacing: Number(e.target.value) })
          }
          className="dc-vlc__range"
          style={{
            ["--pct" as never]: `${
              ((settings.subtitleLetterSpacing + 0.05) / 0.25) * 100
            }%`,
          }}
          aria-label="Letter spacing"
        />

        <label
          className="dc-vlc__settings-label"
          htmlFor="dc-vlc-sub-pos"
        >
          <span>Vertical position</span>
          <span className="dc-vlc__menu-mid">
            {Math.round(settings.subtitlePosition * 100)}%
          </span>
        </label>
        <input
          id="dc-vlc-sub-pos"
          type="range"
          min={0}
          max={0.4}
          step={0.01}
          value={settings.subtitlePosition}
          onChange={(e) =>
            void patch({ subtitlePosition: Number(e.target.value) })
          }
          className="dc-vlc__range"
          style={{
            ["--pct" as never]: `${(settings.subtitlePosition / 0.4) * 100}%`,
          }}
          aria-label="Vertical position"
        />
      </div>

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
