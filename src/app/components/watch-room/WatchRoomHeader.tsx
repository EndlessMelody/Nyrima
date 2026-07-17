/**
 * WatchRoomHeader — sticky top bar for the anime/movie player, styled to match
 * the Music Player header (glass panel, neon accents, mono micro-labels).
 *
 * Search filters the real episode queue (handled by the parent). The "more"
 * menu carries the real file actions that used to live under the video.
 */

import { useEffect, useRef, useState } from "react";
import cn from "classnames";
import {
  ArrowLeft,
  Captions,
  ListVideo,
  MoreHorizontal,
  Maximize2,
  Minimize2,
  Search,
  SlidersHorizontal,
  ExternalLink,
  Link2,
  CheckCircle2,
} from "lucide-react";
import { NyrimaMark } from "../NyrimaMark";

interface Props {
  isSeries: boolean;
  sourceLabel: string;
  query: string;
  onQueryChange: (query: string) => void;
  onBack: () => void;
  onToggleQueue: () => void;
  queueOpen: boolean;
  onScrollToSubs: () => void;
  onScrollToTuning: () => void;
  onToggleFocus: () => void;
  focusActive: boolean;
  onOpenInDrive: () => void;
  onCopyLink: () => void;
  onMarkWatched: () => void;
}

export function WatchRoomHeader({
  isSeries,
  sourceLabel,
  query,
  onQueryChange,
  onBack,
  onToggleQueue,
  queueOpen,
  onScrollToSubs,
  onScrollToTuning,
  onToggleFocus,
  focusActive,
  onOpenInDrive,
  onCopyLink,
  onMarkWatched,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuHostRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header className="watch-room-header">
      <div className="watch-room-header__left">
        <button
          type="button"
          className="watch-back-button ny-focusable"
          onClick={onBack}
          aria-label="Back to previous section"
          title="Back"
        >
          <ArrowLeft aria-hidden="true" />
          <span>Back</span>
        </button>
        <div className="watch-room-header__brand">
          <NyrimaMark size="header" />
          <span className="ny-wordmark">Nyrima</span>
        </div>
        <div className="watch-room-header__title">
          <span>{isSeries ? "Anime Player" : "Movies Player"}</span>
          <small>{sourceLabel}</small>
        </div>
      </div>

      <div className="watch-room-header__right">
        <label className="watch-room-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search anime, episodes, files..."
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <IconButton
          icon={Captions}
          label="Subtitle & audio settings"
          onClick={onScrollToSubs}
        />
        <IconButton
          icon={ListVideo}
          label={queueOpen ? "Hide episode list" : "Show episode list"}
          active={queueOpen}
          onClick={onToggleQueue}
        />
        <IconButton
          icon={SlidersHorizontal}
          label="Watch tuning"
          onClick={onScrollToTuning}
        />
        <IconButton
          icon={focusActive ? Minimize2 : Maximize2}
          label={focusActive ? "Exit focus mode" : "Focus mode"}
          active={focusActive}
          onClick={onToggleFocus}
        />
        <div className="watch-room-header__menu-host" ref={menuHostRef}>
          <IconButton
            icon={MoreHorizontal}
            label="More actions"
            active={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          />
          {menuOpen && (
            <div className="watch-room-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenInDrive();
                }}
              >
                <ExternalLink aria-hidden="true" />
                Open in Drive
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onCopyLink();
                }}
              >
                <Link2 aria-hidden="true" />
                Copy link
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onMarkWatched();
                }}
              >
                <CheckCircle2 aria-hidden="true" />
                Mark as watched
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: typeof Search;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn("watch-icon-button ny-focusable", { "is-active": active })}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}
