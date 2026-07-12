/**
 * MediaLibraryPage — routed Movies / Manga / Light Novel / Music pages.
 *
 * Source of truth is the selected Nyrima Drive root and its expected child
 * folders: Movies, Manga, Light Novel, Music. Each page indexes only its own
 * child folder and renders honest missing / empty / indexing states.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import {
  Archive,
  BookOpen,
  BookText,
  Clock3,
  Cloud,
  Disc3,
  Film,
  Grid2X2,
  HardDrive,
  Heart,
  LibraryBig,
  List,
  MoreHorizontal,
  Music,
  Play,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { LobbyShell, LobbySidebar, LobbyTopbar } from "../components/LobbyChrome";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import { LibraryHeroHeader, LibraryStatePanel, NyChanAssistant, describeLocalSource } from "../components/library-hub";
import { useNyrimaRootStore } from "../stores/nyrima-root-store";
import { useRecentStore } from "../stores/recent-store";
import { useSocialStore } from "../stores/social-store";
import { usePlaybackPositions } from "../hooks/usePlaybackPositions";
import { isInProgress, isWatched } from "../services/storage";
import { cleanTitle, formatRelativeTime } from "../components/library-hub/format";
import { formatBytes, formatRuntimeFromMillis } from "../services/formatters";
import {
  scanMediaFolderRecursive,
  type IndexedMediaFile,
  type MediaFolderScanResult,
  type MediaFolderScanStats,
} from "../services/media-library-index";
import {
  findMediaFolder,
  getExtension,
  getMediaFolderName,
  getSupportedMediaKind,
  mediaDurationMs,
  mediaFormatLabel,
  mediaResolutionLabel,
  type MediaLibraryKind,
} from "../services/media-library-source";
import { buildMusicAlbumGroups } from "../services/music-library";
import { MUSIC_LIBRARY_ROUTE, MUSIC_PLAYER_ROUTE_PREFIX } from "../services/music-player";
import { useLocalLibraryStore, type LocalLibraryStatus } from "../services/local-library/local-library-store";
import { isLocalId } from "@shared/local-id";
import type {
  ActivityEntry,
  LibraryCategoryKey,
  LibraryInsights,
  SearchResult,
  SourceStatusModel,
} from "../components/library-hub";
import type { DriveFile, PlaybackPosition, RecentFolder } from "@shared/types";
import "./AllLibraryPage.scss";

export type { MediaLibraryKind };

type SourceState =
  | "root-missing"
  | "folder-missing"
  | "indexing"
  | "empty"
  | "ready"
  | "error";

type MediaFilter =
  | "all"
  | "recent"
  | "continue"
  | "favorites"
  | "local"
  | "format"
  | "completed"
  | "albums"
  | "playlists";
type MediaSort = "recent" | "title" | "duration" | "progress";
type MediaView = "grid" | "list";

interface MediaDefinition {
  kind: MediaLibraryKind;
  visualCategory: LibraryCategoryKey;
  title: string;
  brandLabel: string;
  subtitle: string;
  allTitle: string;
  icon: LucideIcon;
  countNoun: string;
  metricLabels: [string, string, string, string];
  localMetricLabel: string;
  continueTitle: string;
  continueEmpty: string;
  missingTitle: string;
  missingMessage: string;
  emptyTitle: string;
  emptyMessage: string;
  overviewTitle: string;
  totalLabel: string;
  recentTitle: string;
  recentEmpty: string;
  filters: Array<{ key: MediaFilter; label: string }>;
  cardMode: "poster" | "manga" | "book" | "tracks";
}

const MEDIA_DEFINITIONS: Record<MediaLibraryKind, MediaDefinition> = {
  movies: {
    kind: "movies",
    visualCategory: "movies",
    title: "Movies",
    brandLabel: "Nyrima Movies",
    subtitle: "Your cinematic library across MKV, MP4, and other video formats.",
    allTitle: "All Movies",
    icon: Film,
    countNoun: "series",
    metricLabels: ["Series", "Continue Watching", "Favorites", "Local Video Files"],
    localMetricLabel: "Local Video Files",
    continueTitle: "Continue watching",
    continueEmpty: "No movie watch history yet.",
    missingTitle: "Movies folder was not found inside your Nyrima Drive folder.",
    missingMessage: "Create Nyrima/Movies in Google Drive and add supported video files.",
    emptyTitle: "No supported movie files found inside Nyrima/Movies.",
    emptyMessage: "Add MKV, MP4, WebM, AVI, MOV, or other supported video files to Nyrima/Movies.",
    overviewTitle: "Movies Overview",
    totalLabel: "Total series",
    recentTitle: "Recent Activity",
    recentEmpty: "No movie activity yet. Your watch history will appear here.",
    filters: [
      { key: "all", label: "All" },
      { key: "albums", label: "Albums" },
      { key: "playlists", label: "Playlists" },
      { key: "recent", label: "Recently Added" },
      { key: "continue", label: "Continue" },
      { key: "favorites", label: "Favorites" },
      { key: "local", label: "Local" },
      { key: "format", label: "Format" },
    ],
    cardMode: "poster",
  },
  manga: {
    kind: "manga",
    visualCategory: "manga",
    title: "Manga",
    brandLabel: "Nyrima Manga",
    subtitle: "Curated image-based stories from your connected sources.",
    allTitle: "All Manga",
    icon: BookOpen,
    countNoun: "items",
    metricLabels: ["Series", "Chapters", "Reading Now", "Local Archives"],
    localMetricLabel: "Local Archives",
    continueTitle: "Continue reading",
    continueEmpty: "No manga reading history is indexed yet.",
    missingTitle: "Manga folder was not found inside your Nyrima Drive folder.",
    missingMessage: "Create Nyrima/Manga and add image folders or supported manga archives.",
    emptyTitle: "No supported manga files found inside Nyrima/Manga.",
    emptyMessage: "Add image folders or supported manga archives to Nyrima/Manga.",
    overviewTitle: "Manga Overview",
    totalLabel: "Total manga",
    recentTitle: "Recent Reading Activity",
    recentEmpty: "No manga reading activity is indexed yet.",
    filters: [
      { key: "all", label: "All" },
      { key: "continue", label: "Reading" },
      { key: "completed", label: "Completed" },
      { key: "favorites", label: "Favorites" },
      { key: "local", label: "Local" },
      { key: "format", label: "Source" },
    ],
    cardMode: "manga",
  },
  "light-novel": {
    kind: "light-novel",
    visualCategory: "light-novel",
    title: "Light Novel",
    brandLabel: "Nyrima LN",
    subtitle: "A quiet shelf for EPUB stories and long-form reading.",
    allTitle: "All Light Novels",
    icon: BookText,
    countNoun: "volumes",
    metricLabels: ["Volumes", "Reading Now", "Completed", "EPUB Library"],
    localMetricLabel: "EPUB Library",
    continueTitle: "Continue reading",
    continueEmpty: "No light novel reading history is indexed yet.",
    missingTitle: "Light Novel folder was not found inside your Nyrima Drive folder.",
    missingMessage: "Create Nyrima/Light Novel and add EPUB files.",
    emptyTitle: "No supported EPUB files found inside Nyrima/Light Novel.",
    emptyMessage: "Add EPUB files to Nyrima/Light Novel.",
    overviewTitle: "Light Novel Overview",
    totalLabel: "Total novels",
    recentTitle: "Recent Reading Activity",
    recentEmpty: "No light novel reading activity is indexed yet.",
    filters: [
      { key: "all", label: "All" },
      { key: "continue", label: "Reading" },
      { key: "completed", label: "Completed" },
      { key: "favorites", label: "Favorites" },
      { key: "local", label: "Local" },
      { key: "format", label: "EPUB" },
    ],
    cardMode: "book",
  },
  music: {
    kind: "music",
    visualCategory: "music",
    title: "Music",
    brandLabel: "Nyrima Music",
    subtitle: "Your routed shelf for FLAC, MP3, albums, and playlists.",
    allTitle: "All Music",
    icon: Music,
    countNoun: "tracks",
    metricLabels: ["Tracks", "Albums", "Artists", "Playlists"],
    localMetricLabel: "Local Audio Files",
    continueTitle: "Continue listening",
    continueEmpty: "No music listening history is indexed yet.",
    missingTitle: "Music folder was not found inside your Nyrima Drive folder.",
    missingMessage: "Create Nyrima/Music and add FLAC, MP3, M4A, OGG, or WAV files.",
    emptyTitle: "No supported audio files found inside Nyrima/Music.",
    emptyMessage: "Add FLAC, MP3, or supported audio files to Nyrima/Music.",
    overviewTitle: "Music Overview",
    totalLabel: "Total tracks",
    recentTitle: "Recent Listening Activity",
    recentEmpty: "No music activity is indexed yet.",
    filters: [
      { key: "all", label: "All" },
      { key: "recent", label: "Recently Added" },
      { key: "continue", label: "Continue" },
      { key: "favorites", label: "Favorites" },
      { key: "local", label: "Local" },
      { key: "format", label: "Format" },
    ],
    cardMode: "tracks",
  },
};

interface MediaItem {
  id: string;
  title: string;
  kind: MediaLibraryKind;
  itemType?: "track" | "album" | "playlist";
  file?: DriveFile;
  folder?: DriveFile;
  folderId: string;
  fileId?: string;
  cover?: string;
  source: "drive" | "local";
  format?: string;
  resolution?: string;
  durationMs?: number;
  sizeBytes?: number;
  updatedAt?: number;
  progressPct?: number;
  watched?: boolean;
  favorite?: boolean;
  chapterCount?: number;
  pageCount?: number;
  episodeCount?: number;
  album?: string;
  artist?: string;
  trackCount?: number;
  trackIds?: string[];
  trackFiles?: DriveFile[];
  firstTrackId?: string;
  firstTrackTitle?: string;
}

interface SourceSnapshot {
  state: SourceState;
  folder: DriveFile | null;
  files: IndexedMediaFile[];
  items: MediaItem[];
  stats: MediaFolderScanStats | null;
  scannedAt: number;
  revalidating: boolean;
  error: string | null;
}

export function MediaLibraryPage({ kind }: { kind: MediaLibraryKind }) {
  const definition = MEDIA_DEFINITIONS[kind];
  const navigate = useNavigate();
  const root = useNyrimaRootStore((s) => s.root);
  const rootChildren = useNyrimaRootStore((s) => s.libraries);
  const mediaFolders = useNyrimaRootStore((s) => s.mediaFolders);
  const rootLoading = useNyrimaRootStore((s) => s.loading);
  const loadRoot = useNyrimaRootStore((s) => s.load);
  const refreshRoot = useNyrimaRootStore((s) => s.refresh);
  const recentFolders = useRecentStore((s) => s.folders);
  const loadRecents = useRecentStore((s) => s.load);
  const unreadCount = useSocialStore((s) => s.unreadCount);
  const [positions] = usePlaybackPositions(kind);
  const localStatus = useLocalLibraryStore((s) => s.status);
  const localRootName = useLocalLibraryStore((s) => s.rootName);
  const localScan = useLocalLibraryStore((s) => (kind === "manga" ? undefined : s.scans[kind]));

  const [collapsed, setCollapsed] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < 1280,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [sort, setSort] = useState<MediaSort>("recent");
  const [view, setView] = useState<MediaView>(definition.cardMode === "tracks" ? "list" : "grid");
  const [setupOpen, setSetupOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<SourceSnapshot>({
    state: "root-missing",
    folder: null,
    files: [],
    items: [],
    stats: null,
    scannedAt: 0,
    revalidating: false,
    error: null,
  });
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadRoot();
    void loadRecents();
  }, [loadRoot, loadRecents]);

  const mediaFolder = useMemo(
    () => mediaFolders[kind] ?? findMediaFolder(rootChildren, kind),
    [mediaFolders, rootChildren, kind],
  );

  useEffect(() => {
    if (rootLoading) {
      setSnapshot((current) => ({ ...current, state: "indexing", error: null }));
      return;
    }
    if (!root) {
      setSnapshot({
        state: "root-missing",
        folder: null,
        files: [],
        items: [],
        stats: null,
        scannedAt: 0,
        revalidating: false,
        error: null,
      });
      return;
    }
    if (!mediaFolder) {
      setSnapshot({
        state: "folder-missing",
        folder: null,
        files: [],
        items: [],
        stats: null,
        scannedAt: 0,
        revalidating: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    setSnapshot((current) => ({
      ...current,
      state: "indexing",
      folder: mediaFolder,
      error: null,
    }));
    void (async () => {
      try {
        const result = await scanMediaFolderRecursive({
          kind,
          folder: mediaFolder,
        });
        const items = await indexMediaFolder({
          kind,
          folder: mediaFolder,
          files: result.files,
          positions,
          recentFolders,
        });
        if (cancelled) return;
        setSnapshot({
          state: items.length > 0 ? "ready" : "empty",
          folder: mediaFolder,
          files: result.files,
          items,
          stats: result.stats,
          scannedAt: result.scannedAt,
          revalidating: result.revalidating,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        setSnapshot({
          state: "error",
          folder: mediaFolder,
          files: [],
          items: [],
          stats: null,
          scannedAt: 0,
          revalidating: false,
          error: error instanceof Error ? error.message : "Could not index this source.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root, rootLoading, mediaFolder, kind, positions, recentFolders]);

  const localItems = useMemo<MediaItem[]>(() => {
    if (!localScan) return [];
    return buildMediaItems(kind, localScan.folder, localScan.files, positions, recentFolders);
  }, [kind, localScan, positions, recentFolders]);

  const combinedItems = useMemo(
    () => [...snapshot.items, ...localItems],
    [snapshot.items, localItems],
  );
  const combinedFiles = useMemo(
    () => [...snapshot.files, ...(localScan?.files ?? [])],
    [snapshot.files, localScan],
  );

  // Movies are grouped into one card per show subfolder (the Nyrima Drive
  // layout is one folder per show). Episodes stay flat for Continue / search.
  const movieSeriesItems = useMemo<MediaItem[]>(
    () => (kind === "movies" ? buildMovieSeriesItems(combinedFiles, positions, recentFolders) : []),
    [kind, combinedFiles, positions, recentFolders],
  );

  const musicAlbumItems = useMemo<MediaItem[]>(() => {
    if (kind !== "music") return [];
    const trackById = new Map(combinedItems.map((item) => [item.id, item]));
    return buildMusicAlbumGroups(combinedFiles).flatMap((album) => {
      const tracks = album.tracks
        .map((entry) => trackById.get(entry.file.id))
        .filter((item): item is MediaItem => !!item);
      if (tracks.length === 0) return [];
      const firstTrack = tracks[0]!;
      const newest = Math.max(...tracks.map((item) => item.updatedAt ?? 0));
      const durationMs = tracks.reduce((sum, item) => sum + (item.durationMs ?? 0), 0);
      const artists = Array.from(new Set(tracks.map((item) => item.artist).filter(Boolean)));
      return [
        {
          id: album.id,
          title: album.title,
          kind: "music",
          itemType: "album",
          folderId: album.folderId,
          fileId: firstTrack.id,
          cover: firstTrack.cover,
          source: tracks.every((item) => item.source === "local") ? "local" : "drive",
          format: "ALBUM",
          durationMs: durationMs > 0 ? durationMs : undefined,
          updatedAt: newest > 0 ? newest : undefined,
          album: album.title,
          artist: artists.length === 1 ? artists[0] : artists.length > 1 ? `${artists.length} artists` : undefined,
          trackCount: tracks.length,
          trackIds: tracks.map((item) => item.id),
          trackFiles: tracks.map((item) => item.file).filter((file): file is DriveFile => !!file),
          firstTrackId: firstTrack.id,
          firstTrackTitle: firstTrack.title,
          favorite: tracks.some((item) => item.favorite),
        } satisfies MediaItem,
      ];
    });
  }, [kind, combinedFiles, combinedItems]);

  const activeItems = useMemo(() => {
    if (kind === "music" && filter === "albums") return musicAlbumItems;
    if (kind === "music" && filter === "playlists") return [];
    // The movies grid shows one card per series; episodes stay flat elsewhere.
    if (kind === "movies") return movieSeriesItems;
    return combinedItems;
  }, [kind, filter, musicAlbumItems, movieSeriesItems, combinedItems]);

  const effectiveState: SourceState = useMemo(() => {
    if (snapshot.state === "indexing" || snapshot.state === "error") return snapshot.state;
    if (combinedItems.length > 0) return "ready";
    return snapshot.state;
  }, [snapshot.state, combinedItems.length]);

  const searchItems = useMemo(
    () => (kind === "music" ? [...musicAlbumItems, ...combinedItems] : combinedItems),
    [kind, musicAlbumItems, combinedItems],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = activeItems.filter((item) => {
      if (q) {
        const haystack = [item.title, item.album, item.artist, item.format]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      switch (filter) {
        case "recent":
          return !!item.updatedAt;
        case "continue":
          return !!item.progressPct && item.progressPct > 0 && !item.watched;
        case "favorites":
          return !!item.favorite;
        case "local":
          return item.source === "local";
        case "format":
          return !!item.format;
        case "completed":
          return !!item.watched;
        case "albums":
          return item.itemType === "album";
        case "playlists":
          return item.itemType === "playlist";
        default:
          return true;
      }
    });
    list = [...list].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "duration") return (b.durationMs ?? 0) - (a.durationMs ?? 0);
      if (sort === "progress") return (b.progressPct ?? 0) - (a.progressPct ?? 0);
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
    return list;
  }, [activeItems, query, filter, sort]);

  // Movies count as series in the overview/metrics (one box per show); other
  // kinds count their flat items.
  const seriesCount = kind === "movies" ? movieSeriesItems.length : undefined;
  const metrics = useMemo(
    () =>
      buildMetrics(combinedItems, definition, {
        albumCount: musicAlbumItems.length,
        seriesCount,
      }),
    [combinedItems, definition, musicAlbumItems.length, seriesCount],
  );
  const insights = useMemo(
    () =>
      buildInsights(snapshot, definition, metrics, combinedItems, {
        status: localStatus,
        rootName: localRootName,
        scan: localScan,
        totalItems: seriesCount,
      }),
    [snapshot, definition, metrics, combinedItems, localStatus, localRootName, localScan, seriesCount],
  );
  const continueItems = useMemo(
    () =>
      combinedItems
        .filter((item) => item.progressPct && item.progressPct > 0 && !item.watched)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 10),
    [combinedItems],
  );

  const totalLabel = totalStatusLabel(snapshot, definition, seriesCount ?? combinedItems.length);
  const sectionTitle =
    kind === "music" && filter === "albums"
      ? "Albums"
      : kind === "music" && filter === "playlists"
        ? "Playlists"
        : definition.allTitle;
  const Icon = definition.icon;
  const openItem = (item: MediaItem) => {
    if (kind === "music") {
      const trackId = item.itemType === "album" ? item.firstTrackId ?? item.trackIds?.[0] : item.id;
      if (!trackId) return;
      navigate(`${MUSIC_PLAYER_ROUTE_PREFIX}/${encodeURIComponent(trackId)}`, {
        state: musicPlayerRouteState(item),
      });
      return;
    }
    // Light novels open in the dedicated EPUB reader.
    if (kind === "light-novel" && item.fileId) {
      navigate(`/read/${encodeURIComponent(item.folderId)}/${encodeURIComponent(item.fileId)}`);
      return;
    }
    if (kind === "movies" && item.fileId) {
      navigate(`/play/${encodeURIComponent(item.folderId)}/${encodeURIComponent(item.fileId)}`);
      return;
    }
    if (item.folderId) navigate(`/library/${encodeURIComponent(item.folderId)}`);
  };
  const search = (raw: string): SearchResult[] => {
    const q = raw.trim().toLowerCase();
    if (!q) return [];
    return searchItems
      .filter((item) =>
        [item.title, item.album, item.artist, item.format]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 12)
      .map((item) => ({
        key: `${kind}:${item.id}`,
        type: definition.visualCategory,
        title: item.title,
        subtitle:
          item.itemType === "album" && item.trackCount
            ? `${item.trackCount} tracks`
            : item.format,
        kind: item.fileId ? "file" : "library",
        folderId: item.folderId,
        fileId: item.fileId,
      }));
  };

  return (
      <LobbyShell
      collapsed={collapsed}
      sidebar={
        <LobbySidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
          onOpenDrive={() => setSetupOpen(true)}
        />
      }
      topbar={
        <LobbyTopbar
          query={query}
          onQueryChange={setQuery}
          inputRef={searchInputRef}
          unreadCount={unreadCount}
          searchPlaceholder={`Search ${definition.title.toLowerCase()}...`}
        />
      }
    >
      <div className="lib-page media-library-page" data-media={kind}>
        <LibraryHeroHeader
          totalLabel={totalLabel}
          title={definition.title}
          brandLabel={definition.brandLabel}
          subtitle={definition.subtitle}
          icon={<Icon />}
        />

        {snapshot.state === "indexing" ? (
          <LibraryStatePanel
            icon={<LibraryBig />}
            tracker="Indexing source"
            title={`Indexing ${getMediaFolderName(kind)}...`}
            message="Reading the matching Nyrima Drive folder and filtering supported files."
            tone="accent"
          />
        ) : (
          <div className="lib-layout">
            <div className="lib-main">
              <MediaMetricGrid
                metrics={metrics}
                visualCategory={definition.visualCategory}
                onMetricSelect={
                  kind === "music"
                    ? (nextFilter) => {
                        setQuery("");
                        setFilter(nextFilter);
                      }
                    : undefined
                }
              />

              <MediaContinueSection
                definition={definition}
                items={continueItems}
                onOpen={openItem}
              />

              {combinedItems.length > 0 && (
                <MediaFilterBar
                  definition={definition}
                  filter={filter}
                  onFilterChange={setFilter}
                  sort={sort}
                  onSortChange={setSort}
                  view={view}
                  onViewChange={setView}
                />
              )}

              <section className="lib-section lib-allitems" aria-label={sectionTitle}>
                <div className="lib-section__head">
                  <div className="lib-section__heading">
                    <h2 className="lib-section__title">{sectionTitle}</h2>
                    <span className="lib-section__count">
                      {filtered.length.toLocaleString()} {filtered.length === 1 ? "item" : "items"}
                    </span>
                  </div>
                </div>

                {renderMainContent({
                  state: effectiveState,
                  definition,
                  items: filtered,
                  query,
                  filter,
                  view,
                  error: snapshot.error,
                  onOpen: openItem,
                  onReset: () => {
                    setQuery("");
                    setFilter("all");
                  },
                  onConnect: () => setSetupOpen(true),
                })}
              </section>
            </div>

            <aside className="lib-insight" aria-label={`${definition.title} insights`}>
              <MediaInsightPanel definition={definition} insights={insights} />
            </aside>
          </div>
        )}
      </div>

      <NyChanAssistant
        search={search}
        onOpen={(result) => {
          if (result.fileId && kind === "movies") {
            navigate(`/play/${encodeURIComponent(result.folderId)}/${encodeURIComponent(result.fileId)}`);
          } else if (result.fileId && kind === "light-novel") {
            navigate(`/read/${encodeURIComponent(result.folderId)}/${encodeURIComponent(result.fileId)}`);
          } else if (result.fileId && kind === "music") {
            const item = combinedItems.find((entry) => entry.id === result.fileId);
            navigate(`${MUSIC_PLAYER_ROUTE_PREFIX}/${encodeURIComponent(result.fileId)}`, {
              state: item ? musicPlayerRouteState(item) : { sourceRoute: MUSIC_LIBRARY_ROUTE },
            });
          } else {
            navigate(`/library/${encodeURIComponent(result.folderId)}`);
          }
        }}
        onShowAnime={() => setFilter("all")}
        quickActions={quickActionsFor(definition)}
        context={{
          driveConnected: !!root,
          libraryCount: combinedItems.length,
          latestAnime: search("")[0],
          latestContinue: continueItems[0]
            ? {
                key: `${kind}:continue:${continueItems[0].id}`,
                type: definition.visualCategory,
                title: continueItems[0].title,
                subtitle: `${continueItems[0].progressPct}%`,
                kind: continueItems[0].fileId ? "file" : "library",
                folderId: continueItems[0].folderId,
                fileId: continueItems[0].fileId,
              }
            : undefined,
        }}
      />

      <SetupAccessDialog
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onSaved={() => {
          setSetupOpen(false);
          void refreshRoot();
        }}
      />
      </LobbyShell>
  );
}

function buildMediaItems(
  kind: MediaLibraryKind,
  folder: DriveFile,
  files: IndexedMediaFile[],
  positions: Record<string, PlaybackPosition>,
  recentFolders: RecentFolder[],
): MediaItem[] {
  if (kind === "movies" || kind === "light-novel") {
    return files.map((entry) => buildFileItem(kind, entry, positions, recentFolders));
  }

  if (kind === "music") {
    return files.map((entry) => {
      const [firstFolder, secondFolder] = entry.relativeFolderNames;
      return {
        ...buildFileItem("music", entry, positions, recentFolders),
        itemType: "track",
        artist: secondFolder ? firstFolder : undefined,
        album:
          secondFolder ??
          firstFolder ??
          (entry.parentFolder.id !== folder.id ? entry.parentFolder.name : undefined),
      };
    });
  }

  return buildMangaItems(files, folder, positions, recentFolders);
}

async function indexMediaFolder({
  kind,
  folder,
  files,
  positions,
  recentFolders,
}: {
  kind: MediaLibraryKind;
  folder: DriveFile;
  files: IndexedMediaFile[];
  positions: Record<string, PlaybackPosition>;
  recentFolders: RecentFolder[];
}): Promise<MediaItem[]> {
  return buildMediaItems(kind, folder, files, positions, recentFolders);
}

function buildFileItem(
  kind: MediaLibraryKind,
  entry: IndexedMediaFile,
  positions: Record<string, PlaybackPosition>,
  recentFolders: RecentFolder[],
): MediaItem {
  const file = entry.file;
  const position = positions[file.id];
  const progressPct =
    position && position.durationSeconds > 0
      ? Math.min(100, Math.round((position.positionSeconds / position.durationSeconds) * 100))
      : 0;
  const durationMs = mediaDurationMs(file);
  const updatedAt = position?.updatedAt ?? parseDriveDate(file.modifiedTime);
  return {
    id: file.id,
    title: cleanTitle(file.name),
    kind,
    file,
    folderId: entry.parentFolder.id,
    fileId:
      kind === "movies" || kind === "music" || kind === "light-novel"
        ? file.id
        : undefined,
    cover: file.thumbnailLink,
    source: isLocalId(file.id) ? "local" : "drive",
    format: mediaFormatLabel(file),
    resolution: kind === "movies" ? mediaResolutionLabel(file) : undefined,
    durationMs,
    sizeBytes: file.size ? Number(file.size) : undefined,
    updatedAt,
    progressPct,
    watched: position ? isWatched(position) : false,
    favorite: recentFolders.some((folder) => folder.id === file.id && folder.pinned),
  };
}

/**
 * Collapse the recursively-indexed movie files into one card per show.
 *
 * The Nyrima Drive layout is one subfolder per show (Movies/86 Eighty-Six/…),
 * optionally with Kan/Zoku season subfolders nested inside. We group by the
 * top-level show folder (`relativeFolderIds[0]`) so every season of a show
 * folds into a single series card that opens `/library/{showFolderId}`. Files
 * sitting directly in Movies/ root (true films) — and any local-source file,
 * whose folder ids don't resolve in LibraryPage — stay as direct-play cards.
 */
