/**
 * Persistence for the Light Novel reader.
 *
 * Three concerns, three keys in chrome.storage.local (web-backed by the
 * platform adapter, so everything is account-partitioned automatically):
 *   - prefs:    one global typography/theme set (see ReaderPrefs)
 *   - progress: per-book chapter + scroll position, keyed by Drive file id
 *   - bookmarks: per-book bookmark lists, keyed by Drive file id
 *
 * Reading progress is *also* mirrored into the shared playback-position store
 * so the Light Novel shelf's "Continue reading" rail and progress bars light
 * up using the exact infrastructure the rest of the app already reads — the
 * EPUB is modelled as positionSeconds = percent, durationSeconds = 100.
 */

import { STORAGE_KEYS } from "@shared/constants";
import { savePlaybackPosition } from "../storage";
import {
  DEFAULT_READER_PREFS,
  normalizeReaderPrefs,
  type ReaderPrefs,
} from "./reader-prefs";

async function get<T>(key: string): Promise<T | undefined> {
  const obj = await chrome.storage.local.get(key);
  return obj[key] as T | undefined;
}

async function set<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// --- Preferences -----------------------------------------------------------

export async function getReaderPrefs(): Promise<ReaderPrefs> {
  const stored = await get<Partial<ReaderPrefs>>(STORAGE_KEYS.READER_PREFS);
  return normalizeReaderPrefs(stored);
}

export async function saveReaderPrefs(prefs: ReaderPrefs): Promise<void> {
  await set(STORAGE_KEYS.READER_PREFS, normalizeReaderPrefs(prefs));
}

// --- Progress --------------------------------------------------------------

export interface ReaderProgress {
  fileId: string;
  chapterIndex: number;
  /** 0..1 scroll position within the current chapter. */
  scrollRatio: number;
  /** 0..100 whole-book percentage (for the shelf + meta line). */
  percent: number;
  updatedAt: number;
  title?: string;
  folderId?: string;
}

type ProgressMap = Record<string, ReaderProgress>;

const PROGRESS_CAP = 300;

export async function getReaderProgress(
  fileId: string,
): Promise<ReaderProgress | undefined> {
  const map = (await get<ProgressMap>(STORAGE_KEYS.READER_PROGRESS)) ?? {};
  return map[fileId];
}

export async function saveReaderProgress(
  progress: Omit<ReaderProgress, "updatedAt">,
): Promise<void> {
  const map = (await get<ProgressMap>(STORAGE_KEYS.READER_PROGRESS)) ?? {};
  map[progress.fileId] = { ...progress, updatedAt: Date.now() };

  // Soft prune oldest entries so a heavy reader doesn't fill the partition.
  const entries = Object.entries(map);
  if (entries.length > PROGRESS_CAP) {
    entries.sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
    await set(
      STORAGE_KEYS.READER_PROGRESS,
      Object.fromEntries(entries.slice(0, PROGRESS_CAP)),
    );
  } else {
    await set(STORAGE_KEYS.READER_PROGRESS, map);
  }

  // Mirror into the shared playback store so Continue Reading + progress bars
  // on the Light Novel shelf reflect reading position with zero extra wiring.
  await savePlaybackPosition({
    fileId: progress.fileId,
    positionSeconds: progress.percent,
    durationSeconds: 100,
    updatedAt: Date.now(),
    name: progress.title,
    folderId: progress.folderId,
    mimeType: "application/epub+zip",
  });
}

// --- Bookmarks -------------------------------------------------------------

export interface ReaderBookmark {
  id: string;
  chapterIndex: number;
  scrollRatio: number;
  chapterLabel: string;
  /** Short text excerpt near the bookmarked position, for the list. */
  excerpt: string;
  createdAt: number;
}

type BookmarkMap = Record<string, ReaderBookmark[]>;

export async function getBookmarks(fileId: string): Promise<ReaderBookmark[]> {
  const map = (await get<BookmarkMap>(STORAGE_KEYS.READER_BOOKMARKS)) ?? {};
  return map[fileId] ?? [];
}

export async function saveBookmarks(
  fileId: string,
  bookmarks: ReaderBookmark[],
): Promise<void> {
  const map = (await get<BookmarkMap>(STORAGE_KEYS.READER_BOOKMARKS)) ?? {};
  if (bookmarks.length === 0) delete map[fileId];
  else map[fileId] = bookmarks;
  await set(STORAGE_KEYS.READER_BOOKMARKS, map);
}

// --- Highlights + notes ----------------------------------------------------

export interface ReaderHighlight {
  id: string;
  chapterIndex: number;
  /** Character offsets into the chapter's rendered text. */
  start: number;
  end: number;
  /** Highlight color key (see HIGHLIGHT_COLORS in the reader UI). */
  color: string;
  /** The highlighted text — shown in the list + used as a fallback excerpt. */
  text: string;
  /** Optional free-text note attached to the highlight. */
  note?: string;
  createdAt: number;
}

type HighlightMap = Record<string, ReaderHighlight[]>;

export async function getHighlights(fileId: string): Promise<ReaderHighlight[]> {
  const map = (await get<HighlightMap>(STORAGE_KEYS.READER_HIGHLIGHTS)) ?? {};
  return map[fileId] ?? [];
}

export async function saveHighlights(
  fileId: string,
  highlights: ReaderHighlight[],
): Promise<void> {
  const map = (await get<HighlightMap>(STORAGE_KEYS.READER_HIGHLIGHTS)) ?? {};
  if (highlights.length === 0) delete map[fileId];
  else map[fileId] = highlights;
  await set(STORAGE_KEYS.READER_HIGHLIGHTS, map);
}

export { DEFAULT_READER_PREFS };
