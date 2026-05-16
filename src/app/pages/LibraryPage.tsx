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

import { useEffect, useMemo, useState } from "react";
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
import { resolvePoster } from "../services/poster-resolver";
import { getFileMetadata } from "../services/drive/metadata-service";
import { getManyCached } from "../services/metadata-cache";
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

  useEffect(() => {
    setQuery("");
    setFilter("all");
    setCollapsedGroups(new Set());
  }, [folderId]);

  useEffect(() => {
    if (!folderId || (videos.length === 0 && subfolders.length === 0)) return;
    const displayName =
      folderName ||
      deriveFolderName(videos[0]?.video.name, subfolders[0]?.name) ||
      "Drive folder";
    void upsertRecent({
      id: folderId,
      name: displayName,
      lastOpenedAt: Date.now(),
      itemCount: videos.length + subfolders.length,
    });
  }, [folderId, folderName, videos, subfolders, upsertRecent]);

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
      const meta = await resolvePoster(featured, libraryTitle);
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
      />

      {subfolders.length > 0 && (
        <section className="ny-library__section">
          <h3 className="ny-library__section-heading">Folders</h3>
          <div className="ny-folder-row">
            {subfolders.map((sf) => (
              <div
                key={sf.id}
                className="ny-folder-chip ny-focusable"
                role="button"
                tabIndex={0}
                onClick={() =>
                  navigate(`/library/${encodeURIComponent(sf.id)}`)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/library/${encodeURIComponent(sf.id)}`);
                  }
                }}
                aria-label={`Open subfolder ${sf.name}`}
              >
                <SubfolderIcon />
                <span>{sf.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

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
  collapsed,
  onToggle,
}: {
  group: LibraryVideoGroup;
  folderId: string;
  folderName: string;
  bulkMeta: Record<string, MovieMetadata>;
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
}: {
  item: LibraryVideoItem;
  folderId: string;
  meta?: MovieMetadata | null;
}) {
  const navigate = useNavigate();
  // Prefer the parser-built `Series - EpNN` over `meta.title` so a series with
  // 12 episodes shows 12 distinct row labels instead of "Gimai Seikatsu" × 12.
  // `meta` is still the source of truth for the poster image.
  const title = item.parsed.fullTitle || meta?.title || item.file.name;
  const thumb = meta?.backdropUrl || meta?.posterUrl || item.file.thumbnailLink;
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

function SubfolderIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden width="16" height="16">
      <path
        d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3.2a1.5 1.5 0 0 1 1.06.44L9.2 5.3a1 1 0 0 0 .7.3H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 15.6H4A1.5 1.5 0 0 1 2.5 14.1v-8.6Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
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