function buildMovieSeriesItems(
  files: IndexedMediaFile[],
  positions: Record<string, PlaybackPosition>,
  recentFolders: RecentFolder[],
): MediaItem[] {
  const recentById = new Map(recentFolders.map((entry) => [entry.id, entry] as const));
  const standalone: MediaItem[] = [];
  const groups = new Map<string, IndexedMediaFile[]>();

  for (const entry of files) {
    const showFolderId = entry.relativeFolderIds[0];
    if (!showFolderId || isLocalId(entry.file.id)) {
      standalone.push(buildFileItem("movies", entry, positions, recentFolders));
      continue;
    }
    const group = groups.get(showFolderId) ?? [];
    group.push(entry);
    groups.set(showFolderId, group);
  }

  const seriesItems = Array.from(groups.entries()).map(([showFolderId, group]) => {
    const first = group[0]!;
    const showName = first.relativeFolderNames[0] ?? first.parentFolder.name;
    let watchedCount = 0;
    let inProgressCount = 0;
    let newest = 0;
    let coverFromThumb: string | undefined;
    for (const entry of group) {
      const position = positions[entry.file.id];
      if (position) {
        if (isWatched(position)) watchedCount += 1;
        else if (isInProgress(position)) inProgressCount += 1;
      }
      const modified = parseDriveDate(entry.file.modifiedTime);
      if (modified && modified > newest) newest = modified;
      if (!coverFromThumb && entry.file.thumbnailLink) coverFromThumb = entry.file.thumbnailLink;
    }
    const recent = recentById.get(showFolderId);
    const total = group.length;
    // Card progress reflects how much of the series is watched; a partial
    // episode keeps the bar non-empty so the show reads as "in progress".
    const progressPct =
      watchedCount > 0
        ? Math.round((watchedCount / total) * 100)
        : inProgressCount > 0
          ? Math.max(3, Math.round((1 / total) * 100))
          : 0;
    return {
      id: showFolderId,
      title: cleanTitle(showName),
      kind: "movies",
      folderId: showFolderId,
      cover: recent?.coverPosterUrl ?? coverFromThumb,
      source: "drive",
      format: mediaFormatLabel(first.file),
      resolution: mediaResolutionLabel(first.file),
      updatedAt: newest > 0 ? newest : recent?.lastOpenedAt,
      progressPct,
      watched: total > 0 && watchedCount === total,
      favorite: recent?.pinned ?? false,
      episodeCount: total,
    } satisfies MediaItem;
  });

  return [...seriesItems, ...standalone];
}

