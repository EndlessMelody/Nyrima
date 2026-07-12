/**
 * Unified "All Library" model — real data only.
 *
 * Today Nyrima indexes real source folders under the selected Nyrima Drive
 * root: Movies, Manga, Light Novel, and Music.
 * Manga (.epub-image), Light Novels (.epub) and Music (.flac/.mp3) have no
 * backend yet, so their categories report a real count of 0 and render a
 * "source not connected" affordance rather than fabricated content. The shapes
 * below are deliberately source-agnostic so those kinds slot in unchanged once
 * their indexers exist.
 */

export type LibraryCategoryKey = "movies" | "anime" | "manga" | "light-novel" | "music";

export type LibrarySource = "drive" | "local";

/** A collection-level item (a Drive library / series). */
export interface LibraryItem {
  /** Drive folder id. */
  id: string;
  type: LibraryCategoryKey;
  title: string;
  source: LibrarySource;
  /** Real cover from the folder's `Poster.*`, when present. */
  cover?: string;
  /** Real episode/file count, when the library has been scanned. */
  episodes?: number;
  /** Sum of known durations (ms). */
  runtimeMs?: number;
  /** Count of items past the watched threshold. */
  watchedCount?: number;
  /** Whether the library has an in-progress item (drives "Continue" filter). */
  inProgress?: boolean;
  favorite?: boolean;
  /** File-level indexed item route data. Folder-level collection items omit this. */
  folderId?: string;
  fileId?: string;
  fileFormat?: string;
  /** Newest member's modifiedTime (ms) — drives "Recently Added" + sort. */
  updatedAt?: number;
}

/** A file-level resume entry, sourced from real playback history. */
export interface ContinueEntry {
  fileId: string;
  folderId: string;
  type: LibraryCategoryKey;
  title: string;
  source: LibrarySource;
  cover?: string;
  /** e.g. "MKV", "MP4" — derived from the real filename/MIME. */
  fileFormat?: string;
  /** 0–100, from real position/duration. */
  progressPct: number;
  /** e.g. "14:32 left" — omitted when duration is unknown. */
  remainingLabel?: string;
  /** Real last-interaction time (ms). */
  updatedAt: number;
}

/** Overview-card summary for one category. */
export interface LibraryCategorySummary {
  key: LibraryCategoryKey;
  name: string;
  /** Headline count (real). 0 for sources that aren't connected. */
  count: number;
  /** Short real metadata line, or "" when nothing is known. */
  meta: string;
  /** Whether this category has a connected, indexed source. */
  available: boolean;
}

export type SourceState = "connected" | "disconnected" | "error";

export interface SourceStatusModel {
  id: LibrarySource;
  name: string;
  state: SourceState;
  /** Real detail line, e.g. "18 libraries · 248 episodes". */
  detail: string;
}

export interface ActivityEntry {
  id: string;
  text: string;
  /** Real relative time, e.g. "2h ago". */
  time: string;
}

export interface LibraryInsights {
  totalItems: number;
  distribution: Array<{
    key: LibraryCategoryKey;
    label: string;
    count: number;
    id?: string;
  }>;
  sources: SourceStatusModel[];
  recentActivity: ActivityEntry[];
}

/** Quick-filter chips — each maps to a real attribute. */
export type LibraryFilterKey = "recent" | "continue" | "favorites" | "completed";

export type LibrarySortKey = "recent" | "title" | "progress";

export type LibraryViewMode = "grid" | "list";

/** Top-level page status — drives the full-page state surfaces. */
export type LibraryStatus = "loading" | "ready" | "empty" | "disconnected";

/** A Ny-chan search hit, resolvable to a navigation action by the page. */
export interface SearchResult {
  /** Unique key. */
  key: string;
  type: LibraryCategoryKey;
  title: string;
  /** A real subtitle, e.g. "12 episodes" or "Resume · 64%". */
  subtitle?: string;
  kind: "library" | "file";
  folderId: string;
  fileId?: string;
}

export interface LibraryHubData {
  status: LibraryStatus;
  driveConnected: boolean;
  rootName: string | null;
  categories: LibraryCategorySummary[];
  continueEntries: ContinueEntry[];
  items: LibraryItem[];
  insights: LibraryInsights;
  /** Substring search across real indexed content (library + history). */
  search: (query: string) => SearchResult[];
  /** Most recent real resume target, if any. */
  latestContinue?: SearchResult;
  /** Most recently updated real movie/media item, if any. */
  latestAnime?: SearchResult;
  refresh: () => void;
}

/** Display metadata for each category. */
export const CATEGORY_META: Record<
  LibraryCategoryKey,
  { name: string; badge: string }
> = {
  movies: { name: "Movies", badge: "MOVIE" },
  anime: { name: "Anime", badge: "ANIME" },
  manga: { name: "Manga", badge: "MANGA" },
  "light-novel": { name: "Light Novel", badge: "LN" },
  music: { name: "Music", badge: "MUSIC" },
};
