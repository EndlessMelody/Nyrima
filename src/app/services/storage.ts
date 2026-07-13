/**
 * Thin async wrapper over chrome.storage.local with type safety.
 */

import {
  STORAGE_KEYS,
  MAX_RECENT_FOLDERS,
  WATCHED_THRESHOLD_PCT,
} from "@shared/constants";
import type {
  RecentFolder,
  UserProfile,
  PlaybackPosition,
  AppSettings,
  NyrimaRoot,
} from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/types";
import { isSupabaseConfigured } from "../../lib/supabase";
import { getActiveAccount } from "../../platform/storage-adapter";
import { getRepository } from "../../server/db/repository";
import type { UserSettings } from "../../server/db/schema";
import { markProfileStatsDirty } from "./social/dirty-signal";

type LegacyAppSettings = Partial<AppSettings> & {
  subtitleFont?: string;
  preferredSubtitleLanguage?: unknown;
};

const GUEST_ACCOUNT_ID = "guest";

async function get<T>(key: string): Promise<T | undefined> {
  const obj = await chrome.storage.local.get(key);
  return obj[key] as T | undefined;
}

async function set<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// --- Nyrima root -----------------------------------------------------------

export async function getNyrimaRoot(): Promise<NyrimaRoot | undefined> {
  return await get<NyrimaRoot>(STORAGE_KEYS.NYRIMA_ROOT);
}

export async function setNyrimaRoot(root: NyrimaRoot): Promise<void> {
  await set(STORAGE_KEYS.NYRIMA_ROOT, root);
}

export async function clearNyrimaRoot(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.NYRIMA_ROOT);
}

// --- Recent folders --------------------------------------------------------

export async function getRecentFolders(): Promise<RecentFolder[]> {
  return (await get<RecentFolder[]>(STORAGE_KEYS.RECENT_FOLDERS)) ?? [];
}

export async function upsertRecentFolder(
  folder: RecentFolder,
): Promise<RecentFolder[]> {
  const list = await getRecentFolders();
  const existing = list.find((f) => f.id === folder.id);
  const merged: RecentFolder = existing ? { ...existing, ...folder } : folder;
  const next = [merged, ...list.filter((f) => f.id !== folder.id)].slice(
    0,
    MAX_RECENT_FOLDERS,
  );
  await set(STORAGE_KEYS.RECENT_FOLDERS, next);
  return next;
}

export async function removeRecentFolder(
  folderId: string,
): Promise<RecentFolder[]> {
  const list = await getRecentFolders();
  const next = list.filter((f) => f.id !== folderId);
  await set(STORAGE_KEYS.RECENT_FOLDERS, next);
  return next;
}

export async function togglePinRecentFolder(
  folderId: string,
): Promise<RecentFolder[]> {
  const list = await getRecentFolders();
  const next = list.map((f) =>
    f.id === folderId ? { ...f, pinned: !f.pinned } : f,
  );
  await set(STORAGE_KEYS.RECENT_FOLDERS, next);
  return next;
}

// --- User profile ----------------------------------------------------------

export async function getUserProfile(): Promise<UserProfile | undefined> {
  return await get<UserProfile>(STORAGE_KEYS.USER_PROFILE);
}

export async function setUserProfile(profile: UserProfile): Promise<void> {
  await set(STORAGE_KEYS.USER_PROFILE, profile);
}

export async function clearUserProfile(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.USER_PROFILE);
}

// --- Playback positions ----------------------------------------------------
//
// PlayerPage saves a position every ~4 seconds during playback. The naive
// pattern (full chrome.storage `get` + full `set` per save) marshals the
// entire PlaybackMap as JSON twice per tick; with dozens of positions that
// adds up. We coalesce: keep one in-memory map and flush
// to chrome.storage on a coalesced micro-task. Multiple writes inside the
// same tick collapse to a single `set`. A storage-onChanged listener keeps
// the in-memory copy honest if another tab (or UserCenter "Clear history")
// mutates the underlying entry.

type PlaybackMap = Record<string, PlaybackPosition>;

let memPlaybackMap: PlaybackMap | null = null;
let pendingPlaybackFlush: Promise<void> | null = null;

async function loadPlaybackMap(): Promise<PlaybackMap> {
  if (memPlaybackMap) return memPlaybackMap;
  memPlaybackMap =
    (await get<PlaybackMap>(STORAGE_KEYS.PLAYBACK_STATE)) ?? {};
  return memPlaybackMap;
}

