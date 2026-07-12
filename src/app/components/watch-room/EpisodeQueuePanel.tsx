/**
 * EpisodeQueuePanel — the right-rail "Up Next" list for the watch room.
 *
 * Real data only: episodes are the actual sibling video files in the current
 * Drive folder, parsed + natural-sorted via the shared library-view helpers
 * (so EP2 < EP10, S01E02 < S01E10). Clicking an episode navigates within the
 * same folder — it never bounces back to the lobby. Auto Next mirrors the
 * settings store, so it stays in sync with the in-video autoplay behavior.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import { ListVideo, PlayCircle, Search } from "lucide-react";
import type { DriveFile, PlaybackPosition } from "@shared/types";
import {
  buildLibraryVideoItems,
  filterLibraryItems,
  groupLibraryItems,
  type LibraryVideoItem,
} from "../../services/library-view";
import { formatRuntimeFromMillis } from "../../services/formatters";
import { NyrimaMark } from "../NyrimaMark";

interface Props {
  videos: DriveFile[];
  currentFileId: string;
  folderId: string;
  folderName?: string;
  showFolderName?: string;
  positions?: Record<string, PlaybackPosition>;
  query: string;
  autoNext: boolean;
  onToggleAutoNext: () => void;
}

export function EpisodeQueuePanel({
  videos,
  currentFileId,
  folderId,
  folderName = "",
  showFolderName,
  positions,
  query,
  autoNext,
  onToggleAutoNext,
}: Props) {
  const navigate = useNavigate();

  const items = useMemo(
    () =>
      buildLibraryVideoItems(videos, {
        parentFolder: folderName,
        showFolder: showFolderName,
        positions,
      }),
    [videos, folderName, showFolderName, positions],
  );

  const filtered = useMemo(
    () => filterLibraryItems(items, query, "all"),
    [items, query],
  );

  const groups = useMemo(
    () => groupLibraryItems(filtered, "name"),
    [filtered],
  );

  // Float the group containing the current episode to the top.
  const orderedGroups = useMemo(() => {
    const idx = groups.findIndex((g) =>
      g.items.some((i) => i.file.id === currentFileId),
    );
    if (idx <= 0) return groups;
    return [groups[idx], ...groups.filter((_, i) => i !== idx)];
  }, [groups, currentFileId]);

  const total = items.length;
  const watchedCount = items.filter((i) => i.watched).length;
  const percentWatched =
    total > 0 ? Math.round((watchedCount / total) * 100) : 0;

  const play = (item: LibraryVideoItem) => {
    navigate(
      `/play/${encodeURIComponent(folderId)}/${encodeURIComponent(item.file.id)}`,
    );
  };

  const isSearching = query.trim().length > 0;

  return (
    <aside className="watch-queue" aria-label="Episode list">
      <header className="watch-panel__header">
        <span className="watch-panel__icon" aria-hidden="true">
          <ListVideo />
        </span>
        <div>
          <span>Up Next</span>
          <h2>Episode List</h2>
        </div>
        <button
          type="button"
          className={cn("watch-panel__toggle ny-focusable", {
            "is-active": autoNext,
          })}
          onClick={onToggleAutoNext}
          aria-pressed={autoNext}
          title="Automatically play the next episode when one ends"
        >
          Auto Next · {autoNext ? "On" : "Off"}
        </button>
      </header>

      <div className="watch-queue__summary">
        <span>
          {total > 0 ? `${watchedCount}/${total} watched` : "No episodes"}
        </span>
        {total > 0 && <span>{percentWatched}%</span>}
      </div>
      {total > 0 && (
        <div className="watch-queue__summary-bar" aria-hidden="true">
          <div style={{ width: `${percentWatched}%` }} />
        </div>
      )}

      <div className="watch-queue__list">
        {total === 0 ? (
          <div className="watch-queue__empty">
            No other episodes found in this folder.
          </div>
        ) : orderedGroups.length === 0 ? (
          <div className="watch-queue__empty">
            <Search aria-hidden="true" />
            No episodes match “{query.trim()}”.
          </div>
        ) : (
          orderedGroups.map((group) => (
            <section key={group.id} className="watch-queue__group">
              <div className="watch-queue__group-head">
                <strong>{group.title}</strong>
                <em>
                  {group.count} {group.kind === "season" ? "eps" : "titles"}
                </em>
              </div>
              {group.items.map((item) => {
                const isCurrent = item.file.id === currentFileId;
                const duration = formatRuntimeFromMillis(item.durationMs);
                const thumb = item.file.thumbnailLink;
                return (
                  <button
                    type="button"
                    key={item.file.id}
                    className={cn("watch-queue__item ny-focusable", {
                      "is-current": isCurrent,
                    })}
                    onClick={() => play(item)}
                    aria-current={isCurrent}
                    title={item.file.name}
                  >
                    <span className="watch-queue__thumb" aria-hidden="true">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : isCurrent ? (
                        <PlayCircle />
                      ) : (
                        <NyrimaMark size="header" />
                      )}
                    </span>
                    <span className="watch-queue__body">
                      <span className="watch-queue__label">
                        {item.parsed.shortLabel}
                      </span>
                      <span className="watch-queue__file">{item.file.name}</span>
                      <span className="watch-queue__meta">
                        {duration && <span>{duration}</span>}
                        {item.watched ? (
                          <span className="is-watched">Watched</span>
                        ) : item.inProgress ? (
                          <span className="is-progress">
                            {item.progressPct}%
                          </span>
                        ) : null}
                      </span>
                      {item.progressPct > 0 && !item.watched && (
                        <span className="watch-queue__bar" aria-hidden="true">
                          <span style={{ width: `${item.progressPct}%` }} />
                        </span>
                      )}
                    </span>
                    {isCurrent && (
                      <span className="watch-queue__now">Now Playing</span>
                    )}
                  </button>
                );
              })}
            </section>
          ))
        )}
        {isSearching && orderedGroups.length > 0 && (
          <p className="watch-queue__searchnote">
            Filtering this folder’s episodes
          </p>
        )}
      </div>
    </aside>
  );
}
