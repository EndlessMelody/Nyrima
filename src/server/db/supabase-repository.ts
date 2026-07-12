/**
 * Supabase-backed repository slice.
 *
 * ⚠️ NOT WIRED IN. `getRepository()` is local-only by design: the Supabase
 * database backs the OPT-IN social layer ONLY (friends + comments on shared
 * folders), never per-user cloud sync of settings / history / library / cache.
 * The cloud tables this file targets (`user_settings`, `player_preferences`,
 * `cache_records`, …) were removed from the schema (see
 * `supabase/migrations/20260531160000_social_schema.sql`). This module is kept
 * for reference and its unit test only; do not select it from `getRepository()`
 * without first restoring those tables and the matching product decision.
 */

import type {
  AccessPermission,
  AccountData,
  CacheRecord,
  DriveConnection,
  Favorite,
  Friendship,
  Follow,
  Id,
  Invitation,
  LibraryItem,
  PlayerPreferences,
  SharedLibrary,
  SharedPlaylist,
  User,
  UserSettings,
  WatchHistoryEntry,
} from "./schema";
import type {
  CacheRepository,
  DriveRepository,
  FavoriteRepository,
  LibraryRepository,
  Repository,
  SettingsRepository,
  SocialRepository,
  UserRepository,
  WatchHistoryRepository,
} from "./repository";
import { createLocalRepository } from "./local-repository";

export interface SupabaseRepositoryClient {
  from(tableName: string): any;
}

interface SupabaseResult<T> {
  data: T;
  error: { message?: string } | null;
  count?: number | null;
}

