/**
 * SocialTabs — the tab strip under the toolbar.
 *
 * Each tab renders an icon, a label, and an optional count chip. Counts have
 * two flavours: "badge" (Inbox unread → brand-tinted dot + number, pulled
 * toward the user's eye) and "muted" (everything else → quiet hairline pill).
 *
 * The strip itself is purely presentational — the page owns URL routing.
 */

import type { ReactNode } from "react";
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

interface Props {
  current: SocialTabKey;
  counts: Record<SocialTabKey, number>;
  onChange: (next: SocialTabKey) => void;
}

export function SocialTabs({ current, counts, onChange }: Props) {
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
