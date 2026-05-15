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
} from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/types";

async function get<T>(key: string): Promise<T | undefined> {
  const obj = await chrome.storage.local.get(key);
  return obj[key] as T | undefined;
}

async function set<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
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

type PlaybackMap = Record<string, PlaybackPosition>;

export async function getPlaybackPosition(
  fileId: string,
): Promise<PlaybackPosition | undefined> {
  const map = (await get<PlaybackMap>(STORAGE_KEYS.PLAYBACK_STATE)) ?? {};
  return map[fileId];
}

export async function savePlaybackPosition(
  pos: PlaybackPosition,
): Promise<void> {
  const map = (await get<PlaybackMap>(STORAGE_KEYS.PLAYBACK_STATE)) ?? {};
  const existing = map[pos.fileId];
  map[pos.fileId] = existing
    ? { ...existing, ...pos, updatedAt: Date.now() }
    : pos;
  await set(STORAGE_KEYS.PLAYBACK_STATE, map);
}

export async function getAllPlaybackPositions(): Promise<PlaybackPosition[]> {
  const map = (await get<PlaybackMap>(STORAGE_KEYS.PLAYBACK_STATE)) ?? {};
  return Object.values(map);
}

/** Same as getAllPlaybackPositions() but keyed by fileId for O(1) lookup. */
export async function getPlaybackPositionMap(): Promise<PlaybackMap> {
  return (await get<PlaybackMap>(STORAGE_KEYS.PLAYBACK_STATE)) ?? {};
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
  const stored = await get<Partial<AppSettings> & { subtitleFont?: string }>(
    STORAGE_KEYS.SETTINGS,
  );
  const migrated = stored ? migrateSettings(stored) : {};
  return { ...DEFAULT_SETTINGS, ...migrated };
}

/** Fold the pre-2026-05-15 font-preset keys (`comic`, `geist`) into the new
 *  picker labels so users who hydrated with the old shape don't get reset to
 *  defaults. */
function migrateSettings(
  s: Partial<AppSettings> & { subtitleFont?: string },
): Partial<AppSettings> {
  const next: Partial<AppSettings> & { subtitleFont?: string } = { ...s };
  const legacy = next.subtitleFont as string | undefined;
  if (legacy === "comic") next.subtitleFont = "anime-brush";
  else if (legacy === "geist") next.subtitleFont = "clean-sans";
  return next as Partial<AppSettings>;
}

export async function saveSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await set(STORAGE_KEYS.SETTINGS, next);
  return next;
}
