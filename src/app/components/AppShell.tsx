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
 * Phase 4 (sharing layer) hooks: Inbox / Friends / Search / Share buttons
 * render as stubs today. They log a debug breadcrumb on click and carry
 * `aria-label` + `title` so the chrome is keyboard-accessible the moment
 * Phase 4 wires real actions in.
 *
 * We sidestep Once UI's `Row`/`Heading`/`Button` chrome here because the
 * minimal-tech look needs precise hairline borders, monospace tracking, and
 * custom focus rings that fight Once UI's defaults. Routed page content
 * keeps using Once UI for forms and dialogs.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import cn from "classnames";
import { NyrimaMark } from "./NyrimaMark";
import { UserChip } from "./UserChip";
import { debugLog } from "../services/debug-log";
import "./AppShell.scss";

/** Scroll distance past which the topbar collapses into the compact pill. */
const COMPACT_SCROLL_THRESHOLD = 24;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const isCompact = useScrollPastThreshold(COMPACT_SCROLL_THRESHOLD);

  return (
    <div className="dc-shell">
      <header
        className={cn("dc-shell__header", { "is-compact": isCompact })}
        data-compact={isCompact ? "1" : "0"}
      >
        <Link to="/" className="dc-shell__brand" aria-label="Nyrima home">
          <NyrimaMark size="header" />
          <span className="dc-shell__wordmark">
            <span className="dc-shell__name">
              Nyri<span className="dc-shell__name-accent">ma</span>
            </span>
          </span>
        </Link>

        <nav className="dc-shell__nav" aria-label="Primary">
          <button
            type="button"
            className="dc-shell__nav-btn"
            onClick={() => navigate("/")}
            aria-label="Libraries"
            title="Libraries"
          >
            <FolderIcon />
            <span className="dc-shell__nav-btn-label">Libraries</span>
          </button>

          <Phase4Button
            icon={<SearchIcon />}
            label="Search"
            scope="search"
          />
          <Phase4Button
            icon={<PeopleIcon />}
            label="Friends"
            scope="friends"
          />
          <Phase4Button icon={<InboxIcon />} label="Inbox" scope="inbox" />
          <Phase4Button
            icon={<ShareIcon />}
            label="Share"
            scope="share"
            primary
          />

          <UserChip />
        </nav>
      </header>

      <main className="dc-page">{children}</main>

      <footer className="dc-shell__footer">
        <span>SYS · READY</span>
        <span className="dc-shell__footer-center">
          nyrima · personal cinema for google drive
        </span>
        <span className="dc-shell__footer-right">BUILD 0.0.1 · NYRIMA</span>
      </footer>
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
// Phase 4 stub button.
//
// Renders the chrome (icon + label + focus ring) so the topbar is visually
// complete today. The click handler logs a breadcrumb and dispatches a
// `nyrima:topbar` CustomEvent so Phase 4 work can attach a real handler
// without touching AppShell. The `data-scope` attribute lets dev tools and
// future analytics filter by which slot was activated.
// ---------------------------------------------------------------------------

type Phase4Scope = "search" | "friends" | "inbox" | "share";

function Phase4Button({
  icon,
  label,
  scope,
  primary,
}: {
  icon: ReactNode;
  label: string;
  scope: Phase4Scope;
  primary?: boolean;
}) {
  const handle = () => {
    debugLog(`[topbar] ${scope} (Phase 4 — coming soon)`);
    window.dispatchEvent(
      new CustomEvent("nyrima:topbar", { detail: { scope } }),
    );
  };
  return (
    <button
      type="button"
      className={cn("dc-shell__nav-btn", {
        "dc-shell__nav-btn--primary": primary,
      })}
      onClick={handle}
      aria-label={label}
      title={`${label} — coming in Phase 4 (sharing layer)`}
      data-scope={scope}
    >
      {icon}
      <span className="dc-shell__nav-btn-label">{label}</span>
    </button>
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

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="m10.5 10.5 3 3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M2 13.5c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle
        cx="11.5"
        cy="6.5"
        r="2"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.75"
      />
      <path
        d="M10.2 12.6c.2-1.4 1.5-2.5 3.05-2.5 .9 0 1.7.35 2.25.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.6 8.6 4 3.7A1.5 1.5 0 0 1 5.45 2.6h5.1A1.5 1.5 0 0 1 12 3.7l1.4 4.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M2.5 8.6h2.9l.85 1.7h3.5l.85-1.7h2.9v3.4a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5V8.6Z"
        stroke="currentColor"
        strokeWidth="1.2"
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
