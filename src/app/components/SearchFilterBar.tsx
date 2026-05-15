/**
 * SearchFilterBar — lobby search input + filter chip row.
 *
 * Filters are local state hoisted to the parent. We only ship filters we
 * can compute reliably from already-loaded data (recent folders + stored
 * playback positions) — filters like "Has subtitles" or "MKV" would need
 * a folder scan and live on the roadmap.
 */

import cn from "classnames";
import "./SearchFilterBar.scss";

export type LobbyFilter = "all" | "continue" | "unwatched";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  filter: LobbyFilter;
  onFilterChange: (f: LobbyFilter) => void;
  libraryCount: number;
}

const FILTERS: Array<{ id: LobbyFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "continue", label: "Continue Watching" },
  { id: "unwatched", label: "Unwatched" },
];

export function SearchFilterBar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  libraryCount,
}: Props) {
  return (
    <div className="ny-search-bar">
      <label className="ny-search-bar__input" aria-label="Search libraries">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search libraries, episodes, titles…"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className="ny-search-bar__clear"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            title="Clear"
          >
            <CrossIcon />
          </button>
        )}
      </label>

      <div className="ny-search-bar__chips" role="tablist" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={cn("ny-search-bar__chip", {
              "is-active": filter === f.id,
            })}
            onClick={() => onFilterChange(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <span className="ny-search-bar__count">
        {libraryCount} {libraryCount === 1 ? "library" : "libraries"}
      </span>
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
