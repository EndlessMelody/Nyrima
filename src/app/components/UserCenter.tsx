/**
 * UserCenter — slim quick-menu dropdown from the header UserChip.
 *
 * Discord-style: a profile card (avatar, name, email) plus quick links into
 * the Account Center, a theme toggle, and sign-out. All the settings controls
 * this panel used to hold (playback, storage, API drill-ins) live in the
 * Account Center overlay now.
 *
 * Identity shown is the Nyrima account when signed in (nickname override
 * first), falling back to the Google Drive profile — a deliberate change from
 * the old panel, which only ever showed the Drive identity.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";
import cn from "classnames";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "../providers/AppProviders";
import { useSettingsStore } from "../stores/settings-store";
import { useRecentStore } from "../stores/recent-store";
import { useAccountCenter } from "../account-center/useAccountCenter";
import { useMostRecentInProgress } from "../hooks/useMostRecentInProgress";
import { parseTitle } from "@shared/title-parser";
import { formatRuntime, formatTimecode } from "../services/formatters";
import type { UserProfile } from "@shared/types";

import "./UserCenter.scss";

interface Props {
  /** Google Drive profile (streaming identity) — the fallback identity. */
  profile: UserProfile | null;
  onClose: () => void;
}

export function UserCenter({ profile, onClose }: Props) {
  const navigate = useNavigate();
  const { status, account, signOut, exitGuestMode } = useAuth();
  const isGuest = status === "guest";
  const { mode, setMode } = useTheme();
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);
  const accountCenter = useAccountCenter();

  const displayName =
    settings.profileNickname ||
    account?.displayName ||
    profile?.name ||
    "Guest";
  const email = account?.email ?? profile?.email;
  const avatarUrl = settings.profileAvatarDataUrl ?? profile?.picture;
  const initial = displayName[0]?.toUpperCase() ?? "G";

  const openSection = useCallback(
    (sectionId?: string) => {
      onClose();
      accountCenter.open(sectionId);
    },
    [accountCenter, onClose],
  );

  const handleSignOut = useCallback(async () => {
    onClose();
    await signOut();
    navigate("/", { replace: true });
  }, [onClose, signOut, navigate]);

  // Leave "Try Nyrima" guest mode. Clears only the local guest marker (Drive
  // stays connected for a later visit) and returns to the login threshold.
  const handleExitGuest = useCallback(() => {
    exitGuestMode();
    onClose();
    navigate("/login", { replace: true });
  }, [exitGuestMode, onClose, navigate]);

  const resumePosition = useMostRecentInProgress();
  const recentFolders = useRecentStore((s) => s.folders);
  const loadRecents = useRecentStore((s) => s.load);
  useEffect(() => {
    void loadRecents();
  }, [loadRecents]);
  const resumeFolderName = useMemo(
    () => recentFolders.find((f) => f.id === resumePosition?.folderId)?.name ?? "",
    [recentFolders, resumePosition],
  );
  const resumeParsed = useMemo(
    () =>
      resumePosition
        ? parseTitle({
            filename: resumePosition.name ?? "Unknown",
            parentFolder: resumeFolderName,
          })
        : null,
    [resumePosition, resumeFolderName],
  );
  const handleResume = useCallback(() => {
    if (!resumePosition?.folderId) return;
    onClose();
    navigate(
      `/play/${encodeURIComponent(resumePosition.folderId)}/${encodeURIComponent(resumePosition.fileId)}`,
    );
  }, [resumePosition, onClose, navigate]);

  const handleShortcuts = useCallback(() => {
    onClose();
    window.dispatchEvent(new CustomEvent("nyrima:shortcuts"));
  }, [onClose]);

  const handleViewDashboard = useCallback(() => {
    onClose();
    navigate("/u/me");
  }, [onClose, navigate]);

  return (
    <div className="dc-uc" role="dialog" aria-label="User menu">
      {/* ── Guest session ─────────────────────────────────────────── */}
      {isGuest && (
        <>
          <div className="dc-uc__guest">
            <div className="dc-uc__guest-text">
              <span className="dc-uc__guest-tag">Guest mode</span>
              <span className="dc-uc__guest-sub">
                No Nyrima account — social &amp; cloud sync are off.
              </span>
            </div>
            <button
              type="button"
              className="dc-uc__sign-out"
              onClick={handleExitGuest}
            >
              Exit guest mode
            </button>
          </div>
          <div className="dc-uc__divider" />
        </>
      )}

      {/* ── Profile card ──────────────────────────────────────────── */}
      <div
        className="dc-uc__identity-card"
        style={
          settings.profileBannerDataUrl
            ? { ["--uc-banner" as never]: `url(${settings.profileBannerDataUrl})` }
            : undefined
        }
      >
        <div className="dc-uc__identity-banner" aria-hidden="true" />
        <div className="dc-uc__identity">
          {avatarUrl ? (
            <img
              className="dc-uc__avatar"
              src={avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="dc-uc__avatar dc-uc__avatar--mono">{initial}</span>
          )}
          <div className="dc-uc__identity-text">
            <span className="dc-uc__name">{displayName}</span>
            {email && <span className="dc-uc__email">{email}</span>}
          </div>
        </div>
      </div>

      {resumePosition && resumeParsed && (
        <>
          <div className="dc-uc__divider" />
          <button
            type="button"
            className="dc-uc__resume"
            onClick={handleResume}
            title={resumeParsed.fullTitle}
          >
            <PlayIcon />
            <div className="dc-uc__resume-text">
              <span className="dc-uc__resume-title">{resumeParsed.fullTitle}</span>
              <span className="dc-uc__resume-meta">
                {formatTimecode(resumePosition.positionSeconds)} /{" "}
                {formatTimecode(resumePosition.durationSeconds)}
                {resumePosition.durationSeconds > resumePosition.positionSeconds && (
                  <>
                    {" "}
                    ·{" "}
                    {formatRuntime(
                      resumePosition.durationSeconds - resumePosition.positionSeconds,
                    )}{" "}
                    left
                  </>
                )}
              </span>
              <div className="dc-uc__resume-track">
                <div
                  className="dc-uc__resume-bar"
                  style={{
                    width: `${
                      resumePosition.durationSeconds > 0
                        ? Math.min(
                            100,
                            (resumePosition.positionSeconds /
                              resumePosition.durationSeconds) *
                              100,
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </button>
        </>
      )}

      <div className="dc-uc__divider" />

      {/* ── Quick links ───────────────────────────────────────────── */}
      <div className="dc-uc__section">
        <div className="dc-uc__actions">
          <button
            type="button"
            className="dc-uc__action"
            onClick={() => openSection("my-account")}
          >
            <UserIcon />
            <span>My Account</span>
          </button>
          {!isGuest && (
            <button type="button" className="dc-uc__action" onClick={handleViewDashboard}>
              <LayoutDashboard size={16} aria-hidden="true" />
              <span>View my dashboard</span>
            </button>
          )}
          <button
            type="button"
            className="dc-uc__action"
            onClick={() => openSection("profile")}
          >
            <PencilIcon />
            <span>Edit Profile</span>
          </button>
          <button
            type="button"
            className="dc-uc__action"
            onClick={() => openSection("appearance")}
          >
            <GearIcon />
            <span>Settings</span>
          </button>
          <button type="button" className="dc-uc__action" onClick={handleShortcuts}>
            <ShortcutsIcon />
            <span>Keyboard shortcuts</span>
          </button>
        </div>
      </div>

      <div className="dc-uc__divider" />

      {/* ── Theme ─────────────────────────────────────────────────── */}
      <div className="dc-uc__section">
        <div className="dc-uc__section-label">Theme</div>
        <div className="dc-uc__pills">
          {(["dark", "light", "system"] as const).map((m) => (
            <button
              type="button"
              key={m}
              className={cn("dc-uc__pill", { "is-active": mode === m })}
              onClick={() => {
                setMode(m);
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

      {!isGuest && (
        <>
          <div className="dc-uc__divider" />
          <div className="dc-uc__section">
            <div className="dc-uc__actions">
              <button
                type="button"
                className="dc-uc__action dc-uc__action--danger"
                onClick={() => void handleSignOut()}
              >
                <SignOutIcon />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline icons — 16×16 hairline strokes matching AppShell style.
// ---------------------------------------------------------------------------

function UserIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5.5" r="2.6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M2.8 13.5c0-2.4 2.3-4.1 5.2-4.1s5.2 1.7 5.2 4.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9.8 3.2 12.8 6.2M3 13l.6-3 7.2-7.2a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L6.6 13l-3.6.6.0-.6Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.5 2.8v10.4l9-5.2-9-5.2Z" fill="currentColor" />
    </svg>
  );
}

function ShortcutsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M4.5 9.5h7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.5 2.5H4a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 4 13.5h2.5M10.5 11l3-3-3-3M13.2 8H6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
