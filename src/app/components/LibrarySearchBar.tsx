import cn from "classnames";
import type { LibrarySortKey, LibraryViewMode } from "@shared/types";
import type { LibraryFilter } from "../services/library-view";
import "./LibrarySearchBar.scss";

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  filter: LibraryFilter;
  onFilterChange: (filter: LibraryFilter) => void;
  sortKey: LibrarySortKey;
  onSortChange: (sortKey: LibrarySortKey) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (viewMode: LibraryViewMode) => void;
  totalCount: number;
  resultCount: number;
}

const FILTERS: Array<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "continue", label: "Continue" },
  { id: "unwatched", label: "Unwatched" },
  { id: "watched", label: "Watched" },
];

const VIEWS: Array<{ id: LibraryViewMode; label: string }> = [
  { id: "grouped", label: "Group" },
  { id: "grid", label: "Grid" },
  { id: "list", label: "List" },
];

export function LibrarySearchBar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  sortKey,
  onSortChange,
  viewMode,
  onViewModeChange,
  totalCount,
  resultCount,
}: Props) {
  return (
    <div className="ny-library-toolbar">
      <label className="ny-library-toolbar__search" aria-label="Search videos">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search episodes, files, specials…"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className="ny-library-toolbar__clear"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            title="Clear"
          >
            <CrossIcon />
          </button>
        )}
      </label>

      <div className="ny-library-toolbar__chips" aria-label="Watch filter">
        {FILTERS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={cn("ny-library-toolbar__chip", {
              "is-active": filter === item.id,
            })}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="ny-library-toolbar__select">
        <span>Sort</span>
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as LibrarySortKey)}
        >
          <option value="name">Name</option>
          <option value="modified">Modified</option>
          <option value="size">Size</option>
          <option value="duration">Duration</option>
        </select>
      </label>

      <div className="ny-library-toolbar__view" aria-label="View mode">
        {VIEWS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={cn("ny-library-toolbar__view-btn", {
              "is-active": viewMode === item.id,
            })}
            onClick={() => onViewModeChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <span className="ny-library-toolbar__count">
        {resultCount}/{totalCount}
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
