/**
 * useLibraryHub -- the real, data-driven source for the All Library hub.
 *
 * The selected Nyrima Drive root only contributes source folders. Rendered
 * library cards come from recursively indexed supported files inside:
 * Movies, Manga, Light Novel, and Music.
 */

import { useEffect, useMemo, useState } from "react";
import { useNyrimaRootStore } from "../../stores/nyrima-root-store";
import { useRecentStore } from "../../stores/recent-store";
import { usePlaybackPositions } from "../../hooks/usePlaybackPositions";
import { isInProgress, isWatched } from "../../services/storage";
import { formatRuntimeFromMillis, formatTimecode } from "../../services/formatters";
import { cleanTitle, fileFormatLabel, formatRelativeTime } from "./format";
import {
  scanAllMediaFolders,
  type IndexedMediaFile,
  type MediaFolderScanResult,
} from "../../services/media-library-index";
import {
  MEDIA_LIBRARY_KINDS,
  getExtension,
  getMediaFolderName,
  mediaDurationMs,
  mediaFormatLabel,
  type MediaLibraryKind,
} from "../../services/media-library-source";
import { useLocalLibraryStore, type LocalLibraryStatus } from "../../services/local-library/local-library-store";
import { describeLocalSource } from "./local-source-status";
import { isLocalId } from "@shared/local-id";
import type {
  ContinueEntry,
  LibraryCategoryKey,
  LibraryCategorySummary,
  LibraryHubData,
  LibraryInsights,
  LibraryItem,
  LibraryStatus,
  SearchResult,
} from "./types";
import type { DriveFile, PlaybackPosition, RecentFolder } from "@shared/types";

const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_CONTINUE = 10;

const MEDIA_TO_CATEGORY: Record<MediaLibraryKind, LibraryCategoryKey> = {
  movies: "movies",
  manga: "manga",
  "light-novel": "light-novel",
  music: "music",
};

interface HubScanState {
  status: "idle" | "loading" | "ready" | "error";
  scans: MediaFolderScanResult[];
  error: string | null;
}

