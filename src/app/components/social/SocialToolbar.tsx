/**
 * SocialToolbar — header band at the top of the social hub.
 *
 * Renders four pieces of metadata, all visible at once:
 *   - Kana caption + page title (matches the lobby's instrument-tape look).
 *   - Handle pill — your `@handle` so you know who you're acting as.
 *   - Sync state — last refresh + a Sync button when you've got follows.
 *   - Share CTA — dispatches the existing topbar event so the composer
 *     opens. This is the same plumbing the AppShell Share button uses;
 *     having a second entry point inside the hub avoids a U-turn through
 *     the topbar for a power user composing several shares in a row.
 */

import type { ShareProfile } from "@shared/types";

interface Props {
  profile: ShareProfile | null;
  profileLoaded: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  followsCount: number;
  onSync: () => void;
}

export function SocialToolbar({
  profile,
  profileLoaded,
  syncing,
  lastSyncedAt,
  followsCount,
  onSync,
}: Props) {
  return (
    <section className="ny-social-toolbar" aria-label="Social hub header">
      <div className="ny-social-toolbar__lead">
        <span className="ny-social-toolbar__kana">
          ソーシャル · NYRIMA SOCIAL
        </span>
        <h1 className="ny-social-toolbar__title">Social</h1>
        <p className="ny-social-toolbar__sub">
          Share what you're watching. Follow other libraries. Keep your shelf
          public on your own terms.
        </p>
      </div>

      <div className="ny-social-toolbar__meta">
        <div className="ny-social-toolbar__handle" data-state={profileLoaded ? "ready" : "loading"}>
          <span className="ny-social-toolbar__handle-label">Acting as</span>
          {profile ? (
            <span className="ny-social-toolbar__handle-value">
              @{profile.handle}
            </span>
          ) : (
            <span className="ny-social-toolbar__handle-value is-muted">
              {profileLoaded ? "Pick a handle" : "…"}
            </span>
          )}
        </div>

        <div className="ny-social-toolbar__sync">
          <span className="ny-social-toolbar__sync-label">
            {syncing
              ? "Syncing…"
              : lastSyncedAt
                ? `Synced ${formatAgo(lastSyncedAt)}`
                : followsCount === 0
                  ? "No follows yet"
                  : "Not synced"}
          </span>
          <button
            type="button"
            className="ny-social-toolbar__sync-btn"
            disabled={syncing || followsCount === 0}
            onClick={onSync}
            aria-label="Sync follows"
            title={
              followsCount === 0
                ? "Follow someone first"
                : "Refresh inbox from Drive"
            }
          >
            <SyncIcon spinning={syncing} />
            <span>Sync</span>
          </button>
        </div>

        <button
          type="button"
          className="ny-social-toolbar__share"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("nyrima:topbar", { detail: { scope: "share" } }),
            )
          }
        >
          <ShareIcon />
          <span>Share current page</span>
        </button>
      </div>
    </section>
  );
}

function formatAgo(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 30_000) return "just now";
  if (delta < 60 * 60_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / (24 * 3_600_000))}d ago`;
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={`ny-social-toolbar__icon${spinning ? " is-spin" : ""}`}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 8a5 5 0 0 1 8.5-3.5L13 6M13 8a5 5 0 0 1-8.5 3.5L3 10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
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

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="12" cy="3.5" r="1.9" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="12.5" r="1.9" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="m5.7 7.05 4.6-2.5M5.7 8.95l4.6 2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