function schedulePlaybackFlush(): Promise<void> {
  if (pendingPlaybackFlush) return pendingPlaybackFlush;
  pendingPlaybackFlush = Promise.resolve().then(async () => {
    pendingPlaybackFlush = null;
    if (!memPlaybackMap) return;
    await set(STORAGE_KEYS.PLAYBACK_STATE, memPlaybackMap);
  });
  return pendingPlaybackFlush;
}

// Drop the in-memory cache when chrome.storage is mutated outside this
// module (other tabs, popup, "Clear watch history"). Next read repopulates
// from disk so we don't ship a fresh write built on top of a stale view.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!(STORAGE_KEYS.PLAYBACK_STATE in changes)) return;
    const next = changes[STORAGE_KEYS.PLAYBACK_STATE].newValue as
      | PlaybackMap
      | undefined;
    memPlaybackMap = next ?? {};
  });
}

export async function getPlaybackPosition(
  fileId: string,
): Promise<PlaybackPosition | undefined> {
  const map = await loadPlaybackMap();
  return map[fileId];
}

export async function savePlaybackPosition(
  pos: PlaybackPosition,
): Promise<void> {
  const map = await loadPlaybackMap();
  const existing = map[pos.fileId];
  map[pos.fileId] = existing
    ? { ...existing, ...pos, updatedAt: Date.now() }
    : pos;
  await schedulePlaybackFlush();
  markProfileStatsDirty();
}

export async function getAllPlaybackPositions(): Promise<PlaybackPosition[]> {
  const map = await loadPlaybackMap();
  return Object.values(map);
}

/** Remove a stored playback position entirely — used by the "Clear progress"
 *  context-menu action on PosterCard. Different from `markUnwatched`: this
 *  drops the entry so the file no longer shows up in Continue Watching at
 *  all, rather than rewriting it to 0 sec (which still counts as in-progress
 *  if positionSeconds > 5). */
export async function clearPlaybackPosition(fileId: string): Promise<void> {
  const map = await loadPlaybackMap();
  if (!(fileId in map)) return;
  delete map[fileId];
  await schedulePlaybackFlush();
}

/** Same as getAllPlaybackPositions() but keyed by fileId for O(1) lookup.
 *  Returns a shallow copy so callers can't mutate the in-memory cache. */
export async function getPlaybackPositionMap(): Promise<PlaybackMap> {
  const map = await loadPlaybackMap();
  return { ...map };
}

/** 0–100 integer; 0 when position/duration is missing or invalid. */
export function playbackProgressPct(
  pos: { positionSeconds: number; durationSeconds: number } | undefined | null,
): number {
  if (!pos || pos.durationSeconds <= 0) return 0;
  return Math.min(
    100,
    Math.round((pos.positionSeconds / pos.durationSeconds) * 100),
  );
}

/** ≥ WATCHED_THRESHOLD_PCT means the user effectively finished it. */
export function isWatched(pos: PlaybackPosition | undefined | null): boolean {
  return playbackProgressPct(pos) >= WATCHED_THRESHOLD_PCT;
}

/** A few seconds in, but not yet finished — eligible for Continue Watching. */
export function isInProgress(
  pos: PlaybackPosition | undefined | null,
): boolean {
  if (!pos) return false;
  return pos.positionSeconds > 5 && !isWatched(pos);
}

// --- Settings --------------------------------------------------------------

export async function getSettings(): Promise<AppSettings> {
  const userId = getRepositorySettingsUserId();
  if (userId) {
    const stored = await getRepository().settings.getSettings(userId);
    if (stored) return settingsFromRepositoryRecord(stored);
  }

  const stored = await get<LegacyAppSettings>(STORAGE_KEYS.SETTINGS);
  const migrated = stored ? migrateSettings(stored) : {};
  return { ...DEFAULT_SETTINGS, ...migrated };
}

/** Fold legacy font-preset keys into the current ones so users hydrated
 *  with an older settings shape don't get reset to defaults. Two waves:
 *    - 2026-05-15: `comic`/`geist` (the original two-preset picker)
 *    - 2026-05-19: `anime-brush`/`comic-dialogue`/`clean-sans` renamed to
 *      `chinacat-teddybear`/`cascadia`/`asap` so each key matches the
 *      bundled face it ships with.
 *  Also folds the legacy `subtitlePosition: 0.08` default into the current
 *  default of 0 — the SCSS bottom offset tightened up, so 0.08 on top of
 *  the new tighter base lifts cues into the middle of the frame. */
