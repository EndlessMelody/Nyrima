/**
 * ShortcutsOverlayHost — global "what can I press?" dialog.
 *
 * Opens on `?` (outside form fields) or the `nyrima:shortcuts` CustomEvent
 * (dispatched by UserCenter's "Keyboard shortcuts" quick link). Suppressed on
 * `/play/*` and `/read/*` — the player and reader already own `?` for their
 * own, more detailed shortcut sheets, so this only covers the app-wide keys.
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import "./ShortcutsOverlay.scss";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

const GLOBAL_SHORTCUTS: Array<[string, string]> = [
  ["Ctrl K", "Focus search"],
  ["/", "Focus search"],
  ["?", "Show this dialog"],
  ["Esc", "Close dialogs / dropdowns"],
];

export function ShortcutsOverlayHost() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ownsQuestionMark =
    !location.pathname.startsWith("/play/") && !location.pathname.startsWith("/read/");

  useEffect(() => {
    function onCustomOpen() {
      setOpen(true);
    }
    window.addEventListener("nyrima:shortcuts", onCustomOpen);
    return () => window.removeEventListener("nyrima:shortcuts", onCustomOpen);
  }, []);

  useEffect(() => {
    if (!ownsQuestionMark) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "?" && !isTypingTarget(e.target) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ownsQuestionMark]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="ny-shortcuts-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={() => setOpen(false)}
    >
      <div className="ny-shortcuts-overlay__card" onClick={(e) => e.stopPropagation()}>
        <header className="ny-shortcuts-overlay__head">
          <h2>Keyboard shortcuts</h2>
          <button
            type="button"
            className="ny-shortcuts-overlay__close"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <section className="ny-shortcuts-overlay__group">
          <h3>Global</h3>
          <dl>
            {GLOBAL_SHORTCUTS.map(([keys, label]) => (
              <div className="ny-shortcuts-overlay__row" key={keys}>
                <dt>{keys}</dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="ny-shortcuts-overlay__note">
          The video player and the Light Novel reader have their own, more detailed
          shortcut sheets — press <kbd>?</kbd> while watching or reading to see them.
        </p>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 3.5l9 9M12.5 3.5l-9 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
