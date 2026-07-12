/**
 * WatchTuningPanel — the video analog of the Music Player's "Easy Audio
 * Shaping" panel. Brightness / contrast / saturation / gamma apply real
 * effects to the <video> (CSS filter + an SVG gamma filter). Sharpness has no
 * honest engine path, so it's disabled rather than faked.
 */

import cn from "classnames";
import {
  RotateCcw,
  Sun,
  Contrast,
  Droplets,
  Sparkles,
  Aperture,
  Thermometer,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  TUNING_PRESET_ORDER,
  TUNING_PRESETS,
  type TuningPreset,
  type WatchTuning,
} from "./types";

interface Props {
  tuning: WatchTuning;
  preset: TuningPreset;
  onChange: (tuning: WatchTuning) => void;
  onSelectPreset: (preset: TuningPreset) => void;
  onReset: () => void;
}

export function WatchTuningPanel({
  tuning,
  preset,
  onChange,
  onSelectPreset,
  onReset,
}: Props) {
  return (
    <section className="watch-panel tuning-panel" aria-label="Watch tuning">
      <header className="watch-panel__header">
        <span className="watch-panel__icon" aria-hidden="true">
          <SlidersHorizontal />
        </span>
        <div>
          <span>Picture tuning</span>
          <h2>Watch Tuning</h2>
        </div>
        <button
          type="button"
          className="watch-panel__reset ny-focusable"
          onClick={onReset}
        >
          <RotateCcw aria-hidden="true" />
          Reset
        </button>
      </header>

      <div className="tuning-presets" role="group" aria-label="Tuning presets">
        {TUNING_PRESET_ORDER.map((name) => (
          <button
            key={name}
            type="button"
            className={cn("ny-focusable", { "is-active": preset === name })}
            onClick={() => onSelectPreset(name)}
            disabled={name === "Custom"}
            aria-pressed={preset === name}
            title={
              name === "Custom"
                ? "Set automatically when you adjust a slider"
                : undefined
            }
          >
            {name}
          </button>
        ))}
      </div>

      <div className="tuning-grid">
        <TuningSlider
          icon={Sun}
          label="Brightness"
          value={tuning.brightness}
          min={50}
          max={150}
          step={1}
          suffix="%"
          onChange={(brightness) => onChange({ ...tuning, brightness })}
        />
        <TuningSlider
          icon={Contrast}
          label="Contrast"
          value={tuning.contrast}
          min={50}
          max={150}
          step={1}
          suffix="%"
          onChange={(contrast) => onChange({ ...tuning, contrast })}
        />
        <TuningSlider
          icon={Droplets}
          label="Saturation"
          value={tuning.saturation}
          min={0}
          max={200}
          step={1}
          suffix="%"
          onChange={(saturation) => onChange({ ...tuning, saturation })}
        />
        <TuningSlider
          icon={Sparkles}
          label="Gamma"
          value={tuning.gamma}
          min={0.4}
          max={2.4}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(gamma) => onChange({ ...tuning, gamma })}
        />
        <TuningSlider
          icon={Aperture}
          label="Sharpness"
          value={tuning.sharpness}
          min={0}
          max={100}
          step={1}
          suffix="%"
          onChange={(sharpness) => onChange({ ...tuning, sharpness })}
        />
        <TuningSlider
          icon={Thermometer}
          label="Warmth"
          value={tuning.warmth}
          min={-100}
          max={100}
          step={1}
          format={(v) => (v > 0 ? `+${v}` : `${v}`)}
          onChange={(warmth) => onChange({ ...tuning, warmth })}
        />
      </div>
    </section>
  );
}

function TuningSlider({
  icon: Icon,
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  format,
  disabled,
  unavailable,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  format?: (value: number) => string;
  disabled?: boolean;
  unavailable?: string;
  onChange: (value: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className={cn("tuning-slider", { "is-disabled": disabled })}>
      <span className="tuning-slider__head">
        <Icon aria-hidden="true" />
        <span>{label}</span>
        <output>
          {disabled
            ? (unavailable ?? "—")
            : `${format ? format(value) : value}${suffix}`}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--progress" as string]: `${Math.max(0, Math.min(100, pct))}%` }}
        aria-label={label}
      />
    </label>
  );
}
