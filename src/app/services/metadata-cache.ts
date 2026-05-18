/**
 * Thin wrapper over chrome.storage.local for movie metadata caching.
 *
 * TTL:
 *   - "ok"  → 30 days
 *   - "miss" → 7 days (so a renamed file gets retried)
 *
 * Concurrency:
 *   resolvePoster fans out up to 4 concurrent fetches. The earlier "read
 *   full cache map, mutate, write full map" pattern lost writes when several
 *   completed close together (each loaded the same pre-write snapshot, then
 *   overwrote it). Writes now go through a single in-memory map fronted by a
 *   coalesced micro-task flush, so concurrent updates merge instead of racing.
 *
 * Migrations:
 *   On first load we run a series-entry sanity pass to evict legacy bad
 *   matches written before the resolver tightened its fallback (the
 *   "Gimai Seikatsu → Doraemon" class of mistakes). The marker key prevents
 *   the migration from re-running across sessions. See
 *   `migrateSeriesValidation`.
 */

import { STORAGE_KEYS } from "@shared/constants";
import type { MovieMetadata, RecentFolder } from "@shared/types";

const OK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SERIES_PREFIX = "series:";
/** chrome.storage marker — set after the series-validation migration runs
 *  once. Bump the suffix to force the migration to replay across all
 *  installs (e.g. if the validation rule changes).
 *
 *  v2 adds RecentFolder.coverPosterUrl scrubbing — v1 only purged the
 *  metadata cache row, but the library card reads the poster URL from
 *  the RecentFolder record, so v1 alone left stale posters visible. */
const SERIES_VALIDATION_MIGRATION_KEY =
  "dc.metadataCache.v3.seriesValidation.v2";

type CacheMap = Record<string, MovieMetadata>;

let memCache: CacheMap | null = null;
let pendingFlush: Promise<void> | null = null;

async function loadCache(): Promise<CacheMap> {
  if (memCache) return memCache;
  const obj = await chrome.storage.local.get(STORAGE_KEYS.METADATA_CACHE);
  memCache = (obj[STORAGE_KEYS.METADATA_CACHE] as CacheMap) ?? {};
  // One-shot sanity pass over series entries. Cheap (just string ops), and
  // gated by a chrome.storage marker so it only runs once per install.
  await migrateSeriesValidation(memCache);
  return memCache;
}

/**
 * Drop series cache entries whose stored MAL title shares zero tokens with
 * the folder name they're keyed by. This catches the legacy fallback path
 * where the resolver took Jikan's relevance-pick (`results[0]`) when the
 * similarity gate failed — that path now returns a miss, but cached rows
 * written by prior versions still mislead the UI.
 *
 * Token comparison is intentionally loose: any one shared meaningful token
 * keeps the entry. Folders named with English vs. romanized Japanese (e.g.
 * "Attack on Titan" vs. cached title "Shingeki no Kyojin") would technically
 * fail this — but that case can't actually be cached because Jikan also
 * indexed those titles in English, so the original resolve would have used
 * the matching variant. In practice the rule only fires on truly wrong
 * matches.
 */
async function migrateSeriesValidation(map: CacheMap): Promise<void> {
  let alreadyRan = false;
  try {
    const obj = await chrome.storage.local.get(
      SERIES_VALIDATION_MIGRATION_KEY,
    );
    alreadyRan = obj[SERIES_VALIDATION_MIGRATION_KEY] === true;
  } catch {
    // If chrome.storage is unavailable (tests, SSR), skip the migration.
    return;
  }
  if (alreadyRan) return;
  let removed = 0;
  /** Lower-cased folder names whose cache rows we evicted — used below to
   *  also scrub their `coverPosterUrl` off the RecentFolder records, since
   *  the lobby renders posters from there, not from this cache. */
  const evictedFolderNames = new Set<string>();
  for (const [key, entry] of Object.entries(map)) {
    if (!key.startsWith(SERIES_PREFIX)) continue;
    if (entry.status !== "ok") continue;
    const folderName = key.slice(SERIES_PREFIX.length);
    if (!titlesShareToken(folderName, entry.title)) {
      // Delete rather than demote: on next visit the resolver will issue a
      // fresh fetch and either find the right show or write a clean miss.
      delete map[key];
      evictedFolderNames.add(folderName.toLowerCase());
      removed++;
    }
  }
  // Persist regardless (the marker write is what prevents replay).
  await chrome.storage.local.set({
    [SERIES_VALIDATION_MIGRATION_KEY]: true,
  });
  if (removed > 0) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.METADATA_CACHE]: map,
    });
    await scrubBadRecentPosters(evictedFolderNames);
  }
}