function buildMangaItems(
  entries: IndexedMediaFile[],
  sourceFolder: DriveFile,
  positions: Record<string, PlaybackPosition>,
  recentFolders: RecentFolder[],
): MediaItem[] {
  const archiveItems = entries
    .filter((entry) => ["cbz", "cbr"].includes(getExtension(entry.file.name)))
    .map((entry) => buildFileItem("manga", entry, positions, recentFolders));

  const imageEntries = entries.filter((entry) => !["cbz", "cbr"].includes(getExtension(entry.file.name)));
  const directImageItems = imageEntries
    .filter((entry) => entry.relativeFolderNames.length === 0)
    .map((entry) => buildFileItem("manga", entry, positions, recentFolders));

  const grouped = new Map<string, IndexedMediaFile[]>();
  for (const entry of imageEntries) {
    const seriesId = entry.relativeFolderIds[0];
    if (!seriesId) continue;
    const current = grouped.get(seriesId) ?? [];
    current.push(entry);
    grouped.set(seriesId, current);
  }

  const seriesItems = Array.from(grouped.entries()).map(([seriesId, group]) => {
    const first = group[0]!;
    const seriesName = first.relativeFolderNames[0] ?? sourceFolder.name;
    const coverFile = firstCoverFile(group.map((entry) => entry.file));
    const firstFile = coverFile ?? first.file;
    const position = positions[firstFile.id];
    const progressPct =
      position && position.durationSeconds > 0
        ? Math.min(100, Math.round((position.positionSeconds / position.durationSeconds) * 100))
        : 0;
    const chapterNames = new Set(
      group
        .map((entry) => entry.relativeFolderNames[1])
        .filter((name): name is string => !!name),
    );
    const newest = Math.max(...group.map((entry) => parseDriveDate(entry.file.modifiedTime) ?? 0));

    return {
      id: seriesId,
      title: seriesName,
      kind: "manga",
      folderId: seriesId,
      cover: coverFile?.thumbnailLink,
      source: "drive",
      format: "IMAGE FOLDER",
      updatedAt: newest > 0 ? newest : undefined,
      progressPct,
      watched: position ? isWatched(position) : false,
      favorite: recentFolders.some((folder) => folder.id === seriesId && folder.pinned),
      chapterCount: chapterNames.size || undefined,
      pageCount: group.length || undefined,
    } satisfies MediaItem;
  });

  return [...seriesItems, ...archiveItems, ...directImageItems];
}