export function useLibraryHub(): LibraryHubData {
  const root = useNyrimaRootStore((s) => s.root);
  const rootLoading = useNyrimaRootStore((s) => s.loading);
  const mediaFolders = useNyrimaRootStore((s) => s.mediaFolders);
  const loadRoot = useNyrimaRootStore((s) => s.load);
  const refreshRoot = useNyrimaRootStore((s) => s.refresh);

  const recentFolders = useRecentStore((s) => s.folders);
  const loadRecents = useRecentStore((s) => s.load);

  const localStatus = useLocalLibraryStore((s) => s.status);
  const localRootName = useLocalLibraryStore((s) => s.rootName);
  const localScans = useLocalLibraryStore((s) => s.scans);
  const localConnected = localStatus === "ready";

  const [positions] = usePlaybackPositions();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [scanState, setScanState] = useState<HubScanState>({
    status: "idle",
    scans: [],
    error: null,
  });

  useEffect(() => {
    void loadRoot();
    void loadRecents();
  }, [loadRoot, loadRecents]);

  const folderSignature = MEDIA_LIBRARY_KINDS.map((kind) => mediaFolders[kind]?.id ?? "").join("|");

  useEffect(() => {
    if (!root) {
      setScanState({ status: "idle", scans: [], error: null });
      return;
    }

    const hasAnyCategoryFolder = MEDIA_LIBRARY_KINDS.some((kind) => !!mediaFolders[kind]);
    if (!hasAnyCategoryFolder) {
      setScanState({ status: "ready", scans: [], error: null });
      return;
    }

    let cancelled = false;
    setScanState((current) => ({
      status: "loading",
      scans: current.scans,
      error: null,
    }));

    void scanAllMediaFolders({ folders: mediaFolders })
      .then((scans) => {
        if (!cancelled) setScanState({ status: "ready", scans, error: null });
      })
      .catch((error) => {
        if (!cancelled) {
          setScanState({
            status: "error",
            scans: [],
            error: error instanceof Error ? error.message : "Could not index library sources.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [root, folderSignature, refreshNonce]);

  const driveConnected = !!root;

  const localScanList = useMemo<MediaFolderScanResult[]>(
    () =>
      MEDIA_LIBRARY_KINDS.filter((kind) => kind !== "manga")
        .map((kind) => localScans[kind])
        .filter((scan): scan is MediaFolderScanResult => !!scan),
    [localScans],
  );

  const items = useMemo<LibraryItem[]>(
    () => buildLibraryItems([...scanState.scans, ...localScanList], positions, recentFolders),
    [scanState.scans, localScanList, positions, recentFolders],
  );

  const continueEntries = useMemo<ContinueEntry[]>(() => {
    const itemByFile = new Map<string, LibraryItem>();
    for (const item of items) {
      if (item.fileId) itemByFile.set(item.fileId, item);
    }

    return Object.values(positions)
      .filter((p) => isInProgress(p) && p.folderId && p.name)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, MAX_CONTINUE)
      .map((p) => {
        const pct =
          p.durationSeconds > 0
            ? Math.min(100, Math.round((p.positionSeconds / p.durationSeconds) * 100))
            : 0;
        const remaining =
          p.durationSeconds > 0
            ? `${formatTimecode(p.durationSeconds - p.positionSeconds)} left`
            : undefined;
        const indexed = itemByFile.get(p.fileId);
        return {
          fileId: p.fileId,
          folderId: p.folderId!,
          type: indexed?.type ?? "movies",
          title: cleanTitle(p.name!),
          source: "drive",
          cover: indexed?.cover,
          fileFormat: fileFormatLabel(p.name, p.mimeType),
          progressPct: pct,
          remainingLabel: remaining,
          updatedAt: p.updatedAt ?? 0,
        } satisfies ContinueEntry;
      });
  }, [positions, items]);

  const counts = useMemo(() => countByCategory(items), [items]);
  const categories = useMemo<LibraryCategorySummary[]>(() => {
    return MEDIA_LIBRARY_KINDS.map((kind) => {
      const key = MEDIA_TO_CATEGORY[kind];
      const folder = mediaFolders[kind];
      const localScan = localScans[kind];
      const count = counts[key] ?? 0;
      const hasFolder = !!folder || !!localScan;
      const meta = !hasFolder
        ? driveConnected || localConnected
          ? "Folder missing"
          : "Not connected"
        : scanState.status === "loading" && count === 0 && !localScan
          ? "Indexing..."
          : count > 0
            ? `${count.toLocaleString()} ${count === 1 ? "item" : "items"}`
            : "No supported files";
      return {
        key,
        name: getMediaFolderName(kind),
        count,
        meta,
        available: hasFolder,
      } satisfies LibraryCategorySummary;
    });
  }, [counts, driveConnected, localConnected, localScans, folderSignature, mediaFolders, scanState.status]);

  const insights = useMemo<LibraryInsights>(() => {
    const recentActivity = Object.values(positions)
      .filter((p) => p.name && (p.updatedAt ?? 0) > 0)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 6)
      .map((p) => ({
        id: p.fileId,
        text: `${isWatched(p) ? "Finished" : isInProgress(p) ? "Continued" : "Opened"} ${cleanTitle(p.name!)}`,
        time: formatRelativeTime(p.updatedAt ?? 0),
      }));

    const scannedFolders = scanState.scans.reduce((sum, scan) => sum + scan.stats.scannedFolders, 0);
    const scannedFiles = scanState.scans.reduce((sum, scan) => sum + scan.stats.scannedFiles, 0);
    const localItemCount = localScanList.reduce((sum, scan) => sum + scan.files.length, 0);

    return {
      totalItems: items.length,
      distribution: categories.map((category) => ({
        key: category.key,
        label: category.name,
        count: category.count,
      })),
      sources: [
        {
          id: "drive",
          name: "Google Drive",
          state: driveConnected && scanState.status !== "error" ? "connected" : "disconnected",
          detail: driveConnected
            ? `${items.length.toLocaleString()} indexed · ${scannedFolders.toLocaleString()} folders scanned · ${scannedFiles.toLocaleString()} files checked`
            : "Not connected",
        },
        describeLocalSource(
          localStatus,
          localRootName,
          `${localRootName || "Connected"} · ${localItemCount.toLocaleString()} indexed`,
        ),
      ],
      recentActivity,
    } satisfies LibraryInsights;
  }, [positions, driveConnected, scanState.scans, scanState.status, items.length, categories, localStatus, localRootName, localScanList]);

  const searchIndex = useMemo<SearchResult[]>(() => {
    const itemEntries: SearchResult[] = items.map((item) => ({
      key: `item:${item.type}:${item.id}`,
      type: item.type,
      title: item.title,
      subtitle: item.fileFormat ?? categorySubtitle(item),
      kind: item.fileId ? "file" : "library",
      folderId: item.folderId ?? item.id,
      fileId: item.fileId,
    }));
    const fileEntries: SearchResult[] = Object.values(positions)
      .filter((p) => p.name && p.folderId)
      .map((p) => {
        const pct =
          p.durationSeconds > 0
            ? Math.round((p.positionSeconds / p.durationSeconds) * 100)
            : 0;
        return {
          key: `history:${p.fileId}`,
          type: "movies",
          title: cleanTitle(p.name!),
          subtitle: pct > 0 ? `Resume · ${pct}%` : "In history",
          kind: "file",
          folderId: p.folderId!,
          fileId: p.fileId,
        } satisfies SearchResult;
      });
    return [...fileEntries, ...itemEntries];
  }, [items, positions]);

  const search = useMemo(() => {
    return (query: string): SearchResult[] => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const seen = new Set<string>();
      const out: SearchResult[] = [];
      for (const entry of searchIndex) {
        const key = `${entry.kind}:${entry.folderId}:${entry.fileId ?? ""}`;
        if (entry.title.toLowerCase().includes(q) && !seen.has(key)) {
          seen.add(key);
          out.push(entry);
        }
        if (out.length >= 12) break;
      }
      return out;
    };
  }, [searchIndex]);

  const latestAnime = useMemo<SearchResult | undefined>(() => {
    const newest = [...items]
      .filter((item) => item.updatedAt)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    if (!newest) return undefined;
    return {
      key: `item:${newest.type}:${newest.id}`,
      type: newest.type,
      title: newest.title,
      subtitle: newest.fileFormat ?? categorySubtitle(newest),
      kind: newest.fileId ? "file" : "library",
      folderId: newest.folderId ?? newest.id,
      fileId: newest.fileId,
    };
  }, [items]);

  const latestContinue = useMemo<SearchResult | undefined>(() => {
    const top = continueEntries[0];
    if (!top) return undefined;
    return {
      key: `file:${top.fileId}`,
      type: top.type,
      title: top.title,
      subtitle: `Resume · ${top.progressPct}%`,
      kind: "file",
      folderId: top.folderId,
      fileId: top.fileId,
    };
  }, [continueEntries]);

  const status: LibraryStatus = !driveConnected && !localConnected
    ? "disconnected"
    : rootLoading || (scanState.status === "loading" && items.length === 0)
      ? "loading"
      : items.length === 0
        ? "empty"
        : "ready";

  return {
    status,
    driveConnected,
    rootName: root?.name ?? null,
    categories,
    continueEntries,
    items,
    insights,
    search,
    latestAnime,
    latestContinue,
    refresh: () => {
      void refreshRoot();
      void loadRecents();
      setRefreshNonce((value) => value + 1);
    },
  };
}

function buildLibraryItems(
  scans: MediaFolderScanResult[],
  positions: Record<string, PlaybackPosition>,
  recentFolders: RecentFolder[],
): LibraryItem[] {
  return scans.flatMap((scan) => {
    if (scan.kind === "manga") {
      return buildMangaLibraryItems(scan, positions, recentFolders);
    }
    return scan.files.map((entry) => buildFileLibraryItem(entry, positions, recentFolders));
  });
}

function buildFileLibraryItem(
  entry: IndexedMediaFile,
  positions: Record<string, PlaybackPosition>,
  recentFolders: RecentFolder[],
): LibraryItem {
  const file = entry.file;
  const position = positions[file.id];
  const durationMs = mediaDurationMs(file);
  const updatedAt = position?.updatedAt ?? parseDriveDate(file.modifiedTime);
  const fileFormat = mediaFormatLabel(file);
  return {
    id: file.id,
    type: MEDIA_TO_CATEGORY[entry.kind],
    title: cleanTitle(file.name),
    source: isLocalId(file.id) ? "local" : "drive",
    cover: file.thumbnailLink,
    runtimeMs: durationMs,
    watchedCount: position && isWatched(position) ? 1 : 0,
    inProgress: position ? isInProgress(position) : false,
    favorite: recentFolders.some((folder) => folder.id === file.id && folder.pinned),
    folderId: entry.parentFolder.id,
    fileId: entry.kind === "movies" ? file.id : undefined,
    fileFormat,
    updatedAt,
  };
}

function buildMangaLibraryItems(
  scan: MediaFolderScanResult,
  positions: Record<string, PlaybackPosition>,
  recentFolders: RecentFolder[],
): LibraryItem[] {
  const archiveItems = scan.files
    .filter((entry) => ["cbz", "cbr"].includes(getExtension(entry.file.name)))
    .map((entry) => buildFileLibraryItem(entry, positions, recentFolders));

  const imageEntries = scan.files.filter((entry) => !["cbz", "cbr"].includes(getExtension(entry.file.name)));
  const directImageItems = imageEntries
    .filter((entry) => entry.relativeFolderNames.length === 0)
    .map((entry) => buildFileLibraryItem(entry, positions, recentFolders));

  const groups = new Map<string, IndexedMediaFile[]>();
  for (const entry of imageEntries) {
    const seriesId = entry.relativeFolderIds[0];
    if (!seriesId) continue;
    const current = groups.get(seriesId) ?? [];
    current.push(entry);
    groups.set(seriesId, current);
  }

  const seriesItems = Array.from(groups.entries()).map(([seriesId, group]) => {
    const first = group[0]!;
    const seriesName = first.relativeFolderNames[0] ?? scan.folder.name;
    const cover = findCover(group.map((entry) => entry.file));
    const firstFile = cover ?? first.file;
    const position = positions[firstFile.id];
    const updatedAt = Math.max(...group.map((entry) => parseDriveDate(entry.file.modifiedTime) ?? 0));
    const chapterCount = new Set(
      group
        .map((entry) => entry.relativeFolderNames[1])
        .filter((name): name is string => !!name),
    ).size;

    return {
      id: seriesId,
      type: "manga",
      title: seriesName,
      source: "drive",
      cover: cover?.thumbnailLink,
      episodes: group.length,
      watchedCount: position && isWatched(position) ? 1 : 0,
      inProgress: position ? isInProgress(position) : false,
      favorite: recentFolders.some((folder) => folder.id === seriesId && folder.pinned),
      folderId: seriesId,
      fileFormat: chapterCount > 0 ? `${chapterCount} chapters` : "IMAGE FOLDER",
      updatedAt: updatedAt > 0 ? updatedAt : undefined,
    } satisfies LibraryItem;
  });

  return [...seriesItems, ...archiveItems, ...directImageItems];
}

function countByCategory(items: LibraryItem[]): Record<LibraryCategoryKey, number> {
  const counts = {
    movies: 0,
    anime: 0,
    manga: 0,
    "light-novel": 0,
    music: 0,
  } satisfies Record<LibraryCategoryKey, number>;
  for (const item of items) counts[item.type] += 1;
  return counts;
}

function categorySubtitle(item: LibraryItem): string {
  if (item.fileFormat) return item.fileFormat;
  if (item.episodes != null) return `${item.episodes} ${item.episodes === 1 ? "item" : "items"}`;
  if (item.runtimeMs) return formatRuntimeFromMillis(item.runtimeMs);
  return "Indexed from Drive";
}

function findCover(files: DriveFile[]): DriveFile | undefined {
  return (
    files.find((file) => /cover|poster|front/i.test(file.name)) ??
    files.find((file) => file.thumbnailLink)
  );
}

function parseDriveDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

/** Real runtime label for a library card, or "" when unknown. */
export function libraryRuntimeLabel(runtimeMs?: number): string {
  return runtimeMs ? formatRuntimeFromMillis(runtimeMs) : "";
}
