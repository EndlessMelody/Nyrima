/**
 * Social tabs / section picker.
 *
 * Two shapes share the same source-of-truth tab list:
 *
 *   `SocialTabs`             — legacy horizontal strip (no longer mounted by
 *                              SocialPage, kept as an export in case another
 *                              surface wants a quick tabstrip).
 *   `SocialSectionPicker`    — compact rail control: a single trigger button
 *                              shows the current section; clicking opens a
 *                              floating popover with all five rows.
 *
 * Counts have two flavours: "badge" (Inbox unread → brand-tinted) and
 * "muted" (everything else → quiet hairline pill).
 *
 * Keyboard model for the picker:
 *   - `g` (while on `/social`, not inside an input) opens it.
 *   - ↑/↓ moves focus, Enter activates, Escape closes.
 *   - Outside click closes.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import cn from "classnames";

export type SocialTabKey =
  | "inbox"
  | "mine"
  | "people"
  | "activity"
  | "privacy";

interface TabDef {
  key: SocialTabKey;
  label: string;
  icon: ReactNode;
  /** Counts of this kind read brand-tinted. Falsy = muted pill. */
  badge?: boolean;
}

export const SOCIAL_TABS: TabDef[] = [
  { key: "inbox", label: "Inbox", icon: <InboxIcon />, badge: true },
  { key: "mine", label: "My Shares", icon: <FolderIcon /> },
  { key: "people", label: "People", icon: <PeopleIcon /> },
  { key: "activity", label: "Activity", icon: <ChatIcon /> },
  { key: "privacy", label: "Privacy", icon: <ShieldIcon /> },
];

interface TabsProps {
  current: SocialTabKey;
  counts: Record<SocialTabKey, number>;
  onChange: (next: SocialTabKey) => void;
}