function assertOk<T>(result: SupabaseResult<T>, action: string): T {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message ?? "Supabase request failed"}`);
  }
  return result.data;
}

function epoch(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function iso(value: number | null | undefined): string | null {
  if (value == null) return null;
  return new Date(value).toISOString();
}

function rowString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function toUser(row: Record<string, unknown>): User {
  const now = Date.now();
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    displayName: String(row.display_name ?? ""),
    avatarUrl: rowString(row, "avatar_url"),
    method: row.method === "google" ? "google" : "password",
    createdAt: epoch(row.created_at, now),
    updatedAt: epoch(row.updated_at, now),
  };
}

function fromUser(user: User): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    avatar_url: user.avatarUrl ?? null,
    method: user.method,
    created_at: iso(user.createdAt),
    updated_at: iso(user.updatedAt),
  };
}

function toSettings(row: Record<string, unknown>): UserSettings {
  return {
    userId: String(row.user_id),
    theme: row.theme === "light" || row.theme === "system" ? row.theme : "dark",
    autoplayNext: row.autoplay_next !== false,
    defaultVolume:
      typeof row.default_volume === "number" ? row.default_volume : 1,
    skipSeconds:
      typeof row.skip_seconds === "number" ? row.skip_seconds : 10,
    appSettings:
      row.settings && typeof row.settings === "object"
        ? (row.settings as UserSettings["appSettings"])
        : undefined,
    updatedAt: epoch(row.updated_at),
  };
}

function fromSettings(settings: UserSettings): Record<string, unknown> {
  return {
    user_id: settings.userId,
    theme: settings.theme,
    autoplay_next: settings.autoplayNext,
    default_volume: settings.defaultVolume,
    skip_seconds: settings.skipSeconds,
    settings: settings.appSettings ?? {},
    updated_at: iso(settings.updatedAt),
  };
}

function toPlayerPreferences(row: Record<string, unknown>): PlayerPreferences {
  return {
    userId: String(row.user_id),
    subtitleFont: String(row.subtitle_font ?? "chinacat-teddybear"),
    subtitleScale:
      typeof row.subtitle_scale === "number" ? row.subtitle_scale : 1,
    subtitlePosition:
      typeof row.subtitle_position === "number" ? row.subtitle_position : 0,
    preferredAudioLang: rowString(row, "preferred_audio_lang"),
    preferredSubtitleLang: rowString(row, "preferred_subtitle_lang"),
    updatedAt: epoch(row.updated_at),
  };
}

function fromPlayerPreferences(prefs: PlayerPreferences): Record<string, unknown> {
  return {
    user_id: prefs.userId,
    subtitle_font: prefs.subtitleFont,
    subtitle_scale: prefs.subtitleScale,
    subtitle_position: prefs.subtitlePosition,
    preferred_audio_lang: prefs.preferredAudioLang ?? null,
    preferred_subtitle_lang: prefs.preferredSubtitleLang ?? null,
    updated_at: iso(prefs.updatedAt),
  };
}

function toCacheRecord(row: Record<string, unknown>): CacheRecord {
  const now = Date.now();
  const createdAt = epoch(row.created_at, now);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    key: String(row.cache_key),
    cacheType: rowString(row, "cache_type"),
    source: String(row.source) as CacheRecord["source"],
    sourceId: rowString(row, "source_id"),
    etag: rowString(row, "etag"),
    modifiedTime: rowString(row, "modified_time"),
    cachedAt: epoch(row.cached_at, createdAt),
    expiresAt: row.expires_at == null ? null : epoch(row.expires_at),
    invalidatedAt:
      row.invalidated_at == null ? null : epoch(row.invalidated_at),
    invalidationReason: rowString(row, "invalidation_reason") ?? null,
    redisKey: rowString(row, "redis_key") ?? null,
    sizeBytes:
      typeof row.size_bytes === "number" ? row.size_bytes : undefined,
    createdAt,
    lastAccessedAt: epoch(row.last_accessed_at, createdAt),
  };
}

function fromCacheRecord(record: CacheRecord): Record<string, unknown> {
  const createdAt = record.createdAt || Date.now();
  return {
    id: record.id,
    user_id: record.userId,
    cache_key: record.key,
    cache_type: record.cacheType ?? null,
    source: record.source,
    source_id: record.sourceId ?? null,
    etag: record.etag ?? null,
    modified_time: record.modifiedTime ?? null,
    cached_at: iso(record.cachedAt ?? createdAt),
    expires_at: iso(record.expiresAt),
    invalidated_at: iso(record.invalidatedAt),
    invalidation_reason: record.invalidationReason ?? null,
    redis_key: record.redisKey ?? null,
    size_bytes: record.sizeBytes ?? null,
    created_at: iso(createdAt),
    last_accessed_at: iso(record.lastAccessedAt || createdAt),
  };
}

export function createSupabaseRepository(
  client: SupabaseRepositoryClient,
  fallback: Repository = createLocalRepository(),
): Repository {
  const users: UserRepository = {
    async get(userId: Id): Promise<User | null> {
      const row = assertOk<Record<string, unknown> | null>(
        await client.from("profiles").select("*").eq("id", userId).maybeSingle(),
        "Load profile",
      );
      return row ? toUser(row) : null;
    },

    async upsert(user: User): Promise<User> {
      const row = assertOk<Record<string, unknown>>(
        await client
          .from("profiles")
          .upsert(fromUser(user), { onConflict: "id" })
          .select("*")
          .single(),
        "Save profile",
      );
      return toUser(row);
    },

    async exportAll(userId: Id): Promise<AccountData | null> {
      const user = await users.get(userId);
      if (!user) return null;
      return {
        user,
        settings: (await settings.getSettings(userId)) ?? undefined,
        playerPreferences:
          (await settings.getPlayerPreferences(userId)) ?? undefined,
        driveConnections: await fallback.drive.list(userId),
        libraries: await fallback.libraries.list(userId),
        watchHistory: await fallback.watchHistory.list(userId),
        favorites: await fallback.favorites.list(userId),
      };
    },

    async deleteAll(userId: Id): Promise<void> {
      await client.from("cache_records").delete().eq("user_id", userId);
      await client.from("player_preferences").delete().eq("user_id", userId);
      await client.from("user_settings").delete().eq("user_id", userId);
      await client.from("profiles").delete().eq("id", userId);
      await fallback.users.deleteAll(userId);
    },
  };

  const settings: SettingsRepository = {
    async getSettings(userId: Id): Promise<UserSettings | null> {
      const row = assertOk<Record<string, unknown> | null>(
        await client
          .from("user_settings")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
        "Load settings",
      );
      return row ? toSettings(row) : null;
    },

    async saveSettings(next: UserSettings): Promise<UserSettings> {
      const row = assertOk<Record<string, unknown>>(
        await client
          .from("user_settings")
          .upsert(fromSettings(next), { onConflict: "user_id" })
          .select("*")
          .single(),
        "Save settings",
      );
      return toSettings(row);
    },

    async getPlayerPreferences(userId: Id): Promise<PlayerPreferences | null> {
      const row = assertOk<Record<string, unknown> | null>(
        await client
          .from("player_preferences")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
        "Load player preferences",
      );
      return row ? toPlayerPreferences(row) : null;
    },

    async savePlayerPreferences(
      prefs: PlayerPreferences,
    ): Promise<PlayerPreferences> {
      const row = assertOk<Record<string, unknown>>(
        await client
          .from("player_preferences")
          .upsert(fromPlayerPreferences(prefs), { onConflict: "user_id" })
          .select("*")
          .single(),
        "Save player preferences",
      );
      return toPlayerPreferences(row);
    },
  };

  const cache: CacheRepository = {
    async get(userId: Id, key: string): Promise<CacheRecord | null> {
      const row = assertOk<Record<string, unknown> | null>(
        await client
          .from("cache_records")
          .select("*")
          .eq("user_id", userId)
          .eq("cache_key", key)
          .is("invalidated_at", null)
          .maybeSingle(),
        "Load cache record",
      );
      return row ? toCacheRecord(row) : null;
    },

    async put(record: CacheRecord): Promise<CacheRecord> {
      const row = assertOk<Record<string, unknown>>(
        await client
          .from("cache_records")
          .upsert(fromCacheRecord(record), { onConflict: "user_id,cache_key" })
          .select("*")
          .single(),
        "Save cache record",
      );
      return toCacheRecord(row);
    },

    async remove(userId: Id, key: string): Promise<void> {
      await client
        .from("cache_records")
        .delete()
        .eq("user_id", userId)
        .eq("cache_key", key);
    },

    async prune(userId: Id, now = Date.now()): Promise<number> {
      const result = await client
        .from("cache_records")
        .delete()
        .eq("user_id", userId)
        .lte("expires_at", new Date(now).toISOString());
      return Number(result.count ?? 0);
    },

    async clear(userId: Id): Promise<void> {
      await client.from("cache_records").delete().eq("user_id", userId);
    },
  };

  const drive: DriveRepository = fallback.drive;
  const libraries: LibraryRepository = fallback.libraries;
  const watchHistory: WatchHistoryRepository = fallback.watchHistory;
  const favorites: FavoriteRepository = fallback.favorites;
  const social: SocialRepository = fallback.social;

  return {
    users,
    settings,
    drive,
    libraries,
    watchHistory,
    favorites,
    cache,
    social,
  };
}

export type {
  AccessPermission,
  CacheRecord,
  DriveConnection,
  Favorite,
  Friendship,
  Follow,
  Invitation,
  LibraryItem,
  PlayerPreferences,
  SharedLibrary,
  SharedPlaylist,
  User,
  UserSettings,
  WatchHistoryEntry,
};