function firstCoverFile(files: DriveFile[]): DriveFile | undefined {
  return (
    files.find((file) => /cover|poster|front/i.test(file.name)) ??
    files.find((file) => getSupportedMediaKind(file) === "manga")
  );
}

function buildMetrics(
  items: MediaItem[],
  definition: MediaDefinition,
  options: { albumCount?: number; playlistCount?: number; seriesCount?: number } = {},
) {
  const inProgress = items.filter((item) => item.progressPct && item.progressPct > 0 && !item.watched).length;
  const favorites = items.filter((item) => item.favorite).length;
  const local = items.filter((item) => item.source === "local").length;
  const chapters = items.reduce((sum, item) => sum + (item.chapterCount ?? 0), 0);
  const albums = options.albumCount ?? new Set(items.map((item) => item.album).filter(Boolean)).size;
  const artists = new Set(items.map((item) => item.artist).filter(Boolean)).size;
  const playlists = options.playlistCount ?? 0;
  const completed = items.filter((item) => item.watched).length;
  const values =
    definition.kind === "manga"
      ? [items.length, chapters, inProgress, local]
      : definition.kind === "light-novel"
        ? [items.length, inProgress, completed, items.filter((item) => item.format === "EPUB").length]
        : definition.kind === "music"
          ? [items.length, albums, artists, playlists]
          : [options.seriesCount ?? items.length, inProgress, favorites, local];
  const icons: ReactNode[] = [
    <definition.icon aria-hidden="true" />,
    definition.kind === "music" ? <Disc3 aria-hidden="true" /> : <Clock3 aria-hidden="true" />,
    <Heart aria-hidden="true" />,
    definition.kind === "manga" ? <Archive aria-hidden="true" /> : <HardDrive aria-hidden="true" />,
  ];
  return definition.metricLabels.map((label, index) => ({
    id: label,
    label,
    value: values[index],
    meta:
      definition.kind === "manga" && label === "Chapters" && values[index] === 0
        ? "Metadata unavailable"
        : "Real indexed data",
    icon: icons[index],
  }));
}

