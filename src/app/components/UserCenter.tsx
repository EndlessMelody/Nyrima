/**
 * UserCenter — dropdown panel from the header UserChip.
 *
 * Sections:
 *   A. Identity   — avatar, name, email, sign-out
 *   B. Appearance — theme toggle (dark/light/system)
 *   C. Playback   — auto-play next, skip duration, preferred subtitle lang
 *   D. Storage    — clear watch history, clear cache
 *   E. About      — version, API key status
 */

import { useCallback, useState } from "react";
import cn from "classnames";
import { useTheme } from "../providers/AppProviders";
import { useSettingsStore } from "../stores/settings-store";
import { signOut, tryGetAccessToken } from "../services/auth";
import { clearUserProfile, getUserProfile } from "../services/user-profile";
import { SubtitleConfigPanel } from "./SubtitleConfigPanel";
import { ApiConfigPanel } from "./ApiConfigPanel";
import type { UserProfile, AppSettings } from "@shared/types";

import "./UserCenter.scss";

const SKIP_OPTIONS: AppSettings["skipSeconds"][] = [5, 10, 15, 30];
const LANG_OPTIONS = [
  { code: "vi", label: "Tiếng Việt" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
];

interface Props {
  profile: UserProfile | null;
  onClose: () => void;
  onProfileChange: (p: UserProfile | null) => void;
}

export function UserCenter({ profile, onClose, onProfileChange }: Props) {
  const { resolved, setMode } = useTheme();
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);
  const [clearing, setClearing] = useState(false);
  const [view, setView] = useState<"main" | "subtitles" | "api">("main");

  const handleSignOut = useCallback(async () => {
    await signOut();
    await clearUserProfile();
    onProfileChange(null);
    onClose();
  }, [onClose, onProfileChange]);

  const handleSignIn = useCallback(async () => {
    try {
      // Trigger interactive OAuth flow.
      const token = await tryGetAccessToken(true);
      if (token) {
        // Now fetch the profile with the fresh token.
        const p = await getUserProfile();
        if (p) onProfileChange(p);
      } else {
        alert("Please enter your OAuth Client ID in the API Settings panel (click the Key icon below) to enable Connect Drive.");
      }
    } catch (e) {
      alert("Failed to sign in: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [onProfileChange]);

  const handleClearHistory = useCallback(async () => {
    setClearing(true);
    try {
      await chrome.storage.local.remove("dc.positions");
      // Reload positions in the current session.
      window.location.reload();
    } catch {
      setClearing(false);
    }
  }, []);

  const handleClearCache = useCallback(async () => {
    try {
      // Wipe the SWR metadata cache.
      const all = await chrome.storage.local.get(null);
      const cacheKeys = Object.keys(all).filter(
        (k) => k.startsWith("dc.meta:") || k.startsWith("dc.folder:"),
      );
      if (cacheKeys.length > 0) {
        await chrome.storage.local.remove(cacheKeys);
      }
    } catch {
      // ignore
    }
  }, []);

    const initial = profile?.name?.[0]?.toUpperCase() ?? "G";

  if (view === "subtitles" || view === "api") {
    return (
      <div className="dc-uc" role="dialog" aria-label={view === "subtitles" ? "Subtitle settings" : "API settings"}>
        <div className="dc-uc__nav-header">
          <button
            type="button"
            className="dc-uc__nav-back"
            onClick={() => setView("main")}
          >
            <ChevronLeftIcon />
            <span>Back to User Center</span>
          </button>
        </div>
        <div className="dc-uc__divider" />
        {view === "subtitles" ? <SubtitleConfigPanel /> : <ApiConfigPanel />}
      </div>
    );
  }

  return (
    <div className="dc-uc" role="dialog" aria-label="User center">
      {/* ── Identity ──────────────────────────────────────────────── */}
      <div className="dc-uc__identity">
        {profile?.picture ? (
          <img
            className="dc-uc__avatar"
            src={profile.picture}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="dc-uc__avatar dc-uc__avatar--mono">{initial}</span>
        )}
        <div className="dc-uc__identity-text">
          <span className="dc-uc__name">{profile?.name ?? "Guest"}</span>
          {profile?.email && (
            <span className="dc-uc__email">{profile.email}</span>
          )}
        </div>
        {profile ? (
          <button
            type="button"
            className="dc-uc__sign-out"
            onClick={() => void handleSignOut()}
          >
            Sign out
          </button>
        ) : (
          <button
            type="button"
            className="dc-uc__sign-in dc-uc__sign-out"
            onClick={() => void handleSignIn()}
          >
            Connect Drive
          </button>
        )}
      </div>

      <div className="dc-uc__divider" />

      {/* ── Appearance ────────────────────────────────────────────── */}
      <div className="dc-uc__section">
        <div className="dc-uc__section-label">外観 · Appearance</div>
        <div className="dc-uc__pills">
          {(["dark", "light", "system"] as const).map((m) => (
            <button
              type="button"
              key={m}
              className={cn("dc-uc__pill", { "is-active": resolved === m || (m === "system" && settings.theme === "system") })}
              onClick={() => {
                setMode(m === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : m);
                void patch({ theme: m });
              }}
            >
              {m === "dark" && <MoonIcon />}
              {m === "light" && <SunIcon />}
              {m === "system" && <MonitorIcon />}
              <span>{m[0].toUpperCase() + m.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="dc-uc__divider" />

      {/* ── Playback defaults ─────────────────────────────────────── */}
      <div className="dc-uc__section">
        <div className="dc-uc__section-label">再生 · Playback</div>

        <div className="dc-uc__row">
          <span className="dc-uc__row-label">Auto-play next</span>
          <button
            type="button"
            className={cn("dc-uc__toggle", { "is-on": settings.autoplayNext })}
            onClick={() => void patch({ autoplayNext: !settings.autoplayNext })}
            aria-label="Toggle auto-play"
          >
            <span className="dc-uc__toggle-knob" />
          </button>
        </div>

        <div className="dc-uc__row">
          <span className="dc-uc__row-label">Skip duration</span>
          <div className="dc-uc__mini-pills">
            {SKIP_OPTIONS.map((s) => (
              <button
                type="button"
                key={s}
                className={cn("dc-uc__mini-pill", {
                  "is-active": settings.skipSeconds === s,
                })}
                onClick={() => void patch({ skipSeconds: s })}
              >
                {s}s
              </button>
            ))}
          </div>
        </div>

        <div className="dc-uc__row">
          <span className="dc-uc__row-label">Subtitle language</span>
          <div className="dc-uc__mini-pills">
            {LANG_OPTIONS.map((l) => (
              <button
                type="button"
                key={l.code}
                className={cn("dc-uc__mini-pill", {
                  "is-active": settings.preferredSubtitleLanguage === l.code,
                })}
                onClick={() =>
                  void patch({ preferredSubtitleLanguage: l.code })
                }
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dc-uc__actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="dc-uc__action dc-uc__action--forward"
            onClick={() => setView("subtitles")}
          >
            <PaintIcon />
            <span>Subtitle typography...</span>
          </button>
        </div>
      </div>

      <div className="dc-uc__divider" />

      {/* ── Storage ───────────────────────────────────────────────── */}
      <div className="dc-uc__section">
        <div className="dc-uc__section-label">保存 · Storage</div>
        <div className="dc-uc__actions">
          <button
            type="button"
            className="dc-uc__action"
            onClick={() => void handleClearHistory()}
            disabled={clearing}
          >
            <TrashIcon />
            <span>{clearing ? "Clearing…" : "Clear watch history"}</span>
          </button>
          <button
            type="button"
            className="dc-uc__action"
            onClick={() => void handleClearCache()}
          >
            <RefreshIcon />
            <span>Clear metadata cache</span>
          </button>
        </div>
      </div>

      <div className="dc-uc__divider" />

      {/* ── About ─────────────────────────────────────────────────── */}
      <div className="dc-uc__section dc-uc__section--about">
        <div className="dc-uc__about-row">
          <span className="dc-uc__about-label">Nyrima</span>
          <span className="dc-uc__about-value">v0.0.1</span>
        </div>
        <div className="dc-uc__about-row">
          <span className="dc-uc__about-label">API keys</span>
          <span className="dc-uc__about-value dc-uc__about-value--status">
            {profile ? "OAuth Configured" : "Key Configured"}
          </span>
        </div>
        <div className="dc-uc__actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="dc-uc__action dc-uc__action--forward"
            onClick={() => setView("api")}
          >
            <KeyIcon />
            <span>Configure API keys...</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline icons — 16×16 hairline strokes matching AppShell style.
// ---------------------------------------------------------------------------

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 9.7a5.5 5.5 0 1 1-7.2-7.2 4.5 4.5 0 0 0 7.2 7.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M3.4 12.6l1.2-1.2M11.4 4.6l1.2-1.2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2"
        y="3"
        width="12"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M5 14h6M8 11v3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 5h10M6 5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 5l.5 8h5l.5-8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13 8a5 5 0 0 1-9 3M3 8a5 5 0 0 1 9-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M13 3v3h-3M3 13v-3h3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10 12L6 8l4-4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PaintIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 10c0 2 1.5 3.5 3.5 3.5s3.5-1.5 3.5-3.5-1.5-4.5-3.5-6.5C4 5.5 2.5 8 2.5 10Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 2.5a2 2 0 0 1 0 4h-2a2 2 0 0 1 0-4h2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 0L2.5 11.5v3h3v-2h2v-2h1L6 8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
