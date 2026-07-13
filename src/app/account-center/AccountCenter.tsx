/**
 * AccountCenter — the Discord-style full-screen settings overlay.
 *
 * Layout: a fixed sidebar (search box + grouped section nav + log-out footer)
 * on the left, an independently scrolling content pane in the middle, and a
 * close rail (round X + "ESC") pinned to the content's right edge.
 *
 * Mechanics owned here: Esc close (with search-first semantics), Tab focus
 * trap, document scroll lock, and search jump-to-row highlighting. Open state
 * itself lives in the URL — see AccountCenterHost / useAccountCenter.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import { LogOut, X } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { getSection, SECTIONS, SECTION_GROUPS, type SearchResult } from "./registry";
import { SettingsSearch } from "./SettingsSearch";
import { useFocusTrap } from "./useFocusTrap";
import "./AccountCenter.scss";

interface Props {
  /** Resolved section id (invalid values already fall back upstream). */
  sectionId: string;
  /** "closing" plays the exit animation while the host keeps us mounted. */
  closing: boolean;
  onSelectSection: (id: string) => void;
  onClose: () => void;
}

export default function AccountCenter({
  sectionId,
  closing,
  onSelectSection,
  onClose,
}: Props) {
  const navigate = useNavigate();
  const { status, signOut, exitGuestMode } = useAuth();
  const isGuest = status === "guest";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [highlightSettingId, setHighlightSettingId] = useState<string | null>(null);

  const section = getSection(sectionId);
  const SectionComponent = section.Component;

  useFocusTrap(rootRef, !closing);

  // Lock the document scroll while the overlay is up. AppShell's compact
  // topbar reads window.scrollY, so restore exactly what we found.
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, []);

  // Esc: an inner layer (crop draft, dialogs) that called preventDefault wins;
  // a non-empty search clears first; otherwise close the overlay.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setQuery((current) => {
        if (current.trim()) return "";
        onClose();
        return current;
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Search jump: after the target section renders, scroll its row into view
  // and pulse it.
  useEffect(() => {
    if (!highlightSettingId) return;
    const frame = requestAnimationFrame(() => {
      const el = contentRef.current?.querySelector<HTMLElement>(
        `[data-setting-id="${highlightSettingId}"]`,
      );
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("is-highlighted");
        window.setTimeout(() => el.classList.remove("is-highlighted"), 1800);
      }
    });
    const clear = window.setTimeout(() => setHighlightSettingId(null), 1900);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(clear);
    };
  }, [highlightSettingId, sectionId]);

  function handleSearchSelect(result: SearchResult) {
    setQuery("");
    onSelectSection(result.sectionId);
    setHighlightSettingId(result.settingId);
  }

  async function handleLogOut() {
    if (isGuest) {
      exitGuestMode();
      navigate("/login", { replace: true });
      return;
    }
    onClose();
    await signOut();
    navigate("/", { replace: true });
  }

  const searching = query.trim().length > 0;

  return (
    <div
      ref={rootRef}
      className={cn("ny-ac", { "is-closing": closing })}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="ny-ac__frame">
        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside className="ny-ac__sidebar">
          <div className="ny-ac__sidebar-inner">
            <SettingsSearch
              query={query}
              onQueryChange={setQuery}
              onSelect={handleSearchSelect}
            />

            {!searching && (
              <nav className="ny-ac__nav" aria-label="Settings sections">
                {(["user", "app"] as const).map((group) => (
                  <div className="ny-ac__nav-group" key={group}>
                    <div className="ny-ac__nav-label">{SECTION_GROUPS[group]}</div>
                    {SECTIONS.filter((s) => s.group === group).map((s) => (
                      <button
                        type="button"
                        key={s.id}
                        className={cn("ny-ac__nav-item", {
                          "is-active": s.id === section.id,
                        })}
                        aria-current={s.id === section.id ? "page" : undefined}
                        onClick={() => onSelectSection(s.id)}
                      >
                        <s.Icon aria-hidden="true" />
                        <span>{s.label}</span>
                      </button>
                    ))}
                  </div>
                ))}

                <div className="ny-ac__nav-divider" />
                <button
                  type="button"
                  className="ny-ac__nav-item ny-ac__nav-item--danger"
                  onClick={() => void handleLogOut()}
                >
                  <LogOut aria-hidden="true" />
                  <span>{isGuest ? "Exit Guest Mode" : "Log Out"}</span>
                </button>

                <div className="ny-ac__sidebar-version">Nyrima v0.0.1</div>
              </nav>
            )}
          </div>
        </aside>

        {/* ── Content ─────────────────────────────────────────────── */}
        <div className="ny-ac__main">
          <div ref={contentRef} className="ny-ac__content">
            <h1 className="ny-ac__title">{section.label}</h1>
            <SectionComponent highlightSettingId={highlightSettingId} />
          </div>

          {/* ── Close rail ────────────────────────────────────────── */}
          <div className="ny-ac__close-rail">
            <button
              type="button"
              className="ny-ac__close"
              aria-label="Close settings"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
            <span className="ny-ac__close-hint" aria-hidden="true">
              ESC
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
