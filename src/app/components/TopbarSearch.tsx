/**
 * TopbarSearch — the flex pill in the middle of the AppShell header.
 *
 * What it searches:
 *   - Libraries (folder names from the Nyrima root scan).
 *   - People you follow (handle + display name).
 *   - Shares (titles from your own index + your inbox).
 *
 * What it doesn't (yet): individual videos inside libraries. The metadata
 * cache only covers libraries the user has actually visited, so episode
 * search would surface a partial dataset by accident — pulled out for a
 * future pass that walks the cache deliberately.
 *
 * Sizing model:
 *   - The pill is the grid's middle column (`minmax(0, 1fr)` in AppShell),
 *     so it stretches as the bar widens and shrinks when the bar collapses
 *     into the compact pill. We layer additional `max-width` caps inside
 *     so the input doesn't get awkwardly wide on a 1920px viewport.
 *   - In the broad state: 480px cap, full placeholder.
 *   - In the compact state: 280px cap, abbreviated placeholder.
 *
 * Keyboard:
 *   - "/" focuses (global, when not inside another input).
 *   - "Esc" blurs + closes the panel.
 *   - "↑/↓" walk the result list; Enter activates.
 *
 * Results render into a portal-free absolute popover anchored below the
 * pill. The popover closes on outside-pointer-down and route changes —
 * navigating to a result drops the panel without an extra click.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import cn from "classnames";
import { useNyrimaRootStore } from "../stores/nyrima-root-store";
import { useSocialStore } from "../stores/social-store";
import { useSharingStore } from "../stores/sharing-store";
import { targetDriveUrl } from "./social/InboxList";
import "./TopbarSearch.scss";

interface ResultItem {
  /** Stable id for keying + arrow-key tracking. */
  key: string;
  /** Visual group on the popover. */
  kind: "library" | "person" | "share";
  /** Primary label shown bold. */
  title: string;
  /** Secondary line (handle, "library", caption, etc.). */
  subtitle?: string;
  /** Optional poster / avatar URL. */
  imageUrl?: string;
  /** Action when activated. Either a router path or a callback. */
  onActivate: () => void;
}

const MAX_PER_GROUP = 5;

interface Props {
  isCompact: boolean;
}