function buildInsights(
  snapshot: SourceSnapshot,
  definition: MediaDefinition,
  metrics: ReturnType<typeof buildMetrics>,
  combinedItems: MediaItem[],
  local: { status: LocalLibraryStatus; rootName: string; scan?: MediaFolderScanResult; totalItems?: number },
): LibraryInsights {
  const sourceState: SourceStatusModel["state"] =
    snapshot.state === "ready" || snapshot.state === "empty" ? "connected" : "disconnected";
  const recentActivity: ActivityEntry[] = combinedItems
    .filter((item) => item.updatedAt && item.progressPct && item.progressPct > 0)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      text: `${item.watched ? "Finished" : "Continued"} ${item.title}`,
      time: item.updatedAt ? formatRelativeTime(item.updatedAt) : "",
    }));
  return {
    totalItems: local.totalItems ?? combinedItems.length,
    distribution: metrics.map((metric) => ({
      id: metric.id,
      key: definition.visualCategory,
      label: metric.label,
      count: metric.value,
    })),
    sources: [
      {
        id: "drive",
        name: "Google Drive",
        state: sourceState,
        detail: snapshot.folder
          ? `${getMediaFolderName(definition.kind)} · ${snapshot.items.length.toLocaleString()} indexed`
          : "Not connected",
      },
      localSourceStatus(local.status, local.rootName, definition, local.scan),
    ],
    recentActivity,
  };
}

