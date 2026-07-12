/**
 * Local (browser) implementation of the Repository boundary.
 *
 * Persists each entity collection in localStorage, partitioned by `userId`, so
 * the full account/data model is usable today without a server. This is the
 * development stand-in; a real backend implements the same `Repository`
 * interface over HTTP/SQL and is swapped in via `getRepository()`.
 *
 * Keys: `nyrima:db:v1:<entity>:<userId>` → JSON array (or object for settings).
 */

import type {
  AccountData,
  CacheRecord,
  DriveConnection,
  Favorite,
  Id,
  LibraryItem,
  PlayerPreferences,
  User,
  UserSettings,
  WatchHistoryEntry,
  Friendship,
  Follow,
  SharedLibrary,
  SharedPlaylist,
  Invitation,
  AccessPermission,
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

const NS = "nyrima:db:v1";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — non-fatal for the dev store */
  }
}

function remove(key: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/** A user-partitioned collection of records keyed by `id`. */
function collectionKey(entity: string, userId: Id): string {
  return `${NS}:${entity}:${userId}`;
}

function listCollection<T>(entity: string, userId: Id): T[] {
  return read<T[]>(collectionKey(entity, userId), []);
}

function upsertCollection<T extends { id: Id }>(
  entity: string,
  userId: Id,
  record: T,
): T {
  const key = collectionKey(entity, userId);
  const items = read<T[]>(key, []);
  const idx = items.findIndex((r) => r.id === record.id);
  if (idx >= 0) items[idx] = record;
  else items.push(record);
  write(key, items);
  return record;
}

function removeFromCollection(entity: string, userId: Id, id: Id): void {
  const key = collectionKey(entity, userId);
  const items = read<{ id: Id }[]>(key, []);
  write(
    key,
    items.filter((r) => r.id !== id),
  );
}

function singletonKey(entity: string, userId: Id): string {
  return `${NS}:${entity}:${userId}`;
}

export function createLocalRepository(): Repository {
  const users: UserRepository = {
    async get(userId) {
      return read<User | null>(singletonKey("user", userId), null);
    },
    async upsert(user) {
      write(singletonKey("user", user.id), user);
      return user;
    },
    async exportAll(userId): Promise<AccountData | null> {
      const user = read<User | null>(singletonKey("user", userId), null);
      if (!user) return null;
      return {
        user,
        settings: read<UserSettings | undefined>(singletonKey("settings", userId), undefined),
        playerPreferences: read<PlayerPreferences | undefined>(
          singletonKey("player-prefs", userId),
          undefined,
        ),
        driveConnections: listCollection<DriveConnection>("drive", userId),
        libraries: listCollection<LibraryItem>("library", userId),
        watchHistory: listCollection<WatchHistoryEntry>("watch", userId),
        favorites: listCollection<Favorite>("favorite", userId),
      };
    },
    async deleteAll(userId) {
      for (const entity of [
        "user",
        "settings",
        "player-prefs",
        "drive",
        "library",
        "watch",
        "favorite",
        "cache",
      ]) {
        remove(`${NS}:${entity}:${userId}`);
      }
    },
  };

  const settings: SettingsRepository = {
    async getSettings(userId) {
      return read<UserSettings | null>(singletonKey("settings", userId), null);
    },
    async saveSettings(s) {
      write(singletonKey("settings", s.userId), s);
      return s;
    },
    async getPlayerPreferences(userId) {
      return read<PlayerPreferences | null>(singletonKey("player-prefs", userId), null);
    },
    async savePlayerPreferences(p) {
      write(singletonKey("player-prefs", p.userId), p);
      return p;
    },
  };

  const drive: DriveRepository = {
    async list(userId) {
      return listCollection<DriveConnection>("drive", userId);
    },
    async upsert(conn) {
      return upsertCollection("drive", conn.userId, conn);
    },
    async remove(userId, connectionId) {
      removeFromCollection("drive", userId, connectionId);
    },
  };

  const libraries: LibraryRepository = {
    async list(userId) {
      return listCollection<LibraryItem>("library", userId);
    },
    async upsert(item) {
      return upsertCollection("library", item.userId, item);
    },
    async remove(userId, libraryId) {
      removeFromCollection("library", userId, libraryId);
    },
  };

  const watchHistory: WatchHistoryRepository = {
    async list(userId) {
      return listCollection<WatchHistoryEntry>("watch", userId);
    },
    async upsert(entry) {
      return upsertCollection("watch", entry.userId, entry);
    },
    async remove(userId, entryId) {
      removeFromCollection("watch", userId, entryId);
    },
    async clear(userId) {
      remove(collectionKey("watch", userId));
    },
  };

  const favorites: FavoriteRepository = {
    async list(userId) {
      return listCollection<Favorite>("favorite", userId);
    },
    async add(fav) {
      return upsertCollection("favorite", fav.userId, fav);
    },
    async remove(userId, favoriteId) {
      removeFromCollection("favorite", userId, favoriteId);
    },
  };

  const cache: CacheRepository = {
    async get(userId, key) {
      const items = listCollection<CacheRecord>("cache", userId);
      return items.find((r) => r.key === key) ?? null;
    },
    async put(record) {
      // Cache records are keyed by their logical `key`; upsert by that.
      const collKey = collectionKey("cache", record.userId);
      const items = read<CacheRecord[]>(collKey, []);
      const idx = items.findIndex((r) => r.key === record.key);
      if (idx >= 0) items[idx] = record;
      else items.push(record);
      write(collKey, items);
      return record;
    },
    async remove(userId, key) {
      const collKey = collectionKey("cache", userId);
      const items = read<CacheRecord[]>(collKey, []);
      write(
        collKey,
        items.filter((r) => r.key !== key),
      );
    },
    async prune(userId, now = Date.now()) {
      const collKey = collectionKey("cache", userId);
      const items = read<CacheRecord[]>(collKey, []);
      const kept = items.filter((r) => !r.expiresAt || r.expiresAt > now);
      write(collKey, kept);
      return items.length - kept.length;
    },
    async clear(userId) {
      remove(collectionKey("cache", userId));
    },
  };

  // Social relationships are currently sourced from the Drive-backed sharing
  // layer (src/app/services/sharing). This repository surfaces empty arrays as
  // a placeholder boundary; a real social backend implements it for real.
  const social: SocialRepository = {
    async friendships(userId) {
      return listCollection<Friendship>("friendship", userId);
    },
    async follows(userId) {
      return listCollection<Follow>("follow", userId);
    },
    async sharedLibraries(userId) {
      return listCollection<SharedLibrary>("shared-library", userId);
    },
    async sharedPlaylists(userId) {
      return listCollection<SharedPlaylist>("shared-playlist", userId);
    },
    async invitations(userId) {
      return listCollection<Invitation>("invitation", userId);
    },
    async permissions(userId) {
      return listCollection<AccessPermission>("permission", userId);
    },
  };

  return { users, settings, drive, libraries, watchHistory, favorites, cache, social };
}
