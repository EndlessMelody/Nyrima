/**
 * LibraryCategoryCard — one overview card (Anime / Manga / Light Novel / Music).
 *
 * Values are real: `count` and `meta` come from indexed content. Categories
 * without a connected source render `available: false` — dimmed, with a "Not
 * connected" line and a connect affordance instead of a chevron. Selecting an
 * available category filters the All Items grid to that type.
 */

import cn from "classnames";
import { ChevronRight, Plus } from "lucide-react";
import { CategoryIcon } from "./category-visuals";
import type { LibraryCategorySummary } from "./types";

export function LibraryCategoryCard({
  summary,
  active,
  onSelect,
}: {
  summary: LibraryCategorySummary;
  active?: boolean;
  onSelect?: () => void;
}) {
  const { key, name, count, meta, available } = summary;
  return (
    <button
      type="button"
      className={cn("lib-cat-card", "ny-focusable", {
        "is-active": active,
        "is-unavailable": !available,
      })}
      data-cat={key}
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`${name} — ${available ? `${count} items` : "not connected"}`}
    >
      <span className="lib-cat-card__glow" aria-hidden="true" />
      <span className="lib-cat-card__icon" aria-hidden="true">
        <CategoryIcon type={key} />
      </span>
      <span className="lib-cat-card__body">
        <span className="lib-cat-card__name">{name}</span>
        <span className="lib-cat-card__count">{count.toLocaleString()}</span>
        {meta && <span className="lib-cat-card__meta">{meta}</span>}
      </span>
      <span className="lib-cat-card__chevron" aria-hidden="true">
        {available ? <ChevronRight /> : <Plus />}
      </span>
    </button>
  );
}
