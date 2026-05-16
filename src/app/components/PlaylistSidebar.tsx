/**
 * PlaylistSidebar — grouped episode navigator for the player page.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import type { DriveFile, PlaybackPosition } from "@shared/types";
import {
  buildLibraryVideoItems,
  filterLibraryItems,
  groupLibraryItems,
  type LibraryVideoGroup,
  type LibraryVideoItem,
} from "../services/library-view";
import { formatRuntimeFromMillis } from "../services/formatters";
import { NyrimaMark } from "./NyrimaMark";
import "./PlaylistSidebar.scss";

interface Props {
  videos: DriveFile[];
  currentFileId: string;
  folderId: string;
  folderName?: string;
  showFolderName?: string;
  positions?: Record<string, PlaybackPosition>;
}

export function PlaylistSidebar({
  videos,
  currentFileId,
  folderId,
  folderName = "",
  showFolderName,
  positions,
}: Props) {
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );

  const items = useMemo(
    () =>
      buildLibraryVideoItems(videos, {
        parentFolder: folderName,
        showFolder: showFolderName,
        positions,
      }),
    [videos, folderName, showFolderName, positions],
  );
  const filteredItems = useMemo(
    () => filterLibraryItems(items, query, "all"),
    [items, query],
  );
  const groups = useMemo(
    () => groupLibraryItems(filteredItems, "name"),
    [filteredItems],
  );
  const currentItem =
    items.find((item) => item.file.id === currentFileId) ?? null;
  const currentIndex = videos.findIndex((v) => v.id === currentFileId);
  const orderedGroups = useMemo(() => {
    if (!currentItem) return groups;
    const currentGroup = groups.find((group) =>
      group.items.some((item) => item.file.id === currentFileId),
    );
    if (!currentGroup) return groups;
    return [
      currentGroup,
      ...groups.filter((group) => group.id !== currentGroup.id),
    ];
  }, [groups, currentFileId, currentItem]);

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="ny-playlist">
      <div className="ny-playlist__summary">
        <span className="ny-playlist__eyebrow">Now Playing</span>
        <span className="ny-playlist__now" title={currentItem?.file.name}>
          {currentItem?.parsed.fullTitle || "Current video"}
        </span>
        <div className="ny-playlist__stats">
          {currentIndex >= 0 && (
            <span>
              {currentIndex + 1}/{videos.length}
            </span>
          )}
          {currentItem?.progressPct ? (
            <span>
              {currentItem.watched ? "Watched" : `${currentItem.progressPct}%`}
            </span>
          ) : null}
          {currentItem?.durationMs ? (
            <span>{formatRuntimeFromMillis(currentItem.durationMs)}</span>
          ) : null}
        </div>
      </div>

      <label className="ny-playlist__search" aria-label="Search playlist">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search episodes..."
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear playlist search"
          >
            <CrossIcon />
          </button>
        )}
      </label>

      {orderedGroups.length === 0 ? (
        <div className="ny-playlist__empty">No matching episodes.</div>
      ) : (
        orderedGroups.map((group) => (
          <PlaylistGroup
            key={group.id}
            group={group}
            currentFileId={currentFileId}
            folderId={folderId}
            collapsed={collapsedGroups.has(group.id) && !query}
            onToggle={() => toggleGroup(group.id)}
          />
        ))
      )}
    </div>
  );
}

function PlaylistGroup({
  group,
  currentFileId,
  folderId,
  collapsed,
  onToggle,
}: {
  group: LibraryVideoGroup;
  currentFileId: string;
  folderId: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const noun =
    group.kind === "season"
      ? group.count === 1
        ? "ep"
        : "eps"
      : group.count === 1
        ? "title"
        : "titles";

  return (
    <section className="ny-playlist__section">
      <button
        type="button"
        className="ny-playlist__heading"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span>{collapsed ? "+" : "-"}</span>
        <strong>{group.title}</strong>
        <em>
          {group.count} {noun}
        </em>
      </button>

      {!collapsed && (
        <div className="ny-playlist__list">
          {group.items.map((item) => (
            <PlaylistItem
              key={item.file.id}
              item={item}
              folderId={folderId}
              isCurrent={item.file.id === currentFileId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PlaylistItem({
  item,
  folderId,
  isCurrent,
}: {
  item: LibraryVideoItem;
  folderId: string;
  isCurrent: boolean;
}) {
  const navigate = useNavigate();
  const duration = formatRuntimeFromMillis(item.durationMs);
  const thumb = item.file.thumbnailLink;
  const displayLabel = item.parsed.shortLabel;

  const play = () => {
    navigate(
      `/play/${encodeURIComponent(folderId)}/${encodeURIComponent(item.file.id)}`,
    );
  };

  return (
    <div
      className={cn("ny-playlist__item", { "is-current": isCurrent })}
      role="button"
      tabIndex={0}
      onClick={play}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          play();
        }
      }}
      aria-label={isCurrent ? `Now playing ${displayLabel}` : `Play ${displayLabel}`}
    >
      <div className="ny-playlist__thumb">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" decoding="async" />
        ) : (
          <NyrimaMark size="header" />
        )}
      </div>

      <div className="ny-playlist__body">
        <span className="ny-playlist__title" title={item.file.name}>
          {displayLabel}
        </span>
        <span className="ny-playlist__filename" title={item.file.name}>
          {item.file.name}
        </span>
        <span className="ny-playlist__meta">
          {duration && <span>{duration}</span>}
          {item.watched ? (
            <span className="ny-playlist__progress">Watched</span>
          ) : item.inProgress ? (
            <span className="ny-playlist__progress">{item.progressPct}%</span>
          ) : null}
        </span>
        {item.progressPct > 0 && !item.watched && (
          <div className="ny-playlist__progress-bar-container">
            <div
              className="ny-playlist__progress-bar"
              style={{ width: `${item.progressPct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="m10.5 10.5 3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="12" height="12">
      <path
        d="m4 4 8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
