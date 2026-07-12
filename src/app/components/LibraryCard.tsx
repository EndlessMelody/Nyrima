/**
 * LibraryCard — media-library card for the lobby.
 *
 * Displays a Drive folder as a cinema-style library tile rather than a
 * filename-first file-manager row. Pulls the latest in-progress position
 * for the folder (when present) and renders a "Continue Ep…" badge so the
 * user can jump straight back into the episode they last watched.
 *
 * Drive IDs are intentionally hidden from the visible chrome; the short id
 * still lives in `title` attributes for power-user debugging.
 */

import { memo, useMemo, type KeyboardEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import type { PlaybackPosition, RecentFolder } from "@shared/types";
import { useRecentStore } from "../stores/recent-store";
import { parseTitle } from "@shared/title-parser";
import { NyrimaMark } from "./NyrimaMark";
import "./LibraryCard.scss";

interface Props {
  folder: RecentFolder;
  /** All known positions; the card pulls the most-recent one in this folder. */
  positions: Record<string, PlaybackPosition>;
  /** Optional explicit route for file-level aggregate cards. */
  openPath?: string;
}

export const LibraryCard = memo(function LibraryCard({ folder, positions, openPath }: Props) {
  const navigate = useNavigate();
  const { togglePin } = useRecentStore();

  // Find the most-recent in-progress position whose folderId matches this
  // folder. Lets us label the card with "Continue Ep09" or similar.
  const continueItem = useMemo(() => {
    let best: PlaybackPosition | null = null;
    for (const p of Object.values(positions)) {
      if (p.folderId !== folder.id) continue;
      if (!p.name) continue;
      if (p.positionSeconds <= 5) continue;
      if (!best || (p.updatedAt ?? 0) > (best.updatedAt ?? 0)) {
        best = p;
      }
    }
    return best;
  }, [positions, folder.id]);

  const continueLabel = useMemo(() => {
    if (!continueItem?.name) return null;
    const parsed = parseTitle({
      filename: continueItem.name,
      parentFolder: folder.name,
    });
    if (parsed.episodeNumber) return `Continue · Ep${parsed.episodeNumber}`;
    if (parsed.specialTag) return `Continue · ${parsed.specialTag}`;
    return "Continue";
  }, [continueItem, folder.name]);

  const initials = useMemo(() => folderInitials(folder.name), [folder.name]);

  // Library stats — written by LibraryPage when the user opens a folder.
  // First visit shows the basic "N items" fallback; subsequent visits show
  // the richer "12 ep · 4h 36m" pair.
  const countLabel = useMemo(() => {
    if (folder.videoCount != null) {
      const n = folder.videoCount;
      return n === 1 ? "1 ep" : `${n} eps`;
    }
    if (folder.itemCount != null) return `${folder.itemCount} items`;
    return "—";
  }, [folder.videoCount, folder.itemCount]);

  const runtimeLabel = useMemo(
    () => (folder.runtimeMs ? formatRuntimeShortMs(folder.runtimeMs) : null),
    [folder.runtimeMs],
  );

  const watchedRatio = useMemo(() => {
    const total = folder.videoCount ?? 0;
    const watched = folder.watchedCount ?? 0;
    if (total === 0 || watched === 0) return null;
    return {
      watched,
      total,
      label: `${watched}/${total}`,
      complete: watched >= total,
    };
  }, [folder.videoCount, folder.watchedCount]);

  // "N new" pill — appears when the background enrichment on the lobby has
  // observed files modified after the user last opened this library. Cleared
  // by LibraryPage on visit (lastSeenAt → now, pendingNewCount → 0).
  const newCount = folder.pendingNewCount ?? 0;

  const onOpen = () => navigate(openPath ?? `/library/${encodeURIComponent(folder.id)}`);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };

  const onTogglePin = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    togglePin(folder.id);
  };

  return (
    <div
      className={cn("ny-library-card", {
        "is-pinned": folder.pinned,
        "is-continue": !!continueLabel,
      })}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      aria-label={`Open ${folder.name}`}
      title={`Drive ID · ${folder.id.slice(0, 8).toUpperCase()}`}
    >
      <div
        className={cn("ny-library-card__poster", {
          "has-cover": !!folder.coverPosterUrl,
        })}
      >
        {folder.coverPosterUrl ? (
          <img
            className="ny-library-card__cover"
            src={folder.coverPosterUrl}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="ny-library-card__poster-art" aria-hidden>
            <span className="ny-library-card__initials">{initials}</span>
            <NyrimaMark size="header" className="ny-library-card__mark" />
          </div>
        )}

        <div className="ny-library-card__poster-tools">
          <button
            type="button"
            className={cn("ny-library-card__pin-action", {
              "is-active": folder.pinned,
            })}
            onClick={onTogglePin}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={folder.pinned ? "Unpin folder" : "Pin folder"}
            aria-pressed={!!folder.pinned}
            title={folder.pinned ? "Unpin" : "Pin"}
          >
            <PinIcon />
          </button>

          {watchedRatio && (
            <span
              className={cn("ny-library-card__progress-pill", {
                "is-complete": watchedRatio.complete,
              })}
              title={`${watchedRatio.watched} of ${watchedRatio.total} watched`}
            >
              {watchedRatio.label}
            </span>
          )}
        </div>

        {continueLabel && (
          <span className="ny-library-card__continue-pill">
            <PlayDotIcon /> {continueLabel}
          </span>
        )}

        {newCount > 0 && (
          <span
            className="ny-library-card__new-pill"
            title={`${newCount} new ${newCount === 1 ? "file" : "files"} since you last opened this library`}
          >
            {newCount} new
          </span>
        )}

        <div className="ny-library-card__hover" aria-hidden>
          <span className="ny-library-card__open-cta">
            <PlayIcon /> Open
          </span>
        </div>
      </div>

      <div className="ny-library-card__body">
        <span className="ny-library-card__title" title={folder.name}>
          {folder.name}
        </span>
        <span className="ny-library-card__meta">
          <span>{countLabel}</span>
          {runtimeLabel && (
            <>
              <span className="ny-library-card__dot" aria-hidden />
              <span>{runtimeLabel}</span>
            </>
          )}
          <span className="ny-library-card__dot" aria-hidden />
          <span>{formatRelative(folder.lastOpenedAt)}</span>
        </span>
      </div>

    </div>
  );
});

function folderInitials(name: string): string {
  const words = name
    .replace(/[[\]()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "Nm";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function formatRuntimeShortMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatRelative(epoch: number): string {
  const diff = Date.now() - epoch;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(epoch).toLocaleDateString();
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <path d="M4 2l10 6-10 6V2z" fill="currentColor" />
    </svg>
  );
}

function PlayDotIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden width="10" height="10">
      <circle cx="6" cy="6" r="5" fill="currentColor" opacity="0.18" />
      <path d="M5 4l3 2-3 2V4z" fill="currentColor" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5v6m-3 0h6l-1.2 2H6.2L5 7.5Zm0 0L8 13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
