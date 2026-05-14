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
 */

import { STORAGE_KEYS } from "@shared/constants";
import type { MovieMetadata } from "@shared/types";

const OK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CacheMap = Record<string, MovieMetadata>;

let memCache: CacheMap | null = null;
let pendingFlush: Promise<void> | null = null;

async function loadCache(): Promise<CacheMap> {
  if (memCache) return memCache;
  const obj = await chrome.storage.local.get(STORAGE_KEYS.METADATA_CACHE);
  memCache = (obj[STORAGE_KEYS.METADATA_CACHE] as CacheMap) ?? {};
  return memCache;
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