export function SocialTabs({ current, counts, onChange }: TabsProps) {
  return (
    <nav className="ny-social-tabs" role="tablist" aria-label="Social sections">
      {SOCIAL_TABS.map((t) => {
        const count = counts[t.key];
        const isCurrent = t.key === current;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isCurrent}
            className={cn("ny-social-tabs__btn", {
              "is-current": isCurrent,
            })}
            onClick={() => onChange(t.key)}
          >
            <span className="ny-social-tabs__icon">{t.icon}</span>
            <span className="ny-social-tabs__label">{t.label}</span>
            {count > 0 && (
              <span
                className={cn("ny-social-tabs__chip", {
                  "is-badge": t.badge,
                })}
                aria-label={`${count} ${count === 1 ? "item" : "items"}`}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// SocialSectionPicker — compact rail control.
//
// Pattern: one trigger button (current section + caret) opens a floating
// popover anchored beneath it. The popover is absolutely positioned inside
// the picker's relative wrapper, so it inherits the trigger's width by
// default and scales with the rail. We keep focus management lightweight:
// focusing the trigger after a selection (so the user can re-open with Enter)
// and a `focusedKey` cursor inside the popover for arrow navigation.
//
// "g" shortcut: a window-level keydown listener that ignores typing surfaces
// (inputs, textareas, contenteditable). When the user is anywhere on /social,
// pressing g opens the picker. We don't preventDefault unless we're actually
// triggering — leaves other "g" key handlers alone.
// ---------------------------------------------------------------------------

interface PickerProps {
  current: SocialTabKey;
  counts: Record<SocialTabKey, number>;
  onChange: (next: SocialTabKey) => void;
  /** Set false to disable the global `g` keybind (e.g., when a dialog steals
   *  page-level focus). Defaults to enabled. */
  shortcut?: boolean;
}

export function SocialSectionPicker({
  current,
  counts,
  onChange,
  shortcut = true,
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [focusedKey, setFocusedKey] = useState<SocialTabKey>(current);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverId = useId();

  const currentTab = useMemo(
    () => SOCIAL_TABS.find((t) => t.key === current) ?? SOCIAL_TABS[0],
    [current],
  );
  const currentCount = counts[currentTab.key];

  // Reset the focus cursor whenever the popover opens, so the highlight
  // tracks the active section instead of the previous arrow-key landing.
  useLayoutEffect(() => {
    if (open) setFocusedKey(current);
  }, [open, current]);

  // Outside-click + Escape close. Bound only while open so we don't pay the
  // listener cost on every render of the rail.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Global "g" keybind. Skip when the user is typing (inputs, textareas,
  // contenteditable, select elements) — otherwise filling out the share
  // composer would yank focus out from under them.
  useEffect(() => {
    if (!shortcut) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "g" && e.key !== "G") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      setOpen((v) => !v);
      // Defer focus so the popover has a chance to mount before we shift
      // focus into it on the next render.
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  function selectKey(next: SocialTabKey) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onPopoverKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const i = SOCIAL_TABS.findIndex((t) => t.key === focusedKey);
      setFocusedKey(SOCIAL_TABS[(i + 1) % SOCIAL_TABS.length].key);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const i = SOCIAL_TABS.findIndex((t) => t.key === focusedKey);
      setFocusedKey(
        SOCIAL_TABS[(i - 1 + SOCIAL_TABS.length) % SOCIAL_TABS.length].key,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectKey(focusedKey);
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusedKey(SOCIAL_TABS[0].key);
    } else if (e.key === "End") {
      e.preventDefault();
      setFocusedKey(SOCIAL_TABS[SOCIAL_TABS.length - 1].key);
    }
  }

  return (
    <div className="ny-section-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ny-section-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ny-section-picker__trigger-icon" aria-hidden="true">
          {currentTab.icon}
        </span>
        <span className="ny-section-picker__trigger-label">
          {currentTab.label}
        </span>
        {currentCount > 0 && (
          <span
            className="ny-section-picker__trigger-chip"
            aria-label={`${currentCount} ${currentCount === 1 ? "item" : "items"}`}
          >
            {currentCount > 99 ? "99+" : currentCount}
          </span>
        )}
        <CaretIcon className="ny-section-picker__caret" />
      </button>

      {open && (
        <div
          id={popoverId}
          role="listbox"
          aria-label="Social sections"
          tabIndex={-1}
          className="ny-section-picker__popover"
          onKeyDown={onPopoverKey}
          /* Focus the listbox on mount so arrow keys work without a click. */
          ref={(el) => el?.focus()}
        >
          {SOCIAL_TABS.map((t) => {
            const count = counts[t.key];
            const isCurrent = t.key === current;
            const isFocused = t.key === focusedKey;
            return (
              <button
                key={t.key}
                type="button"
                role="option"
                aria-selected={isCurrent}
                className={cn("ny-section-picker__item", {
                  "is-current": isCurrent,
                  "is-focused": isFocused,
                })}
                onMouseEnter={() => setFocusedKey(t.key)}
                onClick={() => selectKey(t.key)}
              >
                <span
                  className="ny-section-picker__item-icon"
                  aria-hidden="true"
                >
                  {t.icon}
                </span>
                <span className="ny-section-picker__item-label">{t.label}</span>
                {count > 0 && (
                  <span
                    className={cn("ny-section-picker__item-chip", {
                      "is-badge": t.badge,
                    })}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            );
          })}
          <div className="ny-section-picker__hint" aria-hidden="true">
            <span className="ny-section-picker__kbd">g</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CaretIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
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
      <circle cx="11.5" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.2" opacity="0.75" />
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

function ChatIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5V10a1.5 1.5 0 0 1-1.5 1.5H7L4 14v-2.5h-.5A1.5 1.5 0 0 1 2 10V5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.2 13 4v4c0 3-2.2 5.2-5 5.8C5.2 13.2 3 11 3 8V4l5-1.8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="m5.8 8 1.5 1.5 3-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
