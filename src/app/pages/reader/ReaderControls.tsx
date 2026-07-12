/**
 * Small, flat control primitives for the reader sidebar.
 *
 * Intentionally minimal — no Once UI here. The reader's design language is
 * quieter and flatter than the rest of the app, so these are hairline,
 * label-led controls that read as a calm tool rail rather than a dashboard.
 */

import type { ReactNode } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";

export function Section({
  id,
  title,
  icon,
  open,
  onToggle,
  children,
  hint,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  hint?: string;
}) {
  const panelId = `reader-section-${id}`;
  return (
    <section className={`reader-section${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="reader-section__head"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="reader-section__icon" aria-hidden>
          {icon}
        </span>
        <span className="reader-section__title">{title}</span>
        {hint && <span className="reader-section__hint">{hint}</span>}
        <ChevronDown className="reader-section__chevron" aria-hidden />
      </button>
      {open && (
        <div className="reader-section__body" id={panelId}>
          {children}
        </div>
      )}
    </section>
  );
}

export function Stepper({
  label,
  value,
  onDecrease,
  onIncrease,
  canDecrease = true,
  canIncrease = true,
}: {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  canDecrease?: boolean;
  canIncrease?: boolean;
}) {
  return (
    <div className="reader-stepper">
      <span className="reader-stepper__label">{label}</span>
      <div className="reader-stepper__controls">
        <button
          type="button"
          className="reader-stepper__btn"
          onClick={onDecrease}
          disabled={!canDecrease}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <Minus aria-hidden />
        </button>
        <span className="reader-stepper__value">{value}</span>
        <button
          type="button"
          className="reader-stepper__btn"
          onClick={onIncrease}
          disabled={!canIncrease}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <Plus aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`reader-toggle${checked ? " is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="reader-toggle__label">{label}</span>
      <span className="reader-toggle__track" aria-hidden>
        <span className="reader-toggle__thumb" />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="reader-field">
      <span className="reader-field__label">{label}</span>
      <div className="reader-segmented" role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`reader-segmented__btn${value === opt.value ? " is-active" : ""}`}
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="reader-field reader-slider">
      <span className="reader-field__label">
        {label}
        <span className="reader-slider__value">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}
