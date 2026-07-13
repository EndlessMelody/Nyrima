/**
 * SettingsSearch — Discord-style search box atop the Account Center sidebar.
 * While the query is non-empty the grouped nav is replaced by a flat ranked
 * result list (rendered here); selecting a result jumps to the owning section
 * and pulses the matching row.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { searchSettings, type SearchResult } from "./registry";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (result: SearchResult) => void;
}

export function SettingsSearch({ query, onQueryChange, onSelect }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const results = useMemo(() => searchSettings(query), [query]);
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset the cursor whenever the result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const hasQuery = query.trim().length > 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!hasQuery || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const result = results[activeIndex];
      if (result) onSelect(result);
    }
  }

  return (
    <div className="ny-ac__search">
      <label className="ny-ac__search-box">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search settings"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search settings"
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {hasQuery && (
          <button
            type="button"
            className="ny-ac__search-clear"
            aria-label="Clear search"
            onClick={() => {
              onQueryChange("");
              inputRef.current?.focus();
            }}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </label>

      {hasQuery && (
        <div className="ny-ac__search-results" role="listbox" aria-label="Search results">
          {results.length === 0 && (
            <div className="ny-ac__search-empty">No settings match “{query.trim()}”.</div>
          )}
          {results.map((result, index) => (
            <button
              type="button"
              key={result.settingId}
              role="option"
              aria-selected={index === activeIndex}
              className={
                index === activeIndex
                  ? "ny-ac__search-result is-active"
                  : "ny-ac__search-result"
              }
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onSelect(result)}
            >
              <span className="ny-ac__search-result-label">{result.label}</span>
              <span className="ny-ac__search-result-crumb">
                {result.sectionLabel}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