function localSourceStatus(
  status: LocalLibraryStatus,
  rootName: string,
  definition: MediaDefinition,
  scan?: MediaFolderScanResult,
): SourceStatusModel {
  const count = scan?.files.length ?? 0;
  return describeLocalSource(
    status,
    rootName,
    `${rootName || "Connected"} · ${getMediaFolderName(definition.kind)} · ${count.toLocaleString()} indexed`,
  );
}

function MediaMetricGrid({
  metrics,
  visualCategory,
  onMetricSelect,
}: {
  metrics: ReturnType<typeof buildMetrics>;
  visualCategory: LibraryCategoryKey;
  onMetricSelect?: (filter: MediaFilter) => void;
}) {
  return (
    <section className="lib-categories media-metrics" aria-label="Media overview">
      {metrics.map((metric) => {
        const nextFilter = musicMetricFilter(metric.label);
        const content = (
          <>
            <span className="lib-cat-card__glow" aria-hidden="true" />
            <span className="lib-cat-card__icon" aria-hidden="true">
              {metric.icon}
            </span>
            <span className="lib-cat-card__body">
              <span className="lib-cat-card__name">{metric.label}</span>
              <span className="lib-cat-card__count">{metric.value.toLocaleString()}</span>
              <span className="lib-cat-card__meta">{metric.meta}</span>
            </span>
          </>
        );
        if (onMetricSelect && nextFilter) {
          return (
            <button
              key={metric.id}
              type="button"
              className="lib-cat-card lib-cat-card--static media-metric-button ny-focusable"
              data-cat={visualCategory}
              onClick={() => onMetricSelect(nextFilter)}
            >
              {content}
            </button>
          );
        }
        return (
          <article key={metric.id} className="lib-cat-card lib-cat-card--static" data-cat={visualCategory}>
            {content}
          </article>
        );
      })}
    </section>
  );
}

function musicMetricFilter(label: string): MediaFilter | null {
  if (label === "Tracks") return "all";
  if (label === "Albums") return "albums";
  if (label === "Playlists") return "playlists";
  return null;
}