/**
 * Strip `coverPosterUrl` off every RecentFolder whose name matches an
 * evicted series cache key. Without this, the library card keeps rendering
 * the stale URL — the cache eviction alone only addresses the resolver's
 * future calls, not the data the card actually reads from.
 *
 * Matching is case-insensitive on the trimmed folder name, mirroring how
 * `seriesCacheKey` normalises before hashing into the cache.
 */
async function scrubBadRecentPosters(
  evictedFolderNames: Set<string>,
): Promise<void> {
  if (evictedFolderNames.size === 0) return;
  try {
    const obj = await chrome.storage.local.get(STORAGE_KEYS.RECENT_FOLDERS);
    const list = (obj[STORAGE_KEYS.RECENT_FOLDERS] as RecentFolder[]) ?? [];
    if (list.length === 0) return;
    let dirty = false;
    const next = list.map((f) => {
      const key = f.name.trim().toLowerCase().replace(/\s+/g, " ");
      if (!evictedFolderNames.has(key)) return f;
      if (f.coverPosterUrl == null) return f;
      dirty = true;
      // Strip coverPosterUrl only — leave videoCount / runtimeMs /
      // watchedCount alone so the library card keeps its stats line while
      // the card flips to the initials fallback for the artwork itself.
      const { coverPosterUrl: _drop, ...rest } = f;
      return rest as RecentFolder;
    });
    if (dirty) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.RECENT_FOLDERS]: next,
      });
    }
  } catch {
    // chrome.storage unavailable (tests, SSR). The metadata cache row is
    // already gone, so the next enrichment will recompute on a fresh
    // browser session.
  }
}

function titlesShareToken(folderName: string, cachedTitle: string): boolean {
  const tokens = (s: string): Set<string> => {
    const out = new Set<string>();
    for (const t of s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)) {
      // Skip short connective tokens that match by accident (e.g. "no",
      // "to", "ni" in romanized Japanese). They appear in many titles
      // and would falsely keep a mismatched entry alive.
      if (t.length >= 3) out.add(t);
    }
    return out;
  };
  const a = tokens(folderName);
  const b = tokens(cachedTitle);
  for (const t of a) if (b.has(t)) return true;
  return false;
}

function schedulePersist(): Promise<void> {
  if (pendingFlush) return pendingFlush;
  pendingFlush = Promise.resolve().then(async () => {
    pendingFlush = null;
    if (!memCache) return;
    await chrome.storage.local.set({
      [STORAGE_KEYS.METADATA_CACHE]: memCache,
    });
  });
  return pendingFlush;
}

function isFresh(entry: MovieMetadata): boolean {
  const ttl = entry.status === "ok" ? OK_TTL_MS : MISS_TTL_MS;
  return Date.now() - entry.fetchedAt <= ttl;
}

export async function getCached(
  fileId: string,
): Promise<MovieMetadata | undefined> {
  const map = await loadCache();
  const entry = map[fileId];
  if (!entry) return undefined;
  return isFresh(entry) ? entry : undefined;
}

export async function setCached(meta: MovieMetadata): Promise<void> {
  const map = await loadCache();
  map[meta.fileId] = meta;
  await schedulePersist();
}

export async function getManyCached(
  fileIds: string[],
): Promise<Record<string, MovieMetadata>> {
  const map = await loadCache();
  const out: Record<string, MovieMetadata> = {};
  for (const id of fileIds) {
    const entry = map[id];
    if (entry && isFresh(entry)) out[id] = entry;
  }
  return out;
}

export async function pruneExpired(): Promise<void> {
  const map = await loadCache();
  let changed = false;
  for (const [id, entry] of Object.entries(map)) {
    if (!isFresh(entry)) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) await schedulePersist();
}
