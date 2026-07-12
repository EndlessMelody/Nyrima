/**
 * LibraryGrid + LibraryItemCard — the responsive "All Items" collection.
 *
 * Cards are real Drive libraries (Anime series): cover, type badge, title,
 * real episode/runtime metadata, watched progress, source chip, and last-update
 * time. Every field degrades gracefully — anything unknown is simply omitted
 * rather than faked. `auto-fit/minmax` keeps the grid dense on wide screens and
 * graceful as it narrows; list mode swaps to single-column rows.
 */

import cn from "classnames";
import { Check, Cloud, HardDrive, MoreHorizontal } from "lucide-react";
import { CategoryIcon, categoryBadge } from "./category-visuals";
import { formatRelativeTime } from "./format";
import { libraryRuntimeLabel } from "./library-data";
import type { LibraryItem, LibraryViewMode } from "./types";

export function LibraryGrid({
  items,
  view,
  onOpen,
}: {
  items: LibraryItem[];
  view: LibraryViewMode;
  onOpen: (item: LibraryItem) => void;
}) {
  return (
    <div className={cn("lib-grid", { "lib-grid--list": view === "list" })}>
      {items.map((item) => (
        <LibraryItemCard key={item.id} item={item} view={view} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function LibraryItemCard({
  item,
  view,
  onOpen,
}: {
  item: LibraryItem;
  view: LibraryViewMode;
  onOpen: (item: LibraryItem) => void;
}) {
  const episodes = item.episodes ?? 0;
  const watched = item.watchedCount ?? 0;
  const completed = episodes > 0 && watched >= episodes;
  const runtime = libraryRuntimeLabel(item.runtimeMs);

  // Real metadata line — only the parts we actually know.
  const metaParts: string[] = [];
  if (item.fileFormat) metaParts.push(item.fileFormat);
  if (episodes > 0) metaParts.push(countLabel(item.type, episodes));
  if (runtime) metaParts.push(runtime);
  const meta = metaParts.join(" · ");

  const status = completed
    ? "Completed"
    : episodes > 0 && watched > 0
      ? `${watched}/${episodes} watched`
      : item.inProgress
        ? "In progress"
        : "";
  const progressPct =
    episodes > 0 ? Math.min(100, Math.round((watched / episodes) * 100)) : 0;

  return (
    <article
      className={cn("lib-item-card", "ny-focusable", {
        "lib-item-card--row": view === "list",
      })}
      data-cat={item.type}
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item);
        }
      }}
      aria-label={item.title}
    >
      <div className="lib-item-card__cover">
        {item.cover ? (
          <img src={item.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="lib-cover-fallback" aria-hidden="true">
            <CategoryIcon type={item.type} />
          </span>
        )}
        <span className="lib-badge lib-badge--type">{categoryBadge(item.type)}</span>
        {completed && (
          <span className="lib-badge lib-badge--done" aria-hidden="true">
            <Check />
          </span>
        )}
      </div>

      <div className="lib-item-card__body">
        <h3 className="lib-item-card__title" title={item.title}>
          {item.title}
        </h3>
        {meta && <p className="lib-item-card__meta">{meta}</p>}

        {!completed && progressPct > 0 && (
          <div className="lib-progress lib-progress--slim" aria-hidden="true">
            <span
              className="lib-progress__fill"
              style={{ width: `${Math.max(3, progressPct)}%` }}
            />
          </div>
        )}

        <div className="lib-item-card__foot">
          <span className={cn("lib-source", `lib-source--${item.source}`)}>
            {item.source === "drive" ? <Cloud /> : <HardDrive />}
            {item.source === "drive" ? "Drive" : "Local"}
          </span>
          {status && (
            <span className={cn("lib-item-card__state", { "is-done": completed })}>
              {status}
            </span>
          )}
          {item.updatedAt && (
            <span className="lib-item-card__updated">
              {formatRelativeTime(item.updatedAt)}
            </span>
          )}
        </div>
      </div>

      <span className="lib-item-card__more" aria-hidden="true">
        <MoreHorizontal />
      </span>
    </article>
  );
}

function countLabel(type: LibraryItem["type"], count: number): string {
  if (type === "movies" || type === "anime") {
    return `${count} ${count === 1 ? "file" : "files"}`;
  }
  if (type === "manga") return `${count} ${count === 1 ? "page" : "pages"}`;
  return `${count} ${count === 1 ? "item" : "items"}`;
}