function MediaContinueSection({
  definition,
  items,
  onOpen,
}: {
  definition: MediaDefinition;
  items: MediaItem[];
  onOpen: (item: MediaItem) => void;
}) {
  return (
    <section className="lib-section media-continue" aria-label={definition.continueTitle}>
      <div className="lib-section__head">
        <h2 className="lib-section__title">{definition.continueTitle}</h2>
        <span className="lib-section__hint">
          {items.length > 0 ? "Real progress from your library" : definition.continueEmpty}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="media-empty-rail">{definition.continueEmpty}</div>
      ) : (
        <div className={cn("media-continue__rail", `media-continue__rail--${definition.cardMode}`)} role="list">
          {items.map((item) => (
            <MediaCard key={item.id} item={item} definition={definition} compact onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function MediaFilterBar({
  definition,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  view,
  onViewChange,
}: {
  definition: MediaDefinition;
  filter: MediaFilter;
  onFilterChange: (filter: MediaFilter) => void;
  sort: MediaSort;
  onSortChange: (sort: MediaSort) => void;
  view: MediaView;
  onViewChange: (view: MediaView) => void;
}) {
  return (
    <div className="lib-filterbar media-filterbar">
      <div className="lib-filterbar__chips" role="group" aria-label={`${definition.title} filters`}>
        {definition.filters.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={cn("lib-chip", "ny-focusable", { "is-active": filter === chip.key })}
            onClick={() => onFilterChange(chip.key)}
            aria-pressed={filter === chip.key}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <label className="lib-control lib-control--sort">
        <span className="lib-control__label">Sort</span>
        <select value={sort} onChange={(event) => onSortChange(event.target.value as MediaSort)}>
          <option value="recent">Recent</option>
          <option value="title">Title</option>
          <option value="duration">Duration</option>
          <option value="progress">Progress</option>
        </select>
      </label>
      {definition.cardMode !== "tracks" && (
        <div className="lib-viewtoggle" role="group" aria-label="Toggle view">
          <button
            type="button"
            className={cn("ny-focusable", { "is-active": view === "grid" })}
            onClick={() => onViewChange("grid")}
            aria-label="Grid view"
          >
            <Grid2X2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className={cn("ny-focusable", { "is-active": view === "list" })}
            onClick={() => onViewChange("list")}
            aria-label="List view"
          >
            <List aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

function renderMainContent({
  state,
  definition,
  items,
  query,
  filter,
  view,
  error,
  onOpen,
  onReset,
  onConnect,
}: {
  state: SourceState;
  definition: MediaDefinition;
  items: MediaItem[];
  query: string;
  filter: MediaFilter;
  view: MediaView;
  error: string | null;
  onOpen: (item: MediaItem) => void;
  onReset: () => void;
  onConnect: () => void;
}) {
  const isFiltered = query.trim() !== "" || filter !== "all";
  if (state === "root-missing") {
    return (
      <LibraryStatePanel
        icon={<Cloud />}
        tracker="Source not connected"
        title="Nyrima folder is not connected"
        message="Connect your Nyrima Google Drive folder before browsing dedicated media shelves."
        action={<button type="button" className="ny-btn ny-btn--primary" onClick={onConnect}>Connect Drive</button>}
      />
    );
  }
  if (state === "folder-missing") {
    return (
      <LibraryStatePanel
        icon={<definition.icon />}
        tracker="Folder missing"
        title={definition.missingTitle}
        message={definition.missingMessage}
        tone="accent"
      />
    );
  }
  if (state === "error") {
    return (
      <LibraryStatePanel
        icon={<SearchX />}
        tracker="Index failed"
        title="Could not index this folder"
        message={error ?? "Try refreshing your Drive source."}
        tone="warning"
      />
    );
  }
  if (isFiltered && items.length === 0) {
    return (
      <LibraryStatePanel
        icon={<SearchX />}
        tracker="No matches"
        title="No items match your filters"
        message="Try clearing the search or switching back to all items."
        action={<button type="button" className="ny-btn ny-btn--ghost" onClick={onReset}>Clear filters</button>}
      />
    );
  }
  if (state === "empty") {
    return (
      <LibraryStatePanel
        icon={<definition.icon />}
        tracker="Empty source"
        title={definition.emptyTitle}
        message={definition.emptyMessage}
        tone="accent"
      />
    );
  }
  return <MediaCollection definition={definition} items={items} view={view} onOpen={onOpen} />;
}

function MediaCollection({
  definition,
  items,
  view,
  onOpen,
}: {
  definition: MediaDefinition;
  items: MediaItem[];
  view: MediaView;
  onOpen: (item: MediaItem) => void;
}) {
  if (definition.cardMode === "tracks") {
    if (items.some((item) => item.itemType === "album")) {
      return (
        <div className="media-album-grid">
          {items.map((item) => (
            <MusicAlbumCard key={item.id} item={item} onOpen={onOpen} />
          ))}
        </div>
      );
    }
    return (
      <div className="media-track-list">
        {items.map((item) => (
          <MusicRow key={item.id} item={item} onOpen={onOpen} />
        ))}
      </div>
    );
  }
  return (
    <div className={cn("media-grid", `media-grid--${definition.cardMode}`, { "media-grid--list": view === "list" })}>
      {items.map((item) => (
        <MediaCard key={item.id} item={item} definition={definition} onOpen={onOpen} />
      ))}
    </div>
  );
}

function MediaCard({
  item,
  definition,
  compact,
  onOpen,
}: {
  item: MediaItem;
  definition: MediaDefinition;
  compact?: boolean;
  onOpen: (item: MediaItem) => void;
}) {
  const Icon = definition.icon;
  return (
    <article
      className={cn("media-card", `media-card--${definition.cardMode}`, { "media-card--compact": compact })}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item);
        }
      }}
      aria-label={item.title}
    >
      <div className="media-card__cover">
        {item.cover ? (
          <img src={item.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="media-card__fallback" aria-hidden="true">
            <Icon />
          </span>
        )}
        <span className="media-badge media-badge--type">
          {definition.kind === "movies"
            ? item.episodeCount != null
              ? "SERIES"
              : "MOVIE"
            : item.format ?? definition.title.toUpperCase()}
        </span>
        {item.format && <span className="media-badge media-badge--format">{item.format}</span>}
        {item.resolution && <span className="media-badge media-badge--res">{item.resolution}</span>}
        {definition.kind === "movies" && item.fileId && (
          <span className="media-card__play" aria-hidden="true">
            <Play />
          </span>
        )}
      </div>
      <div className="media-card__body">
        <h3 className="media-card__title" title={item.title}>{item.title}</h3>
        <div className="media-card__meta">
          {item.episodeCount != null && (
            <span className="media-card__eps">
              {item.episodeCount} {item.episodeCount === 1 ? "ep" : "eps"}
            </span>
          )}
          {item.durationMs && <span>{formatRuntimeFromMillis(item.durationMs)}</span>}
          {item.chapterCount != null && <span>{item.chapterCount} chapters</span>}
          {item.pageCount != null && <span>{item.pageCount} pages</span>}
          {item.sizeBytes && <span>{formatBytes(item.sizeBytes)}</span>}
          {item.updatedAt && <span>{formatRelativeTime(item.updatedAt)}</span>}
        </div>
        {item.progressPct != null && item.progressPct > 0 && (
          <div className="lib-progress lib-progress--slim" aria-hidden="true">
            <span className="lib-progress__fill" style={{ width: `${Math.max(3, item.progressPct)}%` }} />
          </div>
        )}
        <div className="media-card__foot">
          {item.source === "local" ? (
            <span className="lib-source lib-source--local"><HardDrive /> Local</span>
          ) : (
            <span className="lib-source lib-source--drive"><Cloud /> Google Drive</span>
          )}
          <MoreHorizontal aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

function MusicAlbumCard({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  return (
    <button type="button" className="media-album-card ny-focusable" onClick={() => onOpen(item)}>
      <span className="media-album-card__cover" aria-hidden="true">
        {item.cover ? <img src={item.cover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Disc3 />}
        <span className="media-album-card__play"><Play /></span>
      </span>
      <span className="media-album-card__body">
        <span className="media-album-card__title">{item.title}</span>
        <span className="media-album-card__meta">
          {item.trackCount ? `${item.trackCount} ${item.trackCount === 1 ? "track" : "tracks"}` : "Album"}
          {item.artist ? ` · ${item.artist}` : ""}
        </span>
        <span className="media-album-card__sub">
          {item.firstTrackTitle ? `Starts with ${item.firstTrackTitle}` : item.durationMs ? formatRuntimeFromMillis(item.durationMs) : "Ready to play"}
        </span>
      </span>
    </button>
  );
}

function MusicRow({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  return (
    <button type="button" className="media-track-row ny-focusable" onClick={() => onOpen(item)}>
      <span className="media-track-row__disc" aria-hidden="true"><Music /></span>
      <span className="media-track-row__title">{item.title}</span>
      <span className="media-track-row__album">{item.album ?? "Library"}</span>
      <span className="media-track-row__format">{item.format}</span>
      <span className="media-track-row__duration">
        {item.durationMs ? formatRuntimeFromMillis(item.durationMs) : ""}
      </span>
    </button>
  );
}

function musicPlayerRouteState(item: MediaItem) {
  const isAlbum = item.itemType === "album";
  const trackId = isAlbum ? item.firstTrackId ?? item.trackIds?.[0] ?? item.id : item.id;
  const firstTrackFile = isAlbum ? item.trackFiles?.find((file) => file.id === trackId) : item.file;
  return {
    sourceRoute: MUSIC_LIBRARY_ROUTE,
    previousSection: "Music",
    track: {
      id: trackId,
      title: isAlbum ? item.firstTrackTitle ?? item.title : item.title,
      artist: item.artist,
      album: isAlbum ? item.title : item.album,
      cover: item.cover,
      durationMs: isAlbum && firstTrackFile ? mediaDurationMs(firstTrackFile) : item.durationMs,
      format: isAlbum && firstTrackFile ? mediaFormatLabel(firstTrackFile) : item.format,
      source: item.source,
      year: item.updatedAt ? String(new Date(item.updatedAt).getFullYear()) : undefined,
      genre: "Anime pop",
      playlistIds: isAlbum ? item.trackIds : undefined,
      playlistFiles: isAlbum ? item.trackFiles : undefined,
      autoPlay: true,
    },
  };
}

function MediaInsightPanel({
  definition,
  insights,
}: {
  definition: MediaDefinition;
  insights: LibraryInsights;
}) {
  const max = Math.max(1, ...insights.distribution.map((row) => row.count));
  return (
    <div className="lib-insight__inner media-insight">
      <section className="lib-panel">
        <header className="lib-panel__head">
          <span className="lib-panel__icon" aria-hidden="true"><definition.icon /></span>
          <h3>{definition.overviewTitle}</h3>
        </header>
        <div className="lib-panel__total">
          <span className="lib-panel__total-value">{insights.totalItems.toLocaleString()}</span>
          <span className="lib-panel__total-label">{definition.totalLabel}</span>
        </div>
        <ul className="lib-dist">
          {insights.distribution.map((row) => (
            <li key={row.id ?? row.label} className="lib-dist__row" data-cat={definition.visualCategory}>
              <span className="lib-dist__label">{row.label}</span>
              <span className="lib-dist__bar" aria-hidden="true">
                <span className="lib-dist__fill" style={{ width: `${row.count > 0 ? Math.max(4, (row.count / max) * 100) : 0}%` }} />
              </span>
              <span className="lib-dist__value">{row.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="lib-panel">
        <header className="lib-panel__head">
          <span className="lib-panel__icon" aria-hidden="true">
            {definition.kind === "music" ? <Disc3 /> : definition.kind === "movies" ? <HardDrive /> : <BookOpen />}
          </span>
          <h3>{definition.kind === "movies" || definition.kind === "music" ? "Storage Used" : "Reading Stats"}</h3>
        </header>
        <p className="lib-panel__empty">
          {definition.kind === "movies" || definition.kind === "music"
            ? "Storage usage is not reported by your connected sources yet."
            : "Reading statistics are unavailable until reader progress is indexed."}
        </p>
      </section>
      <section className="lib-panel">
        <header className="lib-panel__head">
          <span className="lib-panel__icon" aria-hidden="true"><Cloud /></span>
          <h3>{definition.kind === "manga" ? "Source Status" : "Sources"}</h3>
        </header>
        <div className="lib-panel__sources">
          {insights.sources.map((source) => (
            <div key={source.id} className={cn("lib-source-card", source.state === "connected" ? "is-ready" : "is-muted")}>
              <span className="lib-source-card__icon" aria-hidden="true">
                {source.id === "drive" ? <Cloud /> : <HardDrive />}
              </span>
              <span className="lib-source-card__body">
                <span className="lib-source-card__name">{source.name}</span>
                <span className="lib-source-card__detail">{source.detail}</span>
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="lib-panel">
        <header className="lib-panel__head">
          <span className="lib-panel__icon" aria-hidden="true"><Clock3 /></span>
          <h3>{definition.recentTitle}</h3>
        </header>
        {insights.recentActivity.length === 0 ? (
          <p className="lib-panel__empty">{definition.recentEmpty}</p>
        ) : (
          <ul className="lib-activity">
            {insights.recentActivity.map((item) => (
              <li key={item.id} className="lib-activity__row">
                <span className="lib-activity__dot" aria-hidden="true" />
                <span className="lib-activity__text">{item.text}</span>
                <span className="lib-activity__time">{item.time}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function totalStatusLabel(snapshot: SourceSnapshot, definition: MediaDefinition, totalCount: number): string {
  if (snapshot.state === "indexing") return "Indexing";
  if (snapshot.state === "error" && totalCount === 0) return "Unavailable";
  if (totalCount === 0) {
    if (snapshot.state === "root-missing") return "Not connected";
    if (snapshot.state === "folder-missing") return "Folder missing";
    return `No ${definition.countNoun}`;
  }
  return `${totalCount.toLocaleString()} ${totalCount === 1 ? singular(definition.countNoun) : definition.countNoun}`;
}

function quickActionsFor(definition: MediaDefinition) {
  if (definition.kind === "movies") {
    return [
      { id: "find", label: "Find a movie", query: "" },
      { id: "continue", label: "Continue watching" },
      { id: "mkv", label: "Show MKV files", query: ".mkv" },
      { id: "local", label: "Show local videos" },
    ];
  }
  if (definition.kind === "manga") {
    return [
      { id: "find", label: "Find a manga", query: "" },
      { id: "continue", label: "Continue reading" },
      { id: "unread", label: "Show unread chapters" },
      { id: "local", label: "Show local archives" },
    ];
  }
  if (definition.kind === "light-novel") {
    return [
      { id: "find", label: "Find a novel", query: "" },
      { id: "continue", label: "Continue reading" },
      { id: "epub", label: "Show EPUB files", query: ".epub" },
    ];
  }
  return [
    { id: "find", label: "Find a song", query: "" },
    { id: "continue", label: "Continue listening" },
    { id: "flac", label: "Show FLAC files", query: ".flac" },
    { id: "playlists", label: "Show playlists" },
  ];
}

function parseDriveDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function singular(noun: string): string {
  if (noun === "movies") return "movie";
  if (noun === "tracks") return "track";
  if (noun === "items") return "item";
  if (noun === "volumes") return "volume";
  return noun;
}
