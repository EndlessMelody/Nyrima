/**
 * Repository boundary — the seam between Nyrima's UI/services and its data
 * store. Everything reads/writes through these interfaces, so swapping the
 * local browser implementation for a real backend (HTTP against
 * VITE_API_BASE_URL, or a server with a SQL/Prisma layer) is a single change in
 * `getRepository()` with no call-site edits.
 *
 * Every method is account-scoped via an explicit `userId` argument so callers
 * can't accidentally cross account boundaries.
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
import { createLocalRepository } from "./local-repository";

export interface UserRepository {
  get(userId: Id): Promise<User | null>;
  upsert(user: User): Promise<User>;
  /** Account deletion / GDPR export. */
  exportAll(userId: Id): Promise<AccountData | null>;
  deleteAll(userId: Id): Promise<void>;
}

export interface SettingsRepository {
  getSettings(userId: Id): Promise<UserSettings | null>;
  saveSettings(settings: UserSettings): Promise<UserSettings>;
  getPlayerPreferences(userId: Id): Promise<PlayerPreferences | null>;
  savePlayerPreferences(prefs: PlayerPreferences): Promise<PlayerPreferences>;
}

export interface DriveRepository {
  list(userId: Id): Promise<DriveConnection[]>;
  upsert(conn: DriveConnection): Promise<DriveConnection>;
  remove(userId: Id, connectionId: Id): Promise<void>;
}

export interface LibraryRepository {
  list(userId: Id): Promise<LibraryItem[]>;
  upsert(item: LibraryItem): Promise<LibraryItem>;
  remove(userId: Id, libraryId: Id): Promise<void>;
}

export interface WatchHistoryRepository {
  list(userId: Id): Promise<WatchHistoryEntry[]>;
  upsert(entry: WatchHistoryEntry): Promise<WatchHistoryEntry>;
  remove(userId: Id, entryId: Id): Promise<void>;
  clear(userId: Id): Promise<void>;
}

export interface FavoriteRepository {
  list(userId: Id): Promise<Favorite[]>;
  add(fav: Favorite): Promise<Favorite>;
  remove(userId: Id, favoriteId: Id): Promise<void>;
}

export interface CacheRepository {
  get(userId: Id, key: string): Promise<CacheRecord | null>;
  put(record: CacheRecord): Promise<CacheRecord>;
  remove(userId: Id, key: string): Promise<void>;
  /** Drop expired or otherwise invalid records for an account. */
  prune(userId: Id, now?: number): Promise<number>;
  clear(userId: Id): Promise<void>;
}

/** Relationships between users. Backed by Drive/JSON today (see app/services/
 *  sharing); this interface is where a real social backend will land. */
export interface SocialRepository {
  friendships(userId: Id): Promise<Friendship[]>;
  follows(userId: Id): Promise<Follow[]>;
  sharedLibraries(userId: Id): Promise<SharedLibrary[]>;
  sharedPlaylists(userId: Id): Promise<SharedPlaylist[]>;
  invitations(userId: Id): Promise<Invitation[]>;
  permissions(userId: Id): Promise<AccessPermission[]>;
}

export interface Repository {
  users: UserRepository;
  settings: SettingsRepository;
  drive: DriveRepository;
  libraries: LibraryRepository;
  watchHistory: WatchHistoryRepository;
  favorites: FavoriteRepository;
  cache: CacheRepository;
  social: SocialRepository;
}

let singleton: Repository | null = null;

/**
 * Resolve the active repository implementation.
 *
 * This is intentionally LOCAL-ONLY. Per the product's data boundary, Supabase
 * backs the OPT-IN social layer only (friends + comments on shared folders, via
 * dedicated client calls + RLS — see `supabase/migrations`). General app data —
 * settings, player preferences, watch history, libraries, favorites, and cache
 * metadata — stays on the device for ALL users (and for guests there is no
 * account at all). So nothing here cloud-syncs.
 *
 * `createSupabaseRepository` (in `./supabase-repository`) is retained for
 * reference/tests but is deliberately NOT selected here; wiring it back would
 * reintroduce per-user cloud sync, which this model explicitly avoids.
 */
export function getRepository(): Repository {
  if (singleton) return singleton;
  singleton = createLocalRepository();
  return singleton;
}