export function TopbarSearch({ isCompact }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  const libraries = useNyrimaRootStore((s) => s.libraries);
  const followedUsers = useSocialStore((s) => s.followedUsers);
  const inboxItems = useSocialStore((s) => s.inboxItems);
  const myIndex = useSocialStore((s) => s.myIndex);
  const loadMyIndex = useSocialStore((s) => s.loadMyIndex);
  const profile = useSharingStore((s) => s.profile);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Pull the user's own index in lazily so My Shares hits in the dropdown
  // even if the user hasn't opened the Social hub yet this session.
  useEffect(() => {
    if (!profile) return;
    if (myIndex || !open) return;
    void loadMyIndex();
  }, [profile, myIndex, open, loadMyIndex]);

  // Global "/" hotkey — focus the input from anywhere unless the user is
  // already typing somewhere. Honours contentEditable too.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (inField) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside pointer down + on route change (since we navigate to
  // the result, dropping the popover lets the destination breathe).
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  useEffect(() => {
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // ---- result aggregation ------------------------------------------------

  const results = useMemo<ResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const items: ResultItem[] = [];

    // Libraries — folder-name substring match. Cheap; libraries[] is the
    // immediate children of the Nyrima root, typically tens, not thousands.
    const libHits = libraries
      .filter((l) => l.name.toLowerCase().includes(q))
      .slice(0, MAX_PER_GROUP);
    for (const lib of libHits) {
      items.push({
        key: `lib:${lib.id}`,
        kind: "library",
        title: lib.name,
        subtitle: "Library",
        onActivate: () => navigate(`/library/${lib.id}`),
      });
    }

    // People — match either @handle or display name (case-insensitive).
    const peopleHits = followedUsers
      .filter((u) => {
        const handle = u.profile.handle.toLowerCase();
        const name = (u.profile.name ?? "").toLowerCase();
        return handle.includes(q) || name.includes(q);
      })
      .slice(0, MAX_PER_GROUP);
    for (const u of peopleHits) {
      items.push({
        key: `person:${u.sharedFolderId}`,
        kind: "person",
        title: u.profile.name ?? u.profile.handle,
        subtitle: `@${u.profile.handle}`,
        imageUrl: u.profile.avatarUrl,
        onActivate: () => navigate(`/social/people`),
      });
    }

    // Shares — combine "mine" + "inbox" then dedupe by share id. Search by
    // title; future P4.3 can index captions too once they're cheap to read.
    const seen = new Set<string>();
    type ShareHit = {
      id: string;
      title: string;
      subtitle: string;
      posterUrl?: string;
      url: string;
    };
    const shareHits: ShareHit[] = [];
    if (myIndex) {
      for (const e of myIndex.entries) {
        if (seen.has(e.id)) continue;
        const t = (e.title ?? "").toLowerCase();
        if (!t.includes(q)) continue;
        shareHits.push({
          id: e.id,
          title: e.title ?? "Untitled share",
          subtitle: "Your share",
          posterUrl: e.posterUrl,
          url: targetDriveUrl(e.target),
        });
        seen.add(e.id);
        if (shareHits.length >= MAX_PER_GROUP) break;
      }
    }
    if (shareHits.length < MAX_PER_GROUP) {
      for (const i of inboxItems) {
        if (seen.has(i.entry.id)) continue;
        const t = (i.entry.title ?? "").toLowerCase();
        if (!t.includes(q)) continue;
        shareHits.push({
          id: i.entry.id,
          title: i.entry.title ?? "Untitled share",
          subtitle: `@${i.author.handle}`,
          posterUrl: i.entry.posterUrl,
          url: targetDriveUrl(i.entry.target),
        });
        seen.add(i.entry.id);
        if (shareHits.length >= MAX_PER_GROUP) break;
      }
    }
    for (const s of shareHits) {
      items.push({
        key: `share:${s.id}`,
        kind: "share",
        title: s.title,
        subtitle: s.subtitle,
        imageUrl: s.posterUrl,
        onActivate: () => {
          window.open(s.url, "_blank", "noopener,noreferrer");
        },
      });
    }

    return items;
  }, [query, libraries, followedUsers, inboxItems, myIndex, navigate]);

  // Clamp the highlight when results shrink.
  useEffect(() => {
    if (hover >= results.length) setHover(0);
  }, [results.length, hover]);

  const activate = useCallback(
    (idx: number) => {
      const item = results[idx];
      if (!item) return;
      item.onActivate();
      setOpen(false);
      setQuery("");
    },
    [results],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!open) setOpen(true);
        setHover((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHover((h) => Math.max(0, h - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (results.length === 0) return;
        activate(hover);
        return;
      }
    },
    [activate, hover, open, results.length],
  );

  // Group results for the popover — we keep render order matching the
  // aggregation order so arrow nav doesn't jump around as groups appear.
  const grouped = useMemo(() => {
    const groups: Array<{
      kind: ResultItem["kind"];
      label: string;
      items: Array<{ item: ResultItem; idx: number }>;
    }> = [
      { kind: "library", label: "Libraries", items: [] },
      { kind: "person", label: "People", items: [] },
      { kind: "share", label: "Shares", items: [] },
    ];
    results.forEach((item, idx) => {
      const bucket = groups.find((g) => g.kind === item.kind);
      bucket?.items.push({ item, idx });
    });
    return groups.filter((g) => g.items.length > 0);
  }, [results]);

  return (
    <div className="dc-topbar-search" ref={wrapRef} data-compact={isCompact ? "1" : "0"}>
      <label className="dc-topbar-search__field" aria-label="Search Nyrima">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          spellCheck={false}
          className="dc-topbar-search__input"
          placeholder={isCompact ? "Search" : "Search libraries, people, shares…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHover(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-controls="dc-topbar-search-popover"
          aria-expanded={open}
        />
        <kbd className="dc-topbar-search__kbd" aria-hidden="true">
          /
        </kbd>
      </label>

      {open && (
        <div
          id="dc-topbar-search-popover"
          role="listbox"
          className="dc-topbar-search__popover"
        >
          {query.trim() === "" ? (
            <PopoverHint />
          ) : results.length === 0 ? (
            <PopoverEmpty query={query} />
          ) : (
            grouped.map((group) => (
              <section key={group.kind} className="dc-topbar-search__group">
                <header className="dc-topbar-search__group-head">
                  {group.label}
                  <span className="dc-topbar-search__group-count">
                    {group.items.length}
                  </span>
                </header>
                <ul className="dc-topbar-search__group-list">
                  {group.items.map(({ item, idx }) => (
                    <li
                      key={item.key}
                      role="option"
                      aria-selected={idx === hover}
                      className={cn("dc-topbar-search__row", {
                        "is-hover": idx === hover,
                      })}
                      onPointerEnter={() => setHover(idx)}
                      onClick={() => activate(idx)}
                    >
                      <ResultThumb item={item} />
                      <div className="dc-topbar-search__row-text">
                        <span className="dc-topbar-search__row-title">
                          {item.title}
                        </span>
                        {item.subtitle && (
                          <span className="dc-topbar-search__row-sub">
                            {item.subtitle}
                          </span>
                        )}
                      </div>
                      <KindChip kind={item.kind} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ResultThumb({ item }: { item: ResultItem }) {
  if (item.imageUrl) {
    return (
      <img
        className={`dc-topbar-search__thumb dc-topbar-search__thumb--${item.kind}`}
        src={item.imageUrl}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    );
  }
  return (
    <span
      className={`dc-topbar-search__thumb dc-topbar-search__thumb--${item.kind} is-fallback`}
      aria-hidden="true"
    >
      {item.kind === "library" ? (
        <FolderGlyph />
      ) : item.kind === "person" ? (
        item.title[0]?.toUpperCase()
      ) : (
        <ShareGlyph />
      )}
    </span>
  );
}

function KindChip({ kind }: { kind: ResultItem["kind"] }) {
  const label =
    kind === "library" ? "LIB" : kind === "person" ? "USR" : "SHR";
  return <span className={`dc-topbar-search__chip is-${kind}`}>{label}</span>;
}

function PopoverHint() {
  return (
    <div className="dc-topbar-search__hint">
      <span className="dc-topbar-search__hint-kana">ナイリマ · NYRIMA</span>
      <p className="dc-topbar-search__hint-title">
        Search your libraries, the people you follow, and shares.
      </p>
      <p className="dc-topbar-search__hint-sub">
        <kbd>/</kbd> to focus · <kbd>↑↓</kbd> to walk · <kbd>↵</kbd> to open ·{" "}
        <kbd>Esc</kbd> to close
      </p>
    </div>
  );
}

function PopoverEmpty({ query }: { query: string }) {
  return (
    <div className="dc-topbar-search__hint">
      <span className="dc-topbar-search__hint-kana">NO MATCH</span>
      <p className="dc-topbar-search__hint-title">
        Nothing matches “{query.trim()}”.
      </p>
      <p className="dc-topbar-search__hint-sub">
        Try a partial folder name or a friend's <code>@handle</code>.
      </p>
    </div>
  );
}

function SearchIcon() {
  // Sakura-blossom-cradled magnifier: the lens carries a 5-petal blossom
  // motif in its centre (brand→accent gradient, soft, just enough to read
  // as Nyrima rather than a generic glyph). The handle + ring use the same
  // gradient so the whole icon reads as one painted unit instead of
  // stroke-on-stroke. Each rendered instance gets a fresh gradient id so
  // multiple icons on the same page don't fight over a single <defs>.
  const gid = useGradientId("topbar-search");
  return (
    <svg
      className="dc-topbar-search__icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand-on-background-strong)" />
          <stop offset="100%" stopColor="var(--accent-on-background-strong)" />
        </linearGradient>
        <radialGradient id={`${gid}-bloom`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffd6e3" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#ffa8c4" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ff7aa6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle
        cx="8.5"
        cy="8.5"
        r="6"
        stroke={`url(#${gid})`}
        strokeWidth="1.4"
      />
      <path
        d="m13.4 13.4 4.1 4.1"
        stroke={`url(#${gid})`}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* 5-petal sakura inside the lens. Five ellipses rotated around the
       *  lens centre with a tiny pistil so the eye reads it as a blossom
       *  even at 18px. */}
      <g transform="translate(8.5 8.5)">
        <circle r="3.3" fill={`url(#${gid}-bloom)`} opacity="0.6" />
        <g fill="#ffb6c8" opacity="0.88">
          <ellipse cx="0" cy="-2.1" rx="0.75" ry="1.3" />
          <ellipse cx="0" cy="-2.1" rx="0.75" ry="1.3" transform="rotate(72)" />
          <ellipse cx="0" cy="-2.1" rx="0.75" ry="1.3" transform="rotate(144)" />
          <ellipse cx="0" cy="-2.1" rx="0.75" ry="1.3" transform="rotate(216)" />
          <ellipse cx="0" cy="-2.1" rx="0.75" ry="1.3" transform="rotate(288)" />
        </g>
        <circle r="0.55" fill="#ffd56a" />
      </g>
    </svg>
  );
}

// Stable per-render gradient id so the SVG `<defs>` isn't shared across
// instances (multiple TopbarSearch on one page would otherwise alias).
function useGradientId(prefix: string): string {
  const id = useRef<string>("");
  if (!id.current) {
    id.current = `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return id.current;
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" width="14" height="14" aria-hidden="true">
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.4a1.5 1.5 0 0 1 1.06.44L8.2 4.3a1 1 0 0 0 .7.3H12.5A1.5 1.5 0 0 1 14 6.1V11.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" width="14" height="14" aria-hidden="true">
      <circle cx="12" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="m5.7 7.05 4.6-2.5M5.7 8.95l4.6 2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
