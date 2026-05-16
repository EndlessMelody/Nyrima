import { useMemo, useRef, type ChangeEvent, type CSSProperties } from "react";
import cn from "classnames";
import { useSettingsStore } from "../stores/settings-store";
import { fontStackFor, readFontFile } from "../services/subtitle-font";
import type { AppSettings, SubtitleFontPreset } from "@shared/types";
import "./SubtitleConfigPanel.scss";

const FONT_PRESETS: { id: SubtitleFontPreset; label: string }[] = [
  { id: "anime-brush", label: "Anime Brush" },
  { id: "comic-dialogue", label: "Comic Dialogue" },
  { id: "clean-sans", label: "Clean Sans" },
  { id: "system", label: "System UI" },
];

const WEIGHT_OPTIONS: AppSettings["subtitleWeight"][] = [400, 600, 700, 800];
const PREVIEW_TEXT = "ASAMURA-KUN CAME HOME LATE TODAY.";

export function SubtitleConfigPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const setScale = useSettingsStore((s) => s.setScale);
  const setFont = useSettingsStore((s) => s.setFont);
  const setCustomFont = useSettingsStore((s) => s.setCustomFont);
  const clearCustomFont = useSettingsStore((s) => s.clearCustomFont);
  const patch = useSettingsStore((s) => s.patch);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewStyle = useMemo<CSSProperties>(
    () => ({
      fontFamily: fontStackFor(settings.subtitleFont),
      fontWeight: settings.subtitleWeight,
      color: settings.subtitleColor,
      letterSpacing: `${settings.subtitleLetterSpacing}em`,
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
      // swallow silently
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="dc-sub-cfg">
      {/* ── Font ──────────────────────────────────────────────────────── */}
      <div className="dc-sub-cfg__section">
        <div className="dc-sub-cfg__label">Subtitle font</div>
        <div className="dc-sub-cfg__pills">
          {FONT_PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              className={cn("dc-sub-cfg__pill", {
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
              className={cn("dc-sub-cfg__pill", {
                "is-active": settings.subtitleFont === "custom",
              })}
              onClick={() => void setFont("custom")}
              title={settings.subtitleCustomFontName ?? "Custom font"}
            >
              {settings.subtitleCustomFontName?.slice(0, 18) ?? "Custom"}
            </button>
          )}
        </div>

        <div className="dc-sub-cfg__preview" aria-label="Subtitle preview">
          <span className="dc-sub-cfg__preview-text" style={previewStyle}>
            {PREVIEW_TEXT}
          </span>
        </div>

        <div className="dc-sub-cfg__row">
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
            className="dc-sub-cfg__btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Upload .ttf / .otf / .woff2
          </button>
          {settings.subtitleCustomFontDataUrl && (
            <button
              type="button"
              className="dc-sub-cfg__btn"
              onClick={() => void clearCustomFont()}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="dc-sub-cfg__divider" />

      {/* ── Size + Weight ─────────────────────────────────────────────── */}
      <div className="dc-sub-cfg__section">
        <label className="dc-sub-cfg__row-between" htmlFor="dc-cfg-scale">
          <span className="dc-sub-cfg__label">Subtitle size</span>
          <span className="dc-sub-cfg__value">
            {Math.round(settings.subtitleScale * 100)}%
          </span>
        </label>
        <input
          id="dc-cfg-scale"
          type="range"
          min={50}
          max={200}
          step={5}
          value={Math.round(settings.subtitleScale * 100)}
          onChange={(e) => void setScale(Number(e.target.value) / 100)}
          className="dc-sub-cfg__range"
          style={{
            ["--pct" as never]: `${
              ((Math.round(settings.subtitleScale * 100) - 50) / 150) * 100
            }%`,
          }}
        />

        <div className="dc-sub-cfg__label" style={{ marginTop: 12 }}>Weight</div>
        <div className="dc-sub-cfg__pills">
          {WEIGHT_OPTIONS.map((w) => (
            <button
              type="button"
              key={w}
              className={cn("dc-sub-cfg__pill", {
                "is-active": settings.subtitleWeight === w,
              })}
              onClick={() => void patch({ subtitleWeight: w })}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="dc-sub-cfg__divider" />

      {/* ── Color + Outline ───────────────────────────────────────────── */}
      <div className="dc-sub-cfg__section">
        <div className="dc-sub-cfg__label">Color</div>
        <div className="dc-sub-cfg__colors">
          <label className="dc-sub-cfg__color-chip">
            <input
              type="color"
              value={settings.subtitleColor}
              onChange={(e) => void patch({ subtitleColor: e.target.value })}
            />
            <span>Text</span>
          </label>
          <label className="dc-sub-cfg__color-chip">
            <input
              type="color"
              value={settings.subtitleOutlineColor}
              onChange={(e) =>
                void patch({ subtitleOutlineColor: e.target.value })
              }
            />
            <span>Outline</span>
          </label>
        </div>

        <label
          className="dc-sub-cfg__row-between"
          htmlFor="dc-cfg-stroke"
          style={{ marginTop: 12 }}
        >
          <span className="dc-sub-cfg__label">Outline width</span>
          <span className="dc-sub-cfg__value">
            {settings.subtitleOutlineWidth.toFixed(1)}px
          </span>
        </label>
        <input
          id="dc-cfg-stroke"
          type="range"
          min={0}
          max={6}
          step={0.5}
          value={settings.subtitleOutlineWidth}
          onChange={(e) =>
            void patch({ subtitleOutlineWidth: Number(e.target.value) })
          }
          className="dc-sub-cfg__range"
          style={{
            ["--pct" as never]: `${(settings.subtitleOutlineWidth / 6) * 100}%`,
          }}
        />

        <label
          className="dc-sub-cfg__row-between"
          htmlFor="dc-cfg-shadow"
          style={{ marginTop: 12 }}
        >
          <span className="dc-sub-cfg__label">Shadow</span>
          <span className="dc-sub-cfg__value">
            {Math.round(settings.subtitleShadow * 100)}%
          </span>
        </label>
        <input
          id="dc-cfg-shadow"
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={settings.subtitleShadow}
          onChange={(e) => void patch({ subtitleShadow: Number(e.target.value) })}
          className="dc-sub-cfg__range"
          style={{
            ["--pct" as never]: `${(settings.subtitleShadow / 2) * 100}%`,
          }}
        />
      </div>

      <div className="dc-sub-cfg__divider" />

      {/* ── Spacing + Position ────────────────────────────────────────── */}
      <div className="dc-sub-cfg__section">
        <label className="dc-sub-cfg__row-between" htmlFor="dc-cfg-letter">
          <span className="dc-sub-cfg__label">Letter spacing</span>
          <span className="dc-sub-cfg__value">
            {settings.subtitleLetterSpacing.toFixed(2)}em
          </span>
        </label>
        <input
          id="dc-cfg-letter"
          type="range"
          min={-0.05}
          max={0.2}
          step={0.01}
          value={settings.subtitleLetterSpacing}
          onChange={(e) =>
            void patch({ subtitleLetterSpacing: Number(e.target.value) })
          }
          className="dc-sub-cfg__range"
          style={{
            ["--pct" as never]: `${
              ((settings.subtitleLetterSpacing + 0.05) / 0.25) * 100
            }%`,
          }}
        />

        <label
          className="dc-sub-cfg__row-between"
          htmlFor="dc-cfg-pos"
          style={{ marginTop: 12 }}
        >
          <span className="dc-sub-cfg__label">Vertical position</span>
          <span className="dc-sub-cfg__value">
            {Math.round(settings.subtitlePosition * 100)}%
          </span>
        </label>
        <input
          id="dc-cfg-pos"
          type="range"
          min={0}
          max={0.4}
          step={0.01}
          value={settings.subtitlePosition}
          onChange={(e) =>
            void patch({ subtitlePosition: Number(e.target.value) })
          }
          className="dc-sub-cfg__range"
          style={{
            ["--pct" as never]: `${(settings.subtitlePosition / 0.4) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}
