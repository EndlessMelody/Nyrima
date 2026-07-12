/**
 * ContinueRail + ContinueCard — the tight "Continue your story" section.
 *
 * Portrait 9:16 cards in a horizontal scroll-snap rail. ~4 cards are visible at
 * once and up to 10 real resume entries slide in from the right. Every value is
 * real: title, file format, progress, remaining time, source, and last-opened
 * relative time (omitted when unknown). When there's no history the whole
 * section is omitted by the page.
 */

import cn from "classnames";
import { Cloud, HardDrive, Play } from "lucide-react";
import { CategoryIcon, categoryBadge } from "./category-visuals";
import { formatRelativeTime } from "./format";
import type { ContinueEntry } from "./types";

export function ContinueRail({
  entries,
  onOpen,
  title = "Continue your story",
  hint = "Pick up where you left off",
  ariaLabel = "Continue your story",
}: {
  entries: ContinueEntry[];
  onOpen: (entry: ContinueEntry) => void;
  title?: string;
  hint?: string;
  ariaLabel?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="lib-section lib-continue" aria-label={ariaLabel}>
      <div className="lib-section__head">
        <h2 className="lib-section__title">{title}</h2>
        <span className="lib-section__hint">{hint}</span>
      </div>
      <div className="lib-continue__rail" role="list">
        {entries.map((entry) => (
          <ContinueCard key={entry.fileId} entry={entry} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

export function ContinueCard({
  entry,
  onOpen,
}: {
  entry: ContinueEntry;
  onOpen: (entry: ContinueEntry) => void;
}) {
  const relative = formatRelativeTime(entry.updatedAt);
  return (
    <article
      className="lib-continue-card ny-focusable"
      data-cat={entry.type}
      role="listitem"
      tabIndex={0}
      onClick={() => onOpen(entry)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(entry);
        }
      }}
      aria-label={`Resume ${entry.title}`}
    >
      <div className="lib-continue-card__cover">
        {entry.cover ? (
          <img src={entry.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="lib-cover-fallback" aria-hidden="true">
            <CategoryIcon type={entry.type} />
          </span>
        )}
        <span className="lib-badge lib-badge--type">{categoryBadge(entry.type)}</span>
        {entry.fileFormat && (
          <span className="lib-badge lib-badge--fmt">{entry.fileFormat}</span>
        )}
        <span className="lib-continue-card__play" aria-hidden="true">
          <Play />
        </span>

        <div className="lib-continue-card__overlay">
          <h3 className="lib-continue-card__title" title={entry.title}>
            {entry.title}
          </h3>
          <div className="lib-continue-card__meta">
            <span className={cn("lib-source", `lib-source--${entry.source}`)}>
              {entry.source === "drive" ? <Cloud /> : <HardDrive />}
              {entry.source === "drive" ? "Drive" : "Local"}
            </span>
            {entry.remainingLabel && <span>{entry.remainingLabel}</span>}
          </div>
          {entry.progressPct > 0 && (
            <div className="lib-progress lib-progress--slim" aria-hidden="true">
              <span
                className="lib-progress__fill"
                style={{ width: `${Math.max(3, entry.progressPct)}%` }}
              />
            </div>
          )}
        </div>
      </div>
      {relative && <span className="lib-continue-card__time">{relative}</span>}
    </article>
  );
}
