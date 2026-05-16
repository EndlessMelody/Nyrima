import { parseTitle, type ParsedVideoTitle } from "@shared/title-parser";
import type {
  DriveFile,
  LibrarySortKey,
  PlaybackPosition,
} from "@shared/types";
import { playbackProgressPct, isInProgress, isWatched } from "./storage";

export type LibraryFilter = "all" | "continue" | "unwatched" | "watched";

export interface LibraryVideoItem {
  file: DriveFile;
  parsed: ParsedVideoTitle;
  position?: PlaybackPosition;
  progressPct: number;
  watched: boolean;
  inProgress: boolean;
  durationMs: number;
  sizeBytes: number;
  modifiedMs: number;
  episodeSort: number;
  searchText: string;
  groupId: string;
  groupTitle: string;
  groupSubtitle: string;
  groupKind: "season" | "films";
}

export interface LibraryVideoGroup {
  id: string;
  title: string;
  subtitle: string;
  kind: "season" | "films";
  count: number;
  durationMs: number;
  watchedCount: number;
  items: LibraryVideoItem[];
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function buildLibraryVideoItems(
  videos: DriveFile[],
  options: {
    parentFolder: string;
    showFolder?: string;
    positions?: Record<string, PlaybackPosition>;
  },
): LibraryVideoItem[] {
  return videos.map((file) => {
    const parsed = parseTitle({
      filename: file.name,
      parentFolder: options.parentFolder,
      showFolder: options.showFolder,
    });
    const position = options.positions?.[file.id];
    const progressPct = playbackProgressPct(position);
    const watched = isWatched(position);
    const inProgress = isInProgress(position);
    const durationMs = numeric(file.videoMediaMetadata?.durationMillis);
    const sizeBytes = numeric(file.size);
    const modifiedMs = file.modifiedTime
      ? Date.parse(file.modifiedTime) || 0
      : 0;
    const episodeSort = parsed.episodeNumber
      ? Number(parsed.episodeNumber)
      : Number.MAX_SAFE_INTEGER;
    const group = groupForParsedTitle(parsed, options.parentFolder);

    return {
      file,
      parsed,
      position,
      progressPct,
      watched,
      inProgress,
      durationMs,
      sizeBytes,
      modifiedMs,
      episodeSort,
      searchText: [
        file.name,
        parsed.fullTitle,
        parsed.shortLabel,
        parsed.cleanedFileName,
        parsed.showTitle,
        parsed.seasonLabel,
        group.title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
      groupId: group.id,
      groupTitle: group.title,
      groupSubtitle: group.subtitle,
      groupKind: group.kind,
    };
  });
}

export function filterLibraryItems(
  items: LibraryVideoItem[],
  query: string,
  filter: LibraryFilter,
): LibraryVideoItem[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (tokens.length > 0 && !tokens.every((t) => item.searchText.includes(t))) {
      return false;
    }
    if (filter === "continue") return item.inProgress;
    if (filter === "watched") return item.watched;
    if (filter === "unwatched") return !item.watched;
    return true;
  });
}

export function sortLibraryItems(
  items: LibraryVideoItem[],
  sortKey: LibrarySortKey,
): LibraryVideoItem[] {
  return [...items].sort((a, b) => compareLibraryItems(a, b, sortKey));
}

export function groupLibraryItems(
  items: LibraryVideoItem[],
  sortKey: LibrarySortKey,
): LibraryVideoGroup[] {
  const map = new Map<string, LibraryVideoGroup>();
  for (const item of items) {
    let group = map.get(item.groupId);
    if (!group) {
      group = {
        id: item.groupId,
        title: item.groupTitle,
        subtitle: item.groupSubtitle,
        kind: item.groupKind,
        count: 0,
        durationMs: 0,
        watchedCount: 0,
        items: [],
      };
      map.set(item.groupId, group);
    }
    group.items.push(item);
    group.count += 1;
    group.durationMs += item.durationMs;
    if (item.watched) group.watchedCount += 1;
  }

  return [...map.values()]
    .map((group) => ({
      ...group,
      items: sortLibraryItems(group.items, sortKey),
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "season" ? -1 : 1;
      return collator.compare(a.title, b.title);
    });
}

export function compareLibraryItems(
  a: LibraryVideoItem,
  b: LibraryVideoItem,
  sortKey: LibrarySortKey,
): number {
  if (sortKey === "modified") {
    return b.modifiedMs - a.modifiedMs || compareByName(a, b);
  }
  if (sortKey === "size") {
    return b.sizeBytes - a.sizeBytes || compareByName(a, b);
  }
  if (sortKey === "duration") {
    return b.durationMs - a.durationMs || compareByName(a, b);
  }
  return compareByName(a, b);
}

function compareByName(a: LibraryVideoItem, b: LibraryVideoItem): number {
  const episodeDelta = a.episodeSort - b.episodeSort;
  if (Number.isFinite(episodeDelta) && episodeDelta !== 0) return episodeDelta;
  return collator.compare(a.parsed.shortLabel, b.parsed.shortLabel);
}

function groupForParsedTitle(
  parsed: ParsedVideoTitle,
  parentFolder: string,
): {
  id: string;
  title: string;
  subtitle: string;
  kind: "season" | "films";
} {
  const showTitle = titleCase(parsed.showTitle || parentFolder || "Library");
  if (!parsed.episodeNumber) {
    return {
      id: "films",
      title: "Films",
      subtitle: "Movies and specials",
      kind: "films",
    };
  }

  const season = normalizeSeasonLabel(parsed.seasonLabel) || "S01";
  return {
    id: `${showTitle.toLowerCase()}::${season.toLowerCase()}`,
    title: `${showTitle} · ${season}`,
    subtitle: "Episodes",
    kind: "season",
  };
}

function normalizeSeasonLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const normalized = label.replace(/[._-]+/g, " ").trim();
  const seasonMatch = normalized.match(/(?:season|s)\s*(\d{1,2})/i);
  if (seasonMatch) return `S${seasonMatch[1].padStart(2, "0")}`;
  const partMatch = normalized.match(/(?:part|cour)\s*(\d{1,2})/i);
  if (partMatch) return `Part ${partMatch[1]}`;
  if (/^\d{1,2}(?:st|nd|rd|th)?\s+season$/i.test(normalized)) {
    const n = normalized.match(/\d{1,2}/)?.[0];
    return n ? `S${n.padStart(2, "0")}` : normalized.toUpperCase();
  }
  return normalized.toUpperCase();
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function numeric(value: string | number | undefined): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
