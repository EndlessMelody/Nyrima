/**
 * Account-aware cache boundary.
 *
 * The architectural seam for Nyrima's future cache system. UI components must
 * NOT bake cache behaviour inline — they go through this boundary so the
 * backing store (today: the local repository; tomorrow: an account-aware cache
 * backend) can change without touching call sites.
 *
 * Every record is tied to a `userId`, a logical `key`, a `source`, timestamps,
 * and invalidation metadata (etag / expiry) — matching `CacheRecord` in
 * schema.ts.
 *
 * NOTE: the heavy runtime cache that actually stores Drive listings, file
 * metadata, subtitles, and media segments lives in
 * `src/app/services/drive/idb.ts` (IndexedDB). This module is the *metadata*
 * boundary that a future backend will own; it intentionally does not duplicate
 * the IDB byte cache.
 */

import type { CacheRecord, CacheSource, Id } from "./schema";
import { getRepository } from "./repository";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `cache_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export interface PutCacheInput {
  userId: Id;
  key: string;
  cacheType?: string;
  source: CacheSource;
  sourceId?: Id;
  etag?: string;
  modifiedTime?: string;
  sizeBytes?: number;
  /** TTL in ms from now. Omit for no expiry (invalidate by etag only). */
  ttlMs?: number;
  redisKey?: string | null;
}

export interface CacheBackend {
  get(userId: Id, key: string): Promise<CacheRecord | null>;
  put(record: CacheRecord): Promise<CacheRecord>;
  remove(userId: Id, key: string): Promise<void>;
  prune(userId: Id, now?: number): Promise<number>;
  clear(userId: Id): Promise<void>;
}

export function getRepositoryCacheBackend(): CacheBackend {
  return getRepository().cache;
}

export const cacheService = {
  /** Return a live (non-expired) record, or null. Touches `lastAccessedAt`. */
  async get(userId: Id, key: string): Promise<CacheRecord | null> {
    const repo = getRepositoryCacheBackend();
    const record = await repo.get(userId, key);
    if (!record) return null;
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      await repo.remove(userId, key);
      return null;
    }
    record.lastAccessedAt = Date.now();
    await repo.put(record);
    return record;
  },

  /** Insert or refresh a cache record. */
  async put(input: PutCacheInput): Promise<CacheRecord> {
    const repo = getRepositoryCacheBackend();
    const now = Date.now();
    const existing = await repo.get(input.userId, input.key);
    const record: CacheRecord = {
      id: existing?.id ?? newId(),
      userId: input.userId,
      key: input.key,
      cacheType: input.cacheType,
      source: input.source,
      sourceId: input.sourceId,
      etag: input.etag,
      modifiedTime: input.modifiedTime,
      cachedAt: now,
      sizeBytes: input.sizeBytes,
      createdAt: existing?.createdAt ?? now,
      lastAccessedAt: now,
      expiresAt: input.ttlMs != null ? now + input.ttlMs : null,
      invalidatedAt: null,
      invalidationReason: null,
      redisKey: input.redisKey ?? null,
    };
    return repo.put(record);
  },

  /** Invalidate one key, or — if the upstream etag changed — refresh metadata. */
  async invalidate(userId: Id, key: string): Promise<void> {
    await getRepositoryCacheBackend().remove(userId, key);
  },

  /** Returns true when the cached etag still matches upstream. */
  async isFresh(userId: Id, key: string, upstreamEtag: string): Promise<boolean> {
    const record = await this.get(userId, key);
    return !!record && record.etag === upstreamEtag;
  },

  /** Drop expired records for an account. Returns how many were removed. */
  async prune(userId: Id): Promise<number> {
    return getRepositoryCacheBackend().prune(userId);
  },

  async clear(userId: Id): Promise<void> {
    await getRepositoryCacheBackend().clear(userId);
  },
};
