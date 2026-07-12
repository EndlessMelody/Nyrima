/**
 * LibraryFilterBar — quick-filter chips + sort control.
 *
 * Every chip maps to a real attribute of indexed content (recently added /
 * has-resume / pinned / fully watched), so toggling one narrows the grid to
 * genuinely matching items rather than a fabricated set.
 */

import cn from "classnames";
import { ChevronDown } from "lucide-react";
import type { LibraryFilterKey, LibrarySortKey } from "./types";

const CHIPS: Array<{ key: LibraryFilterKey; label: string }> = [
  { key: "recent", label: "Recently Added" },
  { key: "continue", label: "Continue" },
  { key: "favorites", label: "Favorites" },
  { key: "completed", label: "Completed" },
];

const SORT_LABEL: Record<LibrarySortKey, string> = {
  recent: "Recent",
  title: "Title",
  progress: "Progress",
};

export function LibraryFilterBar({
  activeFilter,
  onFilterChange,
  sort,
  onSortChange,
}: {
  activeFilter: LibraryFilterKey | null;
  onFilterChange: (filter: LibraryFilterKey | null) => void;
  sort: LibrarySortKey;
  onSortChange: (sort: LibrarySortKey) => void;
}) {
  return (
    <div className="lib-filterbar">
      <div className="lib-filterbar__chips" role="group" aria-label="Quick filters">
        {CHIPS.map((chip) => {
          const active = activeFilter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              className={cn("lib-chip", "ny-focusable", { "is-active": active })}
              aria-pressed={active}
              onClick={() => onFilterChange(active ? null : chip.key)}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      <label className="lib-control lib-control--sort">
        <span className="lib-control__label">Sort</span>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as LibrarySortKey)}
          aria-label="Sort items"
        >
          {(Object.keys(SORT_LABEL) as LibrarySortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABEL[key]}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" />
      </label>
    </div>
  );
}