function migrateSettings(s: LegacyAppSettings): Partial<AppSettings> {
  const next: LegacyAppSettings = { ...s };
  delete next.preferredSubtitleLanguage;
  const legacy = next.subtitleFont as string | undefined;
  if (legacy === "comic" || legacy === "anime-brush") {
    next.subtitleFont = "chinacat-teddybear";
  } else if (legacy === "comic-dialogue") {
    next.subtitleFont = "cascadia";
  } else if (legacy === "geist" || legacy === "clean-sans") {
    next.subtitleFont = "asap";
  }
  if (next.subtitlePosition === 0.08) next.subtitlePosition = 0;
  if (
    typeof next.defaultVolume === "number" &&
    Number.isFinite(next.defaultVolume)
  ) {
    next.defaultVolume = Math.max(0, Math.min(1, next.defaultVolume));
  } else {
    delete next.defaultVolume;
  }
  return next as Partial<AppSettings>;
}

export async function saveSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  const userId = getRepositorySettingsUserId();
  if (userId) {
    await getRepository().settings.saveSettings(
      settingsToRepositoryRecord(userId, next),
    );
    return next;
  }
  await set(STORAGE_KEYS.SETTINGS, next);
  return next;
}

function getRepositorySettingsUserId(): string | null {
  if (!isSupabaseConfigured()) return null;
  const active = getActiveAccount();
  return active && active !== GUEST_ACCOUNT_ID ? active : null;
}

function settingsFromRepositoryRecord(record: UserSettings): AppSettings {
  const migrated = migrateSettings(record.appSettings ?? {});
  return {
    ...DEFAULT_SETTINGS,
    ...migrated,
    theme: record.theme,
    autoplayNext: record.autoplayNext,
    defaultVolume: clampVolume(record.defaultVolume),
    skipSeconds: toSkipSeconds(record.skipSeconds),
  };
}

function settingsToRepositoryRecord(
  userId: string,
  settings: AppSettings,
): UserSettings {
  return {
    userId,
    theme: settings.theme,
    autoplayNext: settings.autoplayNext,
    defaultVolume: clampVolume(settings.defaultVolume),
    skipSeconds: settings.skipSeconds,
    appSettings: settings,
    updatedAt: Date.now(),
  };
}

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function toSkipSeconds(value: number): AppSettings["skipSeconds"] {
  return value === 5 || value === 10 || value === 15 || value === 30
    ? value
    : DEFAULT_SETTINGS.skipSeconds;
}

// --- Per-library view state ------------------------------------------------
//
// Remembers UI state inside a library page (search query + which group
// headers the user collapsed) keyed by folderId, so navigating away and
// back doesn't reset filters. Kept separate from AppSettings because
// folder-scoped state can grow unbounded and shouldn't bloat the global
// settings blob; pruned to a soft cap so a power-user with 200 libraries
// doesn't fill storage with stale entries.

export interface LibraryViewState {
  /** Last search query typed inside this library. Empty string = cleared. */
  query?: string;
  /** Group ids the user expanded *closed* in the grouped view. */
  collapsedGroups?: string[];
  /** Bumped each time chrome.storage writes — used as a soft LRU signal so
   *  the prune step can evict the oldest entries when the map gets huge. */
  updatedAt?: number;
}

type LibraryViewStateMap = Record<string, LibraryViewState>;

const LIBRARY_VIEW_STATE_CAP = 100;

export async function getLibraryViewState(
  folderId: string,
): Promise<LibraryViewState | undefined> {
  const map =
    (await get<LibraryViewStateMap>(STORAGE_KEYS.LIBRARY_VIEW_STATE)) ?? {};
  return map[folderId];
}

export async function patchLibraryViewState(
  folderId: string,
  patch: LibraryViewState,
): Promise<void> {
  const map =
    (await get<LibraryViewStateMap>(STORAGE_KEYS.LIBRARY_VIEW_STATE)) ?? {};
  const existing = map[folderId] ?? {};
  map[folderId] = { ...existing, ...patch, updatedAt: Date.now() };

  // Soft prune. When the map exceeds the cap, drop the oldest entries by
  // `updatedAt`. The current folder is always retained because we just
  // touched its `updatedAt` above.
  const entries = Object.entries(map);
  if (entries.length > LIBRARY_VIEW_STATE_CAP) {
    entries.sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
    const kept = Object.fromEntries(entries.slice(0, LIBRARY_VIEW_STATE_CAP));
    await set(STORAGE_KEYS.LIBRARY_VIEW_STATE, kept);
    return;
  }
  await set(STORAGE_KEYS.LIBRARY_VIEW_STATE, map);
}
