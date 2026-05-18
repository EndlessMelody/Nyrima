/**
 * Library page — Cinematic folder lobby.
 *
 * Sections:
 *   - LobbyHero (featured video)
 *   - ContinueWatchingRow (partial watches in this folder)
 *   - PosterCard grid (all videos)
 *   - SuggestionList (random picks)
 *   - Compact folders row (subfolders)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useLibraryStore } from "../stores/library-store";
import { useRecentStore } from "../stores/recent-store";
import { usePlaybackPositions } from "../hooks/usePlaybackPositions";
import { LobbyHero } from "../components/LobbyHero";
import { ContinueWatchingRow } from "../components/ContinueWatchingRow";
import { LibrarySearchBar } from "../components/LibrarySearchBar";
import { PosterCard } from "../components/PosterCard";
import { PosterSkeleton } from "../components/PosterSkeleton";
import { SuggestionList } from "../components/SuggestionList";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import { NyrimaMark } from "../components/NyrimaMark";
import { DriveStatusBanner } from "../components/DriveStatusBanner";
import { resolveSeriesPoster } from "../services/poster-resolver";
import { getFileMetadata } from "../services/drive/metadata-service";
import { getManyCached } from "../services/metadata-cache";
import {
  getLibraryViewState,
  patchLibraryViewState,
} from "../services/storage";
import {
  buildLibraryVideoItems,
  filterLibraryItems,
  groupLibraryItems,
  sortLibraryItems,
  type LibraryFilter,
  type LibraryVideoGroup,
  type LibraryVideoItem,
} from "../services/library-view";
import { useSettingsStore } from "../stores/settings-store";
import { driveFolderUrl } from "@shared/drive-urls";
import type { DriveAccessReason } from "../services/errors";
import type {
  LibrarySortKey,
  LibraryViewMode,
  MovieMetadata,
} from "@shared/types";
import { formatBytes, formatRuntimeFromMillis } from "../services/formatters";
import "./LibraryPage.scss";

export function LibraryPage() {
  const { folderId = "" } = useParams();
  const navigate = useNavigate();
  const {
    loading,
    refreshing,
    cacheAgeAt,
    error,
    errorReason,
    videos,
    subfolders,
    loadFolder,
    refresh,
  } = useLibraryStore();
  const upsertRecent = useRecentStore((s) => s.upsert);
  const recentFolders = useRecentStore((s) => s.folders);
  const loadRecents = useRecentStore((s) => s.load);
  // Hydrate the recent-folders cache on mount so subfolder tiles can render
  // their stored poster + episode count without each tile fetching itself.
  useEffect(() => {
    void loadRecents();
  }, [loadRecents]);
  /** Folder-id → cached stats. Lets the SubfolderTile render a thumbnail +
   *  "12 EPS" line for any subfolder the user has previously visited, while
   *  staying graceful for never-opened siblings. */
  const recentById = useMemo(() => {
    const m = new Map<string, (typeof recentFolders)[number]>();
    for (const r of recentFolders) m.set(r.id, r);
    return m;
  }, [recentFolders]);
  const settings = useSettingsStore((s) => s.settings);
  const patchSettings = useSettingsStore((s) => s.patch);
  const [setupOpen, setSetupOpen] = useState(false);
  const [positions] = usePlaybackPositions(folderId);
  const [bulkMeta, setBulkMeta] = useState<Record<string, MovieMetadata>>({});
  const [featuredMeta, setFeaturedMeta] = useState<MovieMetadata | null>(null);
  const [folderName, setFolderName] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (folderId) void loadFolder(folderId);
  }, [folderId, loadFolder]);

  useEffect(() => {
    if (!folderId) return;
    let cancelled = false;
    setFolderName("");
    void getFileMetadata(folderId, { priority: "normal" })
      .then((folder) => {
        if (!cancelled) setFolderName(folder.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  // Hydrate per-folder UI state (last search + collapsed groups) on
  // navigation. Reset transient filter to "all" — we intentionally don't
  // persist the watched/in-progress filter because it's a per-session
  // intent, not a property of the library itself.
  useEffect(() => {
    setFilter("all");
    if (!folderId) {
      setQuery("");
      setCollapsedGroups(new Set());
      return;
    }
    // Reset scroll position so a new library always opens at its hero
    // rather than wherever the previous library's scroll happened to be.
    // `instant` avoids a smooth animation when the user is drilling
    // through nested folders quickly.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    }
    let cancelled = false;
    void (async () => {
      const view = await getLibraryViewState(folderId);
      if (cancelled) return;
      setQuery(view?.query ?? "");
      setCollapsedGroups(new Set(view?.collapsedGroups ?? []));
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  // Debounced persistence of query + collapsed groups. Skip the initial
  // hydration write by gating on `viewStateHydratedRef`, otherwise the
  // first render would write back the just-loaded values and bump
  // `updatedAt` for no reason.
  const viewStateHydratedRef = useRef<string>("");
  useEffect(() => {
    if (!folderId) return;
    // First effect run for this folder is the hydration; skip the write.
    if (viewStateHydratedRef.current !== folderId) {
      viewStateHydratedRef.current = folderId;
      return;
    }
    const t = window.setTimeout(() => {
      void patchLibraryViewState(folderId, {
        query,
        collapsedGroups: Array.from(collapsedGroups),
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [folderId, query, collapsedGroups]);

  // Note: an enriched upsertRecent runs further down once `libraryItems` and
  // `bulkMeta` are derived. That writes videoCount / runtimeMs / watchedCount
  // / coverPosterUrl so the lobby's LibraryCard can render real stats and a
  // cover backdrop without refetching the folder.

  const videoFiles = useMemo(() => videos.map((v) => v.video), [videos]);
  const libraryTitle =
    folderName ||
    deriveFolderName(videoFiles[0]?.name, subfolders[0]?.name) ||
    "Library";

  // Seed by folderId so revisiting the same library doesn't pick a new
  // featured every time (which would also trigger a poster-resolver call).
  const featured = useMemo(() => {
    if (videos.length === 0) return null;
    const seed = hashString(folderId);
    const idx = seed % Math.min(videos.length, 30);
    return videos[idx]?.video ?? null;
  }, [videos, folderId]);

  useEffect(() => {
    if (!featured) return;
    let cancelled = false;
    void (async () => {
      // Hero meta represents the *series*, not the specific picked episode.
      // Folder-keyed lookup shares one cached entry across all episodes and
      // matches the series poster the lobby's LibraryCard already shows.
      const meta = await resolveSeriesPoster(libraryTitle);
      if (!cancelled) setFeaturedMeta(meta);
    })();
    return () => {
      cancelled = true;
    };
  }, [featured, libraryTitle]);

  // Bulk-load cached metadata in one chrome.storage read so every PosterCard
  // doesn't pay its own round-trip; misses still fall back to the per-card
  // resolvePoster fetch.
  useEffect(() => {
    if (videos.length === 0) return;
    let cancelled = false;
    void (async () => {
      const ids = videos.map((v) => v.video.id);
      const map = await getManyCached(ids);
      if (!cancelled) setBulkMeta(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [videos]);

  const shortFolderId = (folderId || "").slice(0, 10).toUpperCase();
  const empty = videos.length === 0 && subfolders.length === 0;
  const sortKey = settings.librarySort;
  const viewMode = settings.libraryView;
  const libraryItems = useMemo(
    () =>
      buildLibraryVideoItems(videoFiles, {
        parentFolder: libraryTitle,
        positions,
      }),
    [videoFiles, libraryTitle, positions],
  );
  const filteredItems = useMemo(
    () => filterLibraryItems(libraryItems, query, filter),
    [libraryItems, query, filter],
  );
  const sortedItems = useMemo(
    () => sortLibraryItems(filteredItems, sortKey),
    [filteredItems, sortKey],
  );
  const groupedItems = useMemo(
    () => groupLibraryItems(sortedItems, sortKey),
    [sortedItems, sortKey],
  );

  // Persisted library stats on the RecentFolder entry. The lobby's
  // LibraryCard renders these without refetching the folder, so the user
  // gets episode counts + total runtime + a cover backdrop the moment they
  // open the lobby. Cover prefers the *first non-miss* MAL poster; with the
  // folder-aware resolver, every episode in a series resolves to the same
  // poster, so the first hit is the series cover.
  //
  // Fingerprint gating: this effect's deps include `libraryItems` (which
  // rebuilds whenever positions tick during background playback) and
  // `bulkMeta` (which can re-resolve as posters come in). Without a gate the
  // upsert wrote the same payload to chrome.storage every few seconds. The
  // ref-based fingerprint short-circuits identical writes; the ref is reset
  // on folderId change so re-entering a library always logs one fresh
  // `lastOpenedAt`.
  const lastUpsertedFingerprintRef = useRef<string>("");
  useEffect(() => {
    lastUpsertedFingerprintRef.current = "";
  }, [folderId]);
  useEffect(() => {
    if (!folderId || (videos.length === 0 && subfolders.length === 0)) return;
    const displayName =
      folderName ||
      deriveFolderName(videos[0]?.video.name, subfolders[0]?.name) ||
      "Drive folder";
    let runtimeMs = 0;
    let watchedCount = 0;
    let coverPosterUrl: string | undefined;
    let newestModifiedAt = 0;
    for (const item of libraryItems) {
      runtimeMs += item.durationMs;
      if (item.watched) watchedCount += 1;
      if (!coverPosterUrl) {
        const meta = bulkMeta[item.file.id];
        if (meta?.status === "ok" && meta.posterUrl) {
          coverPosterUrl = meta.posterUrl;
        }
      }
      // Track the newest file so the lobby's "N new" badge has a baseline to
      // compare against on subsequent visits.
      const modified = item.file.modifiedTime
        ? Date.parse(item.file.modifiedTime)
        : 0;
      if (Number.isFinite(modified) && modified > newestModifiedAt) {
        newestModifiedAt = modified;
      }
    }
    const fingerprint = JSON.stringify([
      displayName,
      videos.length,
      subfolders.length,
      runtimeMs,
      watchedCount,
      coverPosterUrl ?? "",
      newestModifiedAt,
    ]);
    if (fingerprint === lastUpsertedFingerprintRef.current) return;
    lastUpsertedFingerprintRef.current = fingerprint;
    // Visiting the library zeroes the badge. The next enrichment pass on
    // the lobby will re-compute pendingNewCount against the new lastSeenAt.
    void upsertRecent({
      id: folderId,
      name: displayName,
      lastOpenedAt: Date.now(),
      itemCount: videos.length + subfolders.length,
      videoCount: videos.length,
      runtimeMs: runtimeMs > 0 ? runtimeMs : undefined,
      watchedCount,
      coverPosterUrl,
      newestModifiedAt: newestModifiedAt > 0 ? newestModifiedAt : undefined,
      lastSeenAt: Date.now(),
      pendingNewCount: 0,
    });
  }, [
    folderId,
    folderName,
    videos,
    subfolders,
    libraryItems,
    bulkMeta,
    upsertRecent,
  ]);

  const setSortKey = (next: LibrarySortKey) => {
    void patchSettings({ librarySort: next });
  };
  const setViewMode = (next: LibraryViewMode) => {
    void patchSettings({ libraryView: next });
  };
  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // --- Keyboard shortcuts (theme 5) ---------------------------------------
  // `/` focuses the search input; `Esc` either clears the active search or
  // navigates back when the search is already empty. Ignored while the user
  // is typing in any other field so it doesn't fight form inputs.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "Escape") {
        // Escape inside the search input → clear it; otherwise → back to lobby.
        if (target === searchInputRef.current && query) {
          e.preventDefault();
          setQuery("");
          searchInputRef.current?.blur();
          return;
        }
        if (!inField) {
          navigate("/");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, query]);

  if (loading) {
    return (
      <div className="ny-library">
        <LibraryHeader
          title="Loading library…"
          shortFolderId={shortFolderId}
          onBack={() => navigate("/")}
        />
        <PosterSkeleton count={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="ny-library">
        <LibraryHeader
          title="Access denied"
          shortFolderId={shortFolderId}
          onBack={() => navigate("/")}
        />
        <AccessErrorCard
          reason={errorReason}
          message={error}
          folderId={folderId}
          onRetry={() => void loadFolder(folderId)}
          onOpenSetup={() => setSetupOpen(true)}
        />
        <SetupAccessDialog
          isOpen={setupOpen}
          onClose={() => setSetupOpen(false)}
          onSaved={() => {
            setSetupOpen(false);
            void loadFolder(folderId);
          }}
        />
      </div>
    );
  }

  return (
    <div className="ny-library">
      <LibraryHeader
        title={libraryTitle}
        shortFolderId={shortFolderId}
        onBack={() => navigate("/")}
      />

      {subfolders.length > 0 && (
        // Subfolders render as a tile grid (not chip strip) so the user
        // gets a real hit target with poster + episode count when those
        // are known. The header carries the kana caption + a count. Each
        // tile pulls its stored stats from `recentById` — never-visited
        // siblings still get a clean tile with just the folder name.
        <section className="ny-library__folders" aria-label="Subfolders">
          <header className="ny-library__folders-head">
            <span className="ny-library__folders-kana">
              子フォルダ · SUBFOLDERS
            </span>
            <span className="ny-library__folders-count">
              {subfolders.length}{" "}
              {subfolders.length === 1 ? "folder" : "folders"}
            </span>
          </header>
          <div className="ny-library__folders-grid">
            {subfolders.map((sf) => {
              const cached = recentById.get(sf.id);
              return (
                <button
                  key={sf.id}
                  type="button"
                  className="ny-subfolder-tile ny-focusable"
                  onClick={() =>
                    navigate(`/library/${encodeURIComponent(sf.id)}`)
                  }
                  aria-label={`Open subfolder ${sf.name}`}
                >
                  <div className="ny-subfolder-tile__thumb">
                    {cached?.coverPosterUrl ? (
                      <img
                        src={cached.coverPosterUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <SubfolderGlyph />
                    )}
                  </div>
                  <div className="ny-subfolder-tile__body">
                    <span className="ny-subfolder-tile__name">{sf.name}</span>
                    <span className="ny-subfolder-tile__meta">
                      {formatSubfolderMeta(cached)}
                    </span>
                  </div>
                  <ChevronOpenIcon />
                </button>
              );
            })}
          </div>
        </section>
      )}

      <DriveStatusBanner
        refreshing={refreshing}
        cacheAgeAt={cacheAgeAt}
        onRefresh={refresh}
      />

      {featured && (
        <LobbyHero file={featured} meta={featuredMeta} folderId={folderId} />
      )}

      {!empty && (
        <ContinueWatchingRow
          videos={videoFiles}
          folderId={folderId}
          positions={positions}
          metaByFileId={bulkMeta}
        />
      )}

      {videoFiles.length > 0 && (
        <section className="ny-library__section">
          <div className="ny-library__section-head">
            <h3 className="ny-library__section-heading">Videos</h3>
            <span className="ny-library__section-count">
              {filteredItems.length} shown
            </span>
          </div>

          <LibrarySearchBar
            query={query}
            onQueryChange={setQuery}
            filter={filter}
            onFilterChange={setFilter}
            sortKey={sortKey}
            onSortChange={setSortKey}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            totalCount={videoFiles.length}
            resultCount={filteredItems.length}
            inputRef={searchInputRef}
          />

          {filteredItems.length === 0 ? (
            <div className="ny-library__no-results">
              <span className="dc-tracker">NO MATCHES</span>
              <p>No videos match the current search and filters.</p>
            </div>
          ) : viewMode === "grouped" ? (
            <div className="ny-library__groups">
              {groupedItems.map((group) => (
                <LibraryGroupSection
                  key={group.id}
                  group={group}
                  folderId={folderId}
                  folderName={libraryTitle}
                  bulkMeta={bulkMeta}
                  seriesPosterUrl={featuredMeta?.posterUrl}
                  collapsed={collapsedGroups.has(group.id)}
                  onToggle={() => toggleGroup(group.id)}
                />
              ))}
            </div>
          ) : viewMode === "list" ? (
            <div className="ny-video-list">
              {sortedItems.map((item) => (
                <LibraryVideoRow
                  key={item.file.id}
                  item={item}
                  folderId={folderId}
                  meta={bulkMeta[item.file.id]}
                  seriesPosterUrl={featuredMeta?.posterUrl}
                />
              ))}
            </div>
          ) : (
            <div className="ny-poster-grid">
              {sortedItems.map((item) => (
                <PosterCard
                  key={item.file.id}
                  file={item.file}
                  folderId={folderId}
                  folderName={libraryTitle}
                  meta={bulkMeta[item.file.id]}
                  seriesPosterUrl={featuredMeta?.posterUrl}
                  playbackPosition={item.position}
                  watched={item.watched}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <SuggestionList
        videos={videoFiles}
        excludeFileId={featured?.id}
        folderId={folderId}
        folderName={libraryTitle}
        seriesPosterUrl={featuredMeta?.posterUrl}
      />

      {empty && (
        <div className="ny-library__empty">
          <NyrimaMark size="splash" />
          <span className="dc-tracker">EMPTY LIBRARY</span>
          <p className="ny-library__empty-title">No videos here yet</p>
          <p className="ny-library__empty-sub">
            This folder doesn't contain any recognized video files. Drop an MP4,
            WebM, or MKV onto Google Drive and it'll appear here.
          </p>
        </div>
      )}

      <SetupAccessDialog
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onSaved={() => setSetupOpen(false)}
      />
    </div>
  );
}

function LibraryHeader({
  title,
  shortFolderId,
  onBack,
}: {
  title: string;
  shortFolderId: string;
  onBack: () => void;
}) {
  return (
    <header className="ny-library__head">
      <div className="ny-library__head-left">
        <span className="ny-library__crumb">
          LIBRARY
          <span className="ny-library__crumb-sep" />
          {shortFolderId}
        </span>
        <h1 className="ny-library__title">{title}</h1>
      </div>
      <button type="button" className="ny-btn ny-btn--ghost" onClick={onBack}>
        <ChevronLeftIcon /> Back
      </button>
    </header>
  );
}

function LibraryGroupSection({
  group,
  folderId,
  folderName,
  bulkMeta,
  seriesPosterUrl,
  collapsed,
  onToggle,
}: {
  group: LibraryVideoGroup;
  folderId: string;
  folderName: string;
  bulkMeta: Record<string, MovieMetadata>;
  seriesPosterUrl?: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const noun =
    group.kind === "season"
      ? group.count === 1
        ? "ep"
        : "eps"
      : group.count === 1
        ? "title"
        : "titles";
  const duration = formatRuntimeFromMillis(group.durationMs);

  return (
    <section className="ny-library-group">
      <button
        type="button"
        className="ny-library-group__head"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className="ny-library-group__twisty" aria-hidden>
          {collapsed ? "+" : "-"}
        </span>
        <span className="ny-library-group__title">{group.title}</span>
        <span className="ny-library-group__meta">
          {group.count} {noun}
          {duration && <span>{duration}</span>}
          {group.watchedCount > 0 && <span>{group.watchedCount} watched</span>}
        </span>
      </button>

      {!collapsed && (
        <div className="ny-poster-grid">
          {group.items.map((item) => (
            <PosterCard
              key={item.file.id}
              file={item.file}
              folderId={folderId}
              folderName={folderName}
              meta={bulkMeta[item.file.id]}
              seriesPosterUrl={seriesPosterUrl}
              playbackPosition={item.position}
              watched={item.watched}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LibraryVideoRow({
  item,
  folderId,
  meta,
  seriesPosterUrl,
}: {
  item: LibraryVideoItem;
  folderId: string;
  meta?: MovieMetadata | null;
  seriesPosterUrl?: string;
}) {
  const navigate = useNavigate();
  // Prefer the parser-built `Series - EpNN` over `meta.title` so a series with
  // 12 episodes shows 12 distinct row labels instead of "Gimai Seikatsu" × 12.
  // `meta` is still the source of truth for the poster image.
  const title = item.parsed.fullTitle || meta?.title || item.file.name;
  // Thumbnail priority for the 16:9 row layout: Drive's frame thumbnail
  // first (an actual still from this episode), then the series poster
  // (so unprocessed episodes still get matched art instead of a blank
  // tile), then per-file MAL meta as last resort. This matches the user
  // ask: "use the file's thumbnail if it has one, otherwise the same
  // picture as the series poster".
  const thumb =
    item.file.thumbnailLink ||
    seriesPosterUrl ||
    meta?.backdropUrl ||
    meta?.posterUrl;
  const duration = formatRuntimeFromMillis(item.durationMs);
  const size = item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : "";
  const modified = formatModifiedDate(item.file.modifiedTime);

  const play = () => {
    navigate(
      `/play/${encodeURIComponent(folderId)}/${encodeURIComponent(item.file.id)}`,
    );
  };

  return (
    <div
      className="ny-video-row ny-focusable"
      role="button"
      tabIndex={0}
      onClick={play}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          play();
        }
      }}
      aria-label={`Play ${title}`}
    >
      <div className="ny-video-row__thumb">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" />
        ) : (
          <NyrimaMark size="header" />
        )}
      </div>
      <div className="ny-video-row__body">
        <span className="ny-video-row__title" title={title}>
          {title}
        </span>
        <span className="ny-video-row__file" title={item.file.name}>
          {item.file.name}
        </span>
        <div className="ny-video-row__meta">
          <span>{item.parsed.shortLabel}</span>
          {duration && <span>{duration}</span>}
          {size && <span>{size}</span>}
          {modified && <span>{modified}</span>}
          {item.watched ? (
            <span className="ny-video-row__status">Watched</span>
          ) : item.inProgress ? (
            <span className="ny-video-row__status">{item.progressPct}%</span>
          ) : null}
        </div>
        {item.progressPct > 0 && !item.watched && (
          <div className="ny-video-row__progress">
            <div style={{ width: `${item.progressPct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

function deriveFolderName(
  ...candidates: (string | undefined)[]
): string | undefined {
  return candidates.find(Boolean);
}

function formatModifiedDate(value: string | undefined): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(time);
}

/** Deterministic string → unsigned int hash; used to seed featured pick. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// AccessErrorCard
// ---------------------------------------------------------------------------

function AccessErrorCard({
  reason,
  message,
  folderId,
  onRetry,
  onOpenSetup,
}: {
  reason: DriveAccessReason | null;
  message: string;
  folderId: string;
  onRetry: () => void;
  onOpenSetup: () => void;
}) {
  const folderUrl = driveFolderUrl(folderId);
  const isPrivate = reason === "private-folder" || reason === "not-found";
  const needsKey = reason === "no-api-key" || reason === "auth-required";

  const title = needsKey
    ? "Drive access isn't set up yet"
    : isPrivate
      ? "This folder isn't shared publicly"
      : reason === "rate-limited"
        ? "Drive is rate-limiting us"
        : "Couldn't load this folder";

  return (
    <div className="dc-error">
      <div className="dc-error__head">
        <span className="dc-error__icon" aria-hidden>
          <LockIcon />
        </span>
        <div className="dc-error__body">
          <span className="dc-tracker dc-tracker--accent">
            ACCESS ERROR
            {reason && <span className="dc-error__reason">{reason}</span>}
          </span>
          <span className="dc-error__title">{title}</span>
          <span className="dc-error__sub">{message}</span>
        </div>
      </div>

      {isPrivate && (
        <div className="dc-error__steps">
          <span className="dc-error__steps-title">How to share the folder</span>
          <div>
            1.{" "}
            <a href={folderUrl} target="_blank" rel="noreferrer">
              Open the folder on drive.google.com
            </a>
            <br />
            2. Right-click the folder → <em>Share</em> → <em>Share</em>.
            <br />
            3. Under "General access" pick <em>Anyone with the link</em> →{" "}
            <em>Viewer</em>.
            <br />
            4. Click <em>Done</em>, then come back here and hit{" "}
            <em>Try again</em>.
          </div>
        </div>
      )}

      <div className="dc-error__actions">
        {needsKey && (
          <button
            type="button"
            className="ny-btn ny-btn--primary"
            onClick={onOpenSetup}
          >
            Setup access
          </button>
        )}
        <button type="button" className="ny-btn ny-btn--ghost" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
      <path
        d="m10 3-4 5 4 5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Subfolder glyph rendered on the tile when no cached poster is available.
 * A gradient-filled folder with a subtle inset highlight — reads as a real
 * navigation target rather than a wireframe stub. Each render gets a fresh
 * gradient id so multiple instances on the page don't share <defs>.
 */
function SubfolderGlyph() {
  const gid = `ny-subfolder-${useStableId()}`;
  return (
    <svg viewBox="0 0 36 36" fill="none" aria-hidden width="40" height="40">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand-on-background-strong)" />
          <stop offset="100%" stopColor="var(--accent-on-background-strong)" />
        </linearGradient>
        <linearGradient id={`${gid}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="color-mix(in srgb, var(--brand-background-medium) 30%, transparent)"
          />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path
        d="M4 11.2A2.4 2.4 0 0 1 6.4 8.8h4.6a2.4 2.4 0 0 1 1.7.7l1.5 1.5a1.6 1.6 0 0 0 1.13.47H29.6A2.4 2.4 0 0 1 32 13.87V25.6a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 25.6V11.2Z"
        fill={`url(#${gid}-fill)`}
      />
      <path
        d="M4 11.2A2.4 2.4 0 0 1 6.4 8.8h4.6a2.4 2.4 0 0 1 1.7.7l1.5 1.5a1.6 1.6 0 0 0 1.13.47H29.6A2.4 2.4 0 0 1 32 13.87V25.6a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 25.6V11.2Z"
        stroke={`url(#${gid})`}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Sakura petal accent on the folder tab — subtle theme echo. */}
      <circle cx="10" cy="12.5" r="1.4" fill="#ffb6c8" opacity="0.85" />
    </svg>
  );
}

/** Chevron pointing right — sits at the tile's right edge to advertise
 *  "this is a navigation target", not just a card. */
function ChevronOpenIcon() {
  return (
    <svg
      className="ny-subfolder-tile__chevron"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="m6 4 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Stable per-render id (used for SVG defs). Module-scoped counter so we
 *  don't depend on useId from React 18+; works back-compat. */
let __idCounter = 0;
function useStableId(): string {
  const ref = useRef<string>("");
  if (!ref.current) ref.current = String(++__idCounter);
  return ref.current;
}

/**
 * Build the meta line shown under a subfolder name. Uses cached stats from
 * the user's RecentFolder records when available; falls back to a soft
 * "Open" affordance for never-visited siblings so the tile never looks
 * empty.
 */
function formatSubfolderMeta(
  cached: { videoCount?: number; runtimeMs?: number } | undefined,
): string {
  if (!cached || cached.videoCount == null) return "Open folder";
  const parts: string[] = [];
  parts.push(
    `${cached.videoCount} ${cached.videoCount === 1 ? "ep" : "eps"}`,
  );
  if (cached.runtimeMs && cached.runtimeMs > 0) {
    parts.push(formatRuntimeFromMillis(cached.runtimeMs));
  }
  return parts.join(" · ");
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="3"
        y="7"
        width="10"
        height="6.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
