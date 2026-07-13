/**
 * Pure computation of the profile dashboard's local aggregates + heatmap
 * buckets + streaks — derived entirely from already-loaded local state
 * (`RecentFolder[]` + stored `PlaybackPosition`s), same inputs
 * `LibraryHealthCard` already uses for its "Libraries/Tracked/Watched"
 * numbers, so the lobby card and the dashboard never disagree on what
 * counts as "watched".
 *
 * These are the only numbers that ever get pushed to `profile_stats` /
 * `activity_days` — never raw per-file watch records (see the profile
 * dashboard migration header for why).
 */

import type { PlaybackPosition, RecentFolder } from "@shared/types";
import { isWatched } from "../storage";

export interface LocalAggregates {
  minutesWatched: number;
  completedCount: number;
  librariesOwned: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastActiveDay: string | null;
}

export interface ActivityDayBucket {
  day: string;
  units: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bucket every position's `updatedAt` by local calendar day, counting
 *  distinct files touched that day — a commit-count proxy, not real
 *  watch-minutes (there's no append-only watch-event log to derive that
 *  from today). */
export function computeActivityDayBuckets(
  positions: PlaybackPosition[],
  windowDays = 365,
): ActivityDayBucket[] {
  const cutoff = Date.now() - windowDays * DAY_MS;
  const byDay = new Map<string, Set<string>>();
  for (const p of positions) {
    if (!p.updatedAt || p.updatedAt < cutoff) continue;
    const day = toLocalDayKey(p.updatedAt);
    const set = byDay.get(day) ?? new Set<string>();
    set.add(p.fileId);
    byDay.set(day, set);
  }
  return [...byDay.entries()]
    .map(([day, files]) => ({ day, units: files.size }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

export function computeLocalAggregates(
  folders: RecentFolder[],
  positions: Record<string, PlaybackPosition>,
): LocalAggregates {
  const allPositions = Object.values(positions);
  const minutesWatched = Math.round(
    allPositions.reduce((sum, p) => sum + Math.max(0, p.positionSeconds), 0) / 60,
  );
  const completedCount = allPositions.filter(isWatched).length;
  const librariesOwned = folders.length;
  const buckets = computeActivityDayBuckets(allPositions);
  const { currentStreakDays, longestStreakDays, lastActiveDay } = computeStreaks(buckets);
  return {
    minutesWatched,
    completedCount,
    librariesOwned,
    currentStreakDays,
    longestStreakDays,
    lastActiveDay,
  };
}

function computeStreaks(buckets: ActivityDayBucket[]): {
  currentStreakDays: number;
  longestStreakDays: number;
  lastActiveDay: string | null;
} {
  const activeDays = new Set(buckets.filter((b) => b.units > 0).map((b) => b.day));
  if (activeDays.size === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0, lastActiveDay: null };
  }

  const sorted = [...activeDays].sort();
  const lastActiveDay = sorted[sorted.length - 1];

  let longestStreakDays = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = daysBetween(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1;
    longestStreakDays = Math.max(longestStreakDays, run);
  }

  const todayKey = toLocalDayKey(Date.now());
  let currentStreakDays = 0;
  let cursor = activeDays.has(todayKey) ? todayKey : addDays(todayKey, -1);
  while (activeDays.has(cursor)) {
    currentStreakDays += 1;
    cursor = addDays(cursor, -1);
  }

  return { currentStreakDays, longestStreakDays, lastActiveDay };
}

function toLocalDayKey(epoch: number): string {
  const d = new Date(epoch);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toLocalDayKey(d.getTime());
}
