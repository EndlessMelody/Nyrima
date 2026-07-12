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

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { getFileMetadata } from "../services/drive/metadata-service";
import {
  findPosterFile,
  resolveFolderPoster,
} from "../services/folder-poster";
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
import { isDriveId } from "@shared/drive-id";
import type { DriveAccessReason } from "../services/errors";
import type { LibrarySortKey, LibraryViewMode } from "@shared/types";
import { formatBytes, formatRuntimeFromMillis } from "../services/formatters";
import "./LibraryPage.scss";

export function LibraryPage() {
  const params = useParams();
  const rawFolderId = params.folderId ?? "";
  const folderId = isDriveId(rawFolderId) ? rawFolderId : "";
  const invalidFolderId = rawFolderId.length > 0 && !folderId;
  const navigate = useNavigate();
  const {
    loading,
    refreshing,
    cacheAgeAt,
    error,
    errorReason,
    videos,
    subfolders,
    allFiles,
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
  /** Resolved folder cover URL — from the user-placed `Poster.{jpg,png,…}`
   *  in this library, or the parent library's poster when this one has none
   *  (matches Plex's "show poster applies to seasons" rule). */
  const [posterUrl, setPosterUrl] = useState<string | undefined>(undefined);
  /** Drive file id of the matched poster. Persisted on RecentFolder so a
   *  later visit can re-mint a fresh thumbnailLink if the cached URL has
   *  expired. */
  const [posterFileId, setPosterFileId] = useState<string | undefined>(undefined);
  const [folderName, setFolderName] = useState("");
  /** Parent folder id, captured from `getFileMetadata(folderId).parents[0]`.
   *  Drives the one-level-up poster fallback for season subfolders. */
  const [parentFolderId, setParentFolderId] = useState<string | undefined>(undefined);
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
    setParentFolderId(undefined);
    void getFileMetadata(folderId, { priority: "normal" })
      .then((folder) => {
        if (cancelled) return;
        setFolderName(folder.name);
        // `parents` is a single-element array under My Drive; shared drives
        // can sometimes return multiple. We only need one for the fallback
        // — the first is fine.
        setParentFolderId(folder.parents?.[0]);
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
  // the folder poster are derived. That writes videoCount / runtimeMs /
  // watchedCount / coverPosterUrl so the lobby's LibraryCard can render real
  // stats and a cover backdrop without refetching the folder.

  const videoFiles = useMemo(() => videos.map((v) => v.video), [videos]);
  const libraryTitle =
    folderName ||
    deriveFolderName(videoFiles[0]?.name, subfolders[0]?.name) ||
    "Library";

  // Seed by folderId so revisiting the same library doesn't pick a new
  // featured every time — keeps the hero stable across re-renders.
  const featured = useMemo(() => {
    if (videos.length === 0) return null;
    const seed = hashString(folderId);
    const idx = seed % Math.min(videos.length, 30);
    return videos[idx]?.video ?? null;
  }, [videos, folderId]);

  // Resolve the folder's cover poster. First we scan the already-loaded
  // file listing (`allFiles`) for a `Poster.{jpg,png,…}` — that's the fast
  // path and covers most libraries. If absent, we fall through to the
  // parent folder's poster (a season subfolder inheriting its show's
  // poster). Both lookups are cache-fronted by the metadata service.
  useEffect(() => {
    if (!folderId) {
      setPosterUrl(undefined);
      setPosterFileId(undefined);
      return;
    }
    // Synchronous read of the already-loaded listing — no Drive request.
    const localPoster = findPosterFile(allFiles);
    if (localPoster?.thumbnailLink) {
      setPosterUrl(localPoster.thumbnailLink);
      setPosterFileId(localPoster.id);
      return;
    }
    // No local poster: try the parent folder. Only fires when we know the
    // parent id (captured in the folderName effect above).
    if (!parentFolderId) {
      setPosterUrl(undefined);
      setPosterFileId(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      const inherited = await resolveFolderPoster(folderId, parentFolderId);
      if (cancelled) return;
      setPosterUrl(inherited?.url);
      setPosterFileId(inherited?.fileId);
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, allFiles, parentFolderId]);

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
  // open the lobby. The cover comes from the folder's `Poster.{jpg,png,…}`
  // (resolved above into `posterUrl` / `posterFileId`).
  //
  // Fingerprint gating: this effect's deps include `libraryItems` (which
  // rebuilds whenever positions tick during background playback) and
  // `posterUrl` (which resolves async). Without a gate the upsert wrote
  // the same payload to chrome.storage every few seconds. The ref-based
  // fingerprint short-circuits identical writes; the ref is reset on
  // folderId change so re-entering a library always logs one fresh
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
    let newestModifiedAt = 0;
    for (const item of libraryItems) {
      runtimeMs += item.durationMs;
      if (item.watched) watchedCount += 1;
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
      posterUrl ?? "",
      posterFileId ?? "",
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
      coverPosterUrl: posterUrl,
      coverFileId: posterFileId,
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
    posterUrl,
    posterFileId,
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
          navigate("/app");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, query]);
  const withTransition = (content: ReactNode) => content;

  if (invalidFolderId) {
    return withTransition(
      <div className="ny-library">
        <LibraryHeader
          title="Invalid library link"
          shortFolderId="INVALID"
          onBack={() => navigate("/app")}
        />
        <div className="dc-error">
          <div className="dc-error__head">
            <span className="dc-error__icon" aria-hidden>
              <LockIcon />
            </span>
            <div className="dc-error__body">
              <span className="dc-tracker dc-tracker--accent">
                INVALID DRIVE ID
              </span>
              <span className="dc-error__title">
                This library URL is malformed
              </span>
              <span className="dc-error__sub">
                Open the folder from Google Drive or paste a valid Drive folder
                link in Nyrima.
              </span>
            </div>
          </div>
        </div>
      </div>,
    );
  }

  if (loading) {
    return withTransition(
      <div className="ny-library">
        <LibraryHeader
          title="Loading library…"
          shortFolderId={shortFolderId}
          onBack={() => navigate("/app")}
        />
        <PosterSkeleton count={5} />
      </div>,
    );
  }

  if (error) {
    return withTransition(
      <div className="ny-library">
        <LibraryHeader
          title="Access denied"
          shortFolderId={shortFolderId}
          onBack={() => navigate("/app")}
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
      </div>,
    );
  }

  return withTransition(
    <div className="ny-library">
      <LibraryHeader
        title={libraryTitle}
        shortFolderId={shortFolderId}
        onBack={() => navigate("/app")}
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
              Subfolders
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
        <LobbyHero
          file={featured}
          posterUrl={posterUrl}
          title={libraryTitle}
          folderId={folderId}
        />
      )}

      {!empty && (
        <ContinueWatchingRow
          videos={videoFiles}
          folderId={folderId}
          positions={positions}
          seriesPosterUrl={posterUrl}
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
                  seriesPosterUrl={posterUrl}
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
                  seriesPosterUrl={posterUrl}
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
                  seriesPosterUrl={posterUrl}
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
        seriesPosterUrl={posterUrl}
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
    </div>,
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
  seriesPosterUrl,
  collapsed,
  onToggle,
}: {
  group: LibraryVideoGroup;
  folderId: string;
  folderName: string;
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
  seriesPosterUrl,
}: {
  item: LibraryVideoItem;
  folderId: string;
  seriesPosterUrl?: string;
}) {
  const navigate = useNavigate();
  // Parser-built `Series - EpNN` keeps each episode distinct; fall back to
  // the raw filename when the parser can't pick a clean label.
  const title = item.parsed.fullTitle || item.file.name;
  // Thumbnail priority for the 16:9 row layout: Drive's frame thumbnail
  // first (an actual still from this episode), then the folder poster
  // (so unprocessed episodes still get matched art instead of a blank
  // tile). Matches the user ask: "use the file's thumbnail if it has one,
  // otherwise the same picture as the folder poster".
  const thumb = item.file.thumbnailLink || seriesPosterUrl;
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
