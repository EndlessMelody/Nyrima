/**
 * AppShell renders the persistent chrome around the routed page.
 *
 * Obsidian Atelier model:
 *   - A sticky topbar that morphs on scroll: at scroll=0 it spans the full
 *     viewport (64px tall, edge-to-edge hairline), past a small threshold it
 *     shrinks horizontally into a centered pill anchored at the top edge.
 *     The visual is a hybrid "dynamic island" — same focus / keyboard model
 *     as the static bar, no overlap with content beneath, just narrower and
 *     softer.
 *   - The routed page sits in `.dc-page` (centered 1280px column) below.
 *   - A quiet footer band with a single mono status line + version stamp.
 *
 * Phase 4 (sharing layer) lives in the topbar as two affordances:
 *   - Social → routes to `/social` (the hub: Inbox, My Shares, People,
 *     Activity, Privacy). Renders an unread-count badge from the social
 *     store.
 *   - Share → opens the composer via the `nyrima:topbar` CustomEvent
 *     (SharingHost listens). Stays in chrome because the composer is
 *     page-contextual — fired from anywhere, the composer infers its
 *     target from the current route.
 *
 * We sidestep Once UI's `Row`/`Heading`/`Button` chrome here because the
 * minimal-tech look needs precise hairline borders, monospace tracking, and
 * custom focus rings that fight Once UI's defaults. Routed page content
 * keeps using Once UI for forms and dialogs.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import cn from "classnames";
import { useAuth } from "@/auth/AuthProvider";
import { NyrimaMark } from "./NyrimaMark";
import { UserChip } from "./UserChip";
import { TopbarSearch } from "./TopbarSearch";
import { AppFooter } from "./AppFooter";
import { GuestBanner } from "./GuestBanner";
import { useSocialStore } from "../stores/social-store";
import { debugLog } from "../services/debug-log";
import { isLibraryChromeRoute } from "../navigation/sidebar-nav";
import { MUSIC_PLAYER_ROUTE_PREFIX } from "../services/music-player";
import "./AppShell.scss";

/** Scroll distance past which the topbar collapses into the compact pill. */
const COMPACT_SCROLL_THRESHOLD = 24;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isLobbyRoute = location.pathname === "/app";
  // The unified Library hub and dedicated category routes own their own
  // sidebar + command bar chrome. Drive-folder routes under /library/:folderId
  // keep the historical topbar, so this check is exact-route based.
  const isMusicPlayerRoute = location.pathname.startsWith(MUSIC_PLAYER_ROUTE_PREFIX);
  // The watch room (video player) owns its own glass header + back control, so
  // it runs full-bleed like the music player rather than under the app topbar.
  const isWatchRoomRoute = location.pathname.startsWith("/play/");
  // The Light Novel reader owns its own quiet two-column chrome and runs
  // full-bleed — the app topbar would fight its calm, reading-first layout.
  const isReaderRoute = location.pathname.startsWith("/read/");
  const isImmersiveRoute =
    isLobbyRoute ||
    isLibraryChromeRoute(location.pathname) ||
    isMusicPlayerRoute ||
    isWatchRoomRoute ||
    isReaderRoute;
  const isCompact = useScrollPastThreshold(COMPACT_SCROLL_THRESHOLD);
  // Sharing publishes to the social backend — a guest can't, so the Share CTA
  // is hidden for them. The Social button stays (it leads to a friendly
  // sign-in prompt, not a dead end).
  const { canAccess } = useAuth();
  const canShare = canAccess("social:profile");

  // Apply the app palette while inside protected routes. The lobby owns the
  // pink/cyan dashboard identity; older routed chrome keeps its existing
  // yellow/red Once UI accent mapping.
  useEffect(() => {
    const html = document.documentElement;
    const prevBrand = html.getAttribute("data-brand");
    const prevAccent = html.getAttribute("data-accent");
    html.setAttribute("data-brand", isImmersiveRoute ? "pink" : "yellow");
    html.setAttribute("data-accent", isImmersiveRoute ? "cyan" : "red");
    return () => {
      if (prevBrand) html.setAttribute("data-brand", prevBrand);
      if (prevAccent) html.setAttribute("data-accent", prevAccent);
    };
  }, [isImmersiveRoute]);

  // Topbar unread badge — pulls live from the social store. The store is a
  // zero-cost subscription when nothing's followed (initial state).
  const unreadCount = useSocialStore((s) => s.unreadCount);
  const loadFollows = useSocialStore((s) => s.loadFollows);
  const syncInbox = useSocialStore((s) => s.syncInbox);
  useEffect(() => {
    void loadFollows().then(() => {
      // Only attempt a sync if there's anything to pull. The store gates
      // internally too, but this avoids spinning up the Drive queue at all.
      const { followedUsers } = useSocialStore.getState();
      if (followedUsers.length > 0) void syncInbox();
    });
  }, [loadFollows, syncInbox]);

  const onSocialRoute = location.pathname.startsWith("/social");

  if (isImmersiveRoute) {
    return (
      <div className="dc-shell dc-shell--lobby">
        <main className="dc-lobby-page">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="dc-shell">
      <header
        className={cn("dc-shell__header", { "is-compact": isCompact })}
        data-compact={isCompact ? "1" : "0"}
      >
        <Sakura />

        <Link to="/app" className="dc-shell__brand" aria-label="Nyrima lobby">
          <NyrimaMark size="header" />
          <span className="dc-shell__wordmark">
            <span className="dc-shell__name">
              Nyri<span className="dc-shell__name-accent">ma</span>
            </span>
          </span>
        </Link>

        <TopbarSearch isCompact={isCompact} />

        <nav className="dc-shell__nav" aria-label="Primary">
          <button
            type="button"
            className={cn("dc-shell__nav-btn", {
              "is-current":
                location.pathname === "/app" ||
                location.pathname.startsWith("/library"),
            })}
            onClick={() => navigate("/app")}
            aria-label="Libraries"
            title="Libraries"
          >
            <FolderIcon />
            <span className="dc-shell__nav-btn-label">Libraries</span>
          </button>

          <button
            type="button"
            className={cn("dc-shell__nav-btn", "dc-shell__nav-btn--social", {
              "is-current": onSocialRoute,
              "has-unread": unreadCount > 0,
            })}
            onClick={() => navigate("/social")}
            aria-label={
              unreadCount > 0
                ? `Social (${unreadCount} unread)`
                : "Social"
            }
            title="Social — Inbox, People, Privacy"
          >
            <SocialIcon />
            <span className="dc-shell__nav-btn-label">Social</span>
            {unreadCount > 0 && (
              <span className="dc-shell__nav-badge" aria-hidden="true">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            className={cn("dc-shell__nav-btn", {
              "is-current": location.pathname.startsWith("/posts"),
            })}
            onClick={() => navigate("/posts")}
            aria-label="Posts"
            title="Posts — write and read blog posts"
          >
            <PostsIcon />
            <span className="dc-shell__nav-btn-label">Posts</span>
          </button>

          {canShare && <ShareButton />}

          <button
            type="button"
            className={cn("dc-shell__nav-btn", {
              "is-current":
                location.pathname === "/settings" ||
                location.pathname === "/account",
            })}
            onClick={() => navigate("/settings")}
            aria-label="Settings"
            title="Settings"
          >
            <GearIcon />
            <span className="dc-shell__nav-btn-label">Settings</span>
          </button>

          <UserChip />
        </nav>
      </header>

      <main className="dc-page">
        <GuestBanner />
        {children}
      </main>

      <AppFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scroll listener — RAF-throttled, passive, returns a boolean signal.
// ---------------------------------------------------------------------------

function useScrollPastThreshold(thresholdPx: number): boolean {
  const [past, setPast] = useState(() =>
    typeof window === "undefined" ? false : window.scrollY > thresholdPx,
  );
  useEffect(() => {
    let raf = 0;
    let last = past;
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = window.scrollY > thresholdPx;
        if (next !== last) {
          last = next;
          setPast(next);
        }
      });
    }
    // Resync on mount in case the page landed already scrolled.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
    // `past` deliberately excluded — read via the `last` closure ref so the
    // listener isn't reattached on every state flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thresholdPx]);
  return past;
}

// ---------------------------------------------------------------------------
// Share button — primary CTA that opens the composer.
//
// Stays in chrome (rather than only in the Social hub) because it's
// page-contextual: the composer infers its target from the current route,
// so the user wants to fire it without a detour. SharingHost listens for
// the `nyrima:topbar` CustomEvent and renders the dialog.
// ---------------------------------------------------------------------------

function ShareButton() {
  const handle = () => {
    debugLog("[topbar] share");
    window.dispatchEvent(
      new CustomEvent("nyrima:topbar", { detail: { scope: "share" } }),
    );
  };
  return (
    <button
      type="button"
      className="dc-shell__nav-btn dc-shell__nav-btn--primary"
      onClick={handle}
      aria-label="Share"
      title="Share the current page to your Shared/ folder"
      data-scope="share"
    >
      <ShareIcon />
      <span className="dc-shell__nav-btn-label">Share</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sakura — ambient falling petals, confined to the topbar.
//
// 8 absolutely-positioned spans, each a tiny gradient SVG painted into a
// background-image. All motion is CSS keyframes; the React side is
// presentational. `aria-hidden` because it's pure decoration. Honors
// `prefers-reduced-motion` (the SCSS drops the container entirely there).
// ---------------------------------------------------------------------------

function Sakura() {
  return (
    <div className="dc-shell__sakura" aria-hidden="true">
      {/* Eight petals — count matches the SCSS `.ny-petal--N` rules.
       *  Adding/removing requires the matching SCSS edit. */}
      <span className="ny-petal ny-petal--1" />
      <span className="ny-petal ny-petal--2" />
      <span className="ny-petal ny-petal--3" />
      <span className="ny-petal ny-petal--4" />
      <span className="ny-petal ny-petal--5" />
      <span className="ny-petal ny-petal--6" />
      <span className="ny-petal ny-petal--7" />
      <span className="ny-petal ny-petal--8" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal hairline icons — 1.2px strokes to read as instruments rather than
// illustration. Kept inline so they share the system color.
// ---------------------------------------------------------------------------

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.4a1.5 1.5 0 0 1 1.06.44L8.2 4.3a1 1 0 0 0 .7.3H12.5A1.5 1.5 0 0 1 14 6.1V11.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SocialIcon() {
  // Two concentric people silhouettes — reads as "your circle" and stays
  // legible at 14px. We render the front silhouette stronger so a partial
  // glance still parses it as a person, not a generic blob.
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6.2" cy="6.2" r="2.4" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M2 13.5c0-2.2 1.9-3.8 4.2-3.8s4.2 1.6 4.2 3.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle
        cx="11.5"
        cy="5.4"
        r="1.8"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.7"
      />
      <path
        d="M10.4 11.3c.4-1.1 1.7-1.9 3.05-1.9 .9 0 1.7.34 2.25.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

function PostsIcon() {
  // A page with a folded corner + text lines — reads as "article/post"
  // alongside the Social people-glyph and Settings gear.
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 2h5l3 3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path
        d="M5 8.5h6M5 10.8h4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
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
