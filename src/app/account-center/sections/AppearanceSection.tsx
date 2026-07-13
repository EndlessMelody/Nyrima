/**
 * Appearance — theme, accent color ("the lamp"), reduced motion, default
 * landing page, and the lobby banner crop tool.
 */

import cn from "classnames";
import { useTheme } from "@app/providers/AppProviders";
import { useSettingsStore } from "@app/stores/settings-store";
import { ACCENT_PRESETS } from "@app/theme/accent-presets";
import type { AppSettings } from "@shared/types";
import { LobbyBannerSettings } from "../LobbyBannerSettings";
import type { SectionProps } from "../registry";

const LANDING_OPTIONS: { value: AppSettings["defaultLandingPage"]; label: string }[] = [
  { value: "/app", label: "Lobby" },
  { value: "/library", label: "All Library" },
  { value: "/library/movies", label: "Movies" },
  { value: "/posts", label: "Posts" },
  { value: "/social", label: "Social" },
];

export function AppearanceSection({ highlightSettingId: _ }: SectionProps) {
  const { mode, setMode } = useTheme();
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);

  return (
    <div className="ny-ac__section-body">
      {/* Theme */}
      <div className="ny-ac__card" data-setting-id="appearance-theme">
        <div className="ny-ac__row ny-ac__row--stack">
          <div>
            <div className="ny-ac__row-label">Theme</div>
            <div className="ny-ac__row-sub">Midnight, Pearl, or follow the OS.</div>
          </div>
          <div className="ny-ac__pills">
            {(["dark", "light", "system"] as const).map((m) => (
              <button
                type="button"
                key={m}
                className={cn("ny-ac__pill", { "is-active": mode === m })}
                onClick={() => {
                  setMode(m);
                  void patch({ theme: m });
                }}
              >
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Accent color */}
      <div className="ny-ac__card" data-setting-id="appearance-accent">
        <div className="ny-ac__row ny-ac__row--stack">
          <div>
            <div className="ny-ac__row-label">Accent color</div>
            <div className="ny-ac__row-sub">
              The lamp — focus rings, active states, and the wordmark follow it.
            </div>
          </div>
          <div className="ny-ac__swatches" role="radiogroup" aria-label="Accent color">
            {ACCENT_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                role="radio"
                aria-checked={settings.accentPreset === preset.id}
                className={cn("ny-ac__swatch", {
                  "is-active": settings.accentPreset === preset.id,
                })}
                style={{ ["--swatch" as never]: preset.swatch }}
                title={preset.label}
                onClick={() => void patch({ accentPreset: preset.id })}
              >
                <span className="ny-ac__swatch-dot" />
                <span className="ny-ac__swatch-label">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Reduced motion */}
      <div className="ny-ac__card" data-setting-id="appearance-reduced-motion">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Reduced motion</div>
            <div className="ny-ac__row-sub">
              Calms page transitions, reveals, and the sakura petals.
            </div>
          </div>
          <button
            type="button"
            className={cn("ny-ac__toggle", { "is-on": settings.reducedMotion })}
            role="switch"
            aria-checked={settings.reducedMotion}
            aria-label="Toggle reduced motion"
            onClick={() => void patch({ reducedMotion: !settings.reducedMotion })}
          >
            <span className="ny-ac__toggle-knob" />
          </button>
        </div>
      </div>

      {/* Default landing page */}
      <div className="ny-ac__card" data-setting-id="appearance-landing">
        <div className="ny-ac__row ny-ac__row--stack">
          <div>
            <div className="ny-ac__row-label">Default landing page</div>
            <div className="ny-ac__row-sub">Where Nyrima opens after sign-in.</div>
          </div>
          <div className="ny-ac__pills">
            {LANDING_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={cn("ny-ac__pill", {
                  "is-active": settings.defaultLandingPage === option.value,
                })}
                onClick={() => void patch({ defaultLandingPage: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lobby banner */}
      <div data-setting-id="appearance-lobby-banner">
        <LobbyBannerSettings />
      </div>
    </div>
  );
}
