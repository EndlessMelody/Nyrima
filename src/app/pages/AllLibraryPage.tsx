/**
 * AllLibraryPage — Nyrima's unified, data-driven "All Library" hub.
 *
 * Reuses the lobby chrome (left sidebar + sticky command-deck topbar via
 * `LobbyChrome`) and owns the inner content: a 2-line header, real category
 * overview cards, a tight 9:16 Continue rail, a responsive All Items grid, a
 * compact independently-scrolling insight column, and a floating Ny-chan
 * assistant for conversational search.
 *
 * Every value is real — sourced from the user's Drive libraries + playback
 * history via `useLibraryHub()`. When a source isn't connected (Manga, Light
 * Novel, Music today, or Drive before setup) the page shows honest empty /
 * disconnected states instead of fabricating content.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Grid2X2, List } from "lucide-react";
import cn from "classnames";
import { LobbyShell, LobbySidebar, LobbyTopbar } from "../components/LobbyChrome";
import { LibraryGridSkeleton } from "../components/LibraryGridSkeleton";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import {
  CATEGORY_META,
  CategoryIcon,
  ContinueRail,
  LibraryCategoryCard,
  LibraryDisconnectedState,
  LibraryFilterBar,
  LibraryGrid,
  LibraryHeroHeader,
  LibraryInsightPanel,
  LibraryStatePanel,
  NyChanAssistant,
  useLibraryHub,
  type ContinueEntry,
  type LibraryCategoryKey,
  type LibraryFilterKey,
  type LibraryItem,
  type LibrarySortKey,
  type LibraryViewMode,
  type SearchResult,
} from "../components/library-hub";
import "./AllLibraryPage.scss";

const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function AllLibraryPage() {
  const hub = useLibraryHub();
  const {
    status,
    driveConnected,
    categories,
    continueEntries,
    items,
    insights,
    search,
    latestAnime,
    latestContinue,
  } = hub;

  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < 1280,
  );
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<LibraryCategoryKey | null>(
    null,
  );
  const [activeFilter, setActiveFilter] = useState<LibraryFilterKey | null>(null);
  const [sort, setSort] = useState<LibrarySortKey>("recent");
  const [view, setView] = useState<LibraryViewMode>("grid");
  const [setupOpen, setSetupOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // `/` and Ctrl/Cmd+K focus the command-deck search; Esc clears it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const isCmdK = e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey);
      if ((e.key === "/" || isCmdK) && !typing) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "Escape" && t === searchInputRef.current && query) {
        e.preventDefault();
        setQuery("");
        searchInputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query]);

  // --- Navigation ----------------------------------------------------------
  const openLibrary = (folderId: string) =>
    navigate(`/library/${encodeURIComponent(folderId)}`);
  const playFile = (folderId: string, fileId: string) =>
    navigate(`/play/${encodeURIComponent(folderId)}/${encodeURIComponent(fileId)}`);
  const openItem = (item: LibraryItem) => {
    if (item.type === "movies" && item.fileId && item.folderId) {
      playFile(item.folderId, item.fileId);
      return;
    }
    openLibrary(item.folderId ?? item.id);
  };
  const openEntry = (entry: ContinueEntry) => playFile(entry.folderId, entry.fileId);
  const openResult = (r: SearchResult) =>
    r.kind === "file" && r.fileId ? playFile(r.folderId, r.fileId) : openLibrary(r.folderId);

  // --- Filtering / sorting (all real) --------------------------------------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items.filter((item) => {
      if (categoryFilter && item.type !== categoryFilter) return false;
      if (q && !item.title.toLowerCase().includes(q)) return false;
      switch (activeFilter) {
        case "recent":
          return !!item.updatedAt && Date.now() - item.updatedAt <= RECENT_WINDOW_MS;
        case "continue":
          return !!item.inProgress;
        case "favorites":
          return !!item.favorite;
        case "completed":
          return (item.episodes ?? 0) > 0 && (item.watchedCount ?? 0) >= (item.episodes ?? 0);
        default:
          return true;
      }
    });
    const ratio = (i: LibraryItem) =>
      (i.episodes ?? 0) > 0 ? (i.watchedCount ?? 0) / (i.episodes ?? 1) : 0;
    list = [...list].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "progress") return ratio(b) - ratio(a);
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
    return list;
  }, [items, categoryFilter, query, activeFilter, sort]);

  const isFiltered =
    categoryFilter !== null || activeFilter !== null || query.trim() !== "";

  const resetFilters = () => {
    setCategoryFilter(null);
    setActiveFilter(null);
    setQuery("");
  };

  const totalLabel =
    insights.totalItems > 0
      ? `${insights.totalItems.toLocaleString()} items`
      : driveConnected
        ? "No items yet"
        : "Not connected";

  const countLabel = `${filtered.length.toLocaleString()} ${
    filtered.length === 1 ? "item" : "items"
  }${categoryFilter ? ` · ${CATEGORY_META[categoryFilter].name}` : ""}`;

  // Empty-grid copy depends on *why* it's empty.
  const unavailableCategory =
    categoryFilter && !categories.find((c) => c.key === categoryFilter)?.available
      ? categoryFilter
      : null;

  return (
      <LobbyShell
      collapsed={collapsed}
      sidebar={
        <LobbySidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
          onOpenDrive={() => setSetupOpen(true)}
        />
      }
      topbar={
        <LobbyTopbar
          query={query}
          onQueryChange={setQuery}
          inputRef={searchInputRef}
          searchPlaceholder="Search your library — movies, manga, novels, music..."
        />
      }
    >
      <div className="lib-page" data-status={status}>
        <LibraryHeroHeader totalLabel={totalLabel} />

        {status === "loading" ? (
          <div className="lib-layout">
            <div className="lib-main">
              <LibraryGridSkeleton count={10} />
            </div>
          </div>
        ) : status === "disconnected" ? (
          <LibraryDisconnectedState onConnect={() => setSetupOpen(true)} />
        ) : (
          <div className="lib-layout">
            <div className="lib-main">
              {/* 2 · Category overview cards (real counts) */}
              <section className="lib-categories" aria-label="Browse by category">
                {categories.map((summary) => (
                  <LibraryCategoryCard
                    key={summary.key}
                    summary={summary}
                    active={categoryFilter === summary.key}
                    onSelect={() =>
                      setCategoryFilter((cur) =>
                        cur === summary.key ? null : summary.key,
                      )
                    }
                  />
                ))}
              </section>

              {/* 3 · Quick filters + sort */}
              <LibraryFilterBar
                activeFilter={activeFilter}
                onFilterChange={setActiveFilter}
                sort={sort}
                onSortChange={setSort}
              />

              {/* 4 · Continue your story (real history; omitted when empty) */}
              <ContinueRail entries={continueEntries} onOpen={openEntry} />

              {/* 5 · All Items */}
              <section className="lib-section lib-allitems" aria-label="All items">
                <div className="lib-section__head">
                  <div className="lib-section__heading">
                    <h2 className="lib-section__title">All Items</h2>
                    <span className="lib-section__count">{countLabel}</span>
                  </div>
                  <div className="lib-viewtoggle" role="group" aria-label="Toggle view">
                    <button
                      type="button"
                      className={cn("ny-focusable", { "is-active": view === "grid" })}
                      onClick={() => setView("grid")}
                      aria-label="Grid view"
                      aria-pressed={view === "grid"}
                      title="Grid view"
                    >
                      <Grid2X2 aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={cn("ny-focusable", { "is-active": view === "list" })}
                      onClick={() => setView("list")}
                      aria-label="List view"
                      aria-pressed={view === "list"}
                      title="List view"
                    >
                      <List aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {filtered.length > 0 ? (
                  <LibraryGrid items={filtered} view={view} onOpen={openItem} />
                ) : unavailableCategory ? (
                  <LibraryStatePanel
                    icon={<CategoryIcon type={unavailableCategory} />}
                    tracker="Source not connected"
                    title={`No ${CATEGORY_META[unavailableCategory].name} yet`}
                    message={`Add the ${CATEGORY_META[unavailableCategory].name} folder inside your Nyrima Drive folder to browse it here.`}
                    tone="accent"
                    action={
                      <button
                        type="button"
                        className="ny-btn ny-btn--ghost"
                        onClick={() => setCategoryFilter(null)}
                      >
                        Back to all
                      </button>
                    }
                  />
                ) : isFiltered ? (
                  <LibraryStatePanel
                    icon={<List />}
                    tracker="No matches"
                    title="No items match your filters"
                    message="Try clearing the search or switching back to all items."
                    action={
                      <button
                        type="button"
                        className="ny-btn ny-btn--ghost"
                        onClick={resetFilters}
                      >
                        Clear filters
                      </button>
                    }
                  />
                ) : (
                  <LibraryStatePanel
                    icon={<Grid2X2 />}
                    tracker="Empty library"
                    title="Your library is empty"
                    message="Add supported files inside Nyrima/Movies, Nyrima/Manga, Nyrima/Light Novel, or Nyrima/Music."
                    action={
                      <button
                        type="button"
                        className="ny-btn ny-btn--primary"
                        onClick={() => setSetupOpen(true)}
                      >
                        Set up Drive
                      </button>
                    }
                  />
                )}
              </section>
            </div>

            {/* 6 · Compact, independently-scrolling insight column */}
            <aside className="lib-insight" aria-label="Library insights">
              <LibraryInsightPanel
                insights={insights}
                onConnectSource={() => setSetupOpen(true)}
              />
            </aside>
          </div>
        )}
      </div>

      {/* 7 · Floating Ny-chan assistant — real library search */}
      <NyChanAssistant
        search={search}
        onOpen={openResult}
        onShowAnime={() => {
          setCategoryFilter("movies");
          setActiveFilter(null);
        }}
        context={{
          driveConnected,
          libraryCount: items.length,
          latestAnime,
          latestContinue,
        }}
      />

      <SetupAccessDialog
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onSaved={() => setSetupOpen(false)}
      />
      </LobbyShell>
  );
}
