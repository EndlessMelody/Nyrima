/**
 * AppShell renders the persistent chrome around the routed page.
 *
 * Obsidian Atelier model:
 *   - A 64px-tall sticky header with a hairline bottom border, blurred
 *     surface backdrop, a refined hairline-tiled brand mark on the left, and
 *     mono-typeset navigation buttons on the right.
 *   - The routed page sits in `.dc-page` (a centered 1280px column) below.
 *   - A quiet footer band with a single mono status line + version stamp.
 *
 * We sidestep Once UI's `Row`/`Heading`/`Button` chrome here because the
 * minimal-tech look needs precise hairline borders, monospace tracking, and
 * custom focus rings that fight Once UI's defaults. Routed page content
 * keeps using Once UI for forms and dialogs.
 */

import { type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "../providers/AppProviders";
import { NyrimaMark } from "./NyrimaMark";
import "./AppShell.scss";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { resolved, setMode } = useTheme();

  return (
    <div className="dc-shell">
      <header className="dc-shell__header">
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
          >
            <FolderIcon />
            <span>Libraries</span>
          </button>
          <button
            type="button"
            className="dc-shell__nav-btn dc-shell__nav-btn--icon"
            onClick={() => setMode(resolved === "dark" ? "light" : "dark")}
            aria-label={
              resolved === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            title={
              resolved === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
          >
            {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
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
// Minimal hairline icons — drawn as 1.5px strokes to read as instruments
// rather than illustration. Kept inline so they share the system color.
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
