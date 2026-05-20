/**
 * SocialToolbar + SyncControls — rail header and footer for the social hub.
 *
 * Two small components, exported from one file because they're always
 * rendered together in the rail and refactoring them apart costs more in
 * imports than it saves:
 *
 *   SocialToolbar  — kana caption + page title + one-line subtitle. Sits at
 *                    the top of the rail. Purely presentational.
 *   SyncControls   — sync status line + Sync button + "Share current page"
 *                    CTA. Sits at the bottom of the rail and gets pushed
 *                    down by `margin-top: auto` so it stays anchored even
 *                    when the rail content is short.
 *
 * The Share button re-dispatches the `nyrima:topbar` CustomEvent the
 * AppShell's Share button uses — same composer, two entry points.
 */

import type { ShareProfile } from "@shared/types";

// ---------------------------------------------------------------------------
// SocialToolbar — rail header.
// ---------------------------------------------------------------------------

export function SocialToolbar() {
  return (
    <section className="ny-social-toolbar" aria-label="Social hub header">
      <span className="ny-social-toolbar__kana">
        ソーシャル · NYRIMA SOCIAL
      </span>
      <h1 className="ny-social-toolbar__title">Social</h1>
      <p className="ny-social-toolbar__sub">
        Share what you're watching. Follow other libraries. Keep your shelf
        public on your own terms.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SyncControls — rail footer.
// ---------------------------------------------------------------------------

interface SyncControlsProps {
  /** Used only to gate the "Acting as …" hint when no profile is loaded yet
   *  — handle pill itself lives in the ShelfLinkCard now. */
  profile: ShareProfile | null;
  profileLoaded: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  followsCount: number;
  onSync: () => void;
}

export function SyncControls({
  profile,
  profileLoaded,
  syncing,
  lastSyncedAt,
  followsCount,
  onSync,
}: SyncControlsProps) {
  const statusLabel = syncing
    ? "Syncing…"
    : lastSyncedAt
      ? `Synced ${formatAgo(lastSyncedAt)}`
      : followsCount === 0
        ? profileLoaded && !profile
          ? "Pick a handle"
          : "No follows yet"
        : "Not synced";

  return (
    <section className="ny-social-sync" aria-label="Sync and share controls">
      <div className="ny-social-sync__row">
        <span className="ny-social-sync__label" title={statusLabel}>
          {statusLabel}
        </span>
        <button
          type="button"
          className="ny-social-sync__btn"
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
        className="ny-social-sync__share"
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("nyrima:topbar", { detail: { scope: "share" } }),
          )
        }
        title="Share the current page to your Shared/ folder"
      >
        <ShareIcon />
        <span>Share current page</span>
      </button>
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
      className={`ny-social-sync__icon${spinning ? " is-spin" : ""}`}
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
    <svg
      className="ny-social-sync__icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
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
