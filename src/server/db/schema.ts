import type { AppSettings } from "@shared/types";

/**
 * Nyrima data model — entity & relationship schema.
 *
 * This is the serious, account-centric model the web product is built around.
 * It is intentionally declared as TypeScript interfaces (not a live DB) so the
 * UI and services can program against stable shapes today, while a real backend
 * (Postgres/Prisma/Supabase/edge KV) is introduced later behind the
 * `Repository` boundary (see repository.ts) with no shape churn.
 *
 * Conventions
 * -----------
 *  - Every owned record carries a `userId` foreign key → per-account isolation.
 *  - Ids are opaque strings (uuid in the real DB).
 *  - Timestamps are epoch milliseconds.
 *  - "Drive" data is modelled as a *connection* owned by a user, never global —
 *    a user's Drive data belongs only to that user.
 *
 * See README.md for the migration path to a real database.
 */

export type Id = string;
export type EpochMs = number;
export type AuthMethod = "password" | "google";

// ---------------------------------------------------------------------------
// Core account
// ---------------------------------------------------------------------------

export interface User {
  id: Id;
  email: string;
  displayName: string;
  avatarUrl?: string;
  method: AuthMethod;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** Per-user application settings (mirrors the runtime AppSettings, persisted
 *  per account rather than per device). */
export interface UserSettings {
  userId: Id;
  theme: "light" | "dark" | "system";
  autoplayNext: boolean;
  defaultVolume: number; // 0..1
  skipSeconds: number;
  /** Full app settings payload while the first Supabase slice migrates UI
   *  preferences before every setting has a dedicated column. */
  appSettings?: Partial<AppSettings>;
  updatedAt: EpochMs;
}

/** Player-specific preferences kept separate from general settings so the
 *  player can evolve its own knobs (subtitle font/scale/position, preferred
 *  audio/subtitle language, remembered playback engine) without bloating
 *  UserSettings. */
export interface PlayerPreferences {
  userId: Id;
  subtitleFont: string;
  subtitleScale: number;
  subtitlePosition: number;
  preferredAudioLang?: string;
  preferredSubtitleLang?: string;
  updatedAt: EpochMs;
}

// ---------------------------------------------------------------------------
// Drive connection — a user's link to a Google Drive (and the paired root)
// ---------------------------------------------------------------------------

export interface DriveConnection {
  id: Id;
  userId: Id;
  provider: "google-drive";
  /** Google account email this connection authenticates as, when known. */
  driveEmail?: string;
  /** OAuth Client ID used (BYOK) — never store secrets here in the real DB. */
  oauthClientId?: string;
  /** The verified Nyrima root folder id whose children become libraries. */
  rootFolderId?: Id;
  rootFolderName?: string;
  /** When the user last completed an interactive consent (session ceiling). */
  lastInteractiveAt?: EpochMs;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

// ---------------------------------------------------------------------------
// Library + playback domain (per user)
// ---------------------------------------------------------------------------

/** A library = a Drive folder surfaced as a shelf. Metadata is denormalized
 *  here so the lobby can render without re-listing Drive on every visit. */
export interface LibraryItem {
  id: Id;
  userId: Id;
  driveFolderId: Id;
  name: string;
  coverPosterUrl?: string;
  coverFileId?: Id;
  videoCount?: number;
  runtimeMs?: number;
  pinned?: boolean;
  lastOpenedAt?: EpochMs;
  newestModifiedAt?: EpochMs;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface WatchHistoryEntry {
  id: Id;
  userId: Id;
  driveFileId: Id;
  driveFolderId?: Id;
  title?: string;
  positionSeconds: number;
  durationSeconds: number;
  /** Derived watched flag (>= threshold). Persisted for cheap querying. */
  completed: boolean;
  updatedAt: EpochMs;
}

export interface Favorite {
  id: Id;
  userId: Id;
  /** A favorite can target a file or a whole library/folder. */
  targetType: "file" | "folder";
  targetId: Id;
  note?: string;
  createdAt: EpochMs;
}

// ---------------------------------------------------------------------------
// Cache metadata (account-aware) — see cache.ts for the runtime boundary
// ---------------------------------------------------------------------------

export type CacheSource =
  | "drive-listing"
  | "drive-file"
  | "subtitle"
  | "thumbnail"
  | "poster"
  | "oauth-state"
  | "rate-limit"
  | "api-response";

export interface CacheRecord {
  id: Id;
  userId: Id;
  /** Logical cache key (e.g. the drive file/folder id or a derived key). */
  key: string;
  /** More specific cache bucket, e.g. drive-folder-metadata or oauth-pkce. */
  cacheType?: string;
  source: CacheSource;
  /** Upstream entity id when different from the logical cache key. */
  sourceId?: Id;
  /** Opaque ETag/version used to invalidate against the upstream source. */
  etag?: string;
  /** Upstream modified timestamp, usually an ISO string from Drive. */
  modifiedTime?: string;
  /** When this metadata row was refreshed. */
  cachedAt?: EpochMs;
  sizeBytes?: number;
  createdAt: EpochMs;
  lastAccessedAt: EpochMs;
  /** Absolute expiry; null/undefined = no TTL (invalidate via etag only). */
  expiresAt?: EpochMs | null;
  invalidatedAt?: EpochMs | null;
  invalidationReason?: string | null;
  /** Pointer to the volatile Redis value, if future server code writes one. */
  redisKey?: string | null;
}

// ---------------------------------------------------------------------------
// Social graph + sharing (relationships between users)
// ---------------------------------------------------------------------------

export type RelationshipStatus = "pending" | "accepted" | "blocked";

export interface Friendship {
  id: Id;
  userId: Id; // requester
  friendUserId: Id; // recipient
  status: RelationshipStatus;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface Follow {
  id: Id;
  followerUserId: Id;
  followeeUserId: Id;
  createdAt: EpochMs;
}

export type AccessRole = "viewer" | "commenter" | "editor" | "owner";

/** A library one user shares with others (or publicly by link). */
export interface SharedLibrary {
  id: Id;
  ownerUserId: Id;
  libraryId: Id;
  visibility: "private" | "link" | "public";
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface SharedPlaylist {
  id: Id;
  ownerUserId: Id;
  title: string;
  /** Ordered list of drive file ids (or LibraryItem references). */
  itemRefs: Id[];
  visibility: "private" | "link" | "public";
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface Invitation {
  id: Id;
  fromUserId: Id;
  /** Either an existing user or an email for someone not yet on Nyrima. */
  toUserId?: Id;
  toEmail?: string;
  /** What the invite grants access to. */
  resourceType: "library" | "playlist";
  resourceId: Id;
  role: AccessRole;
  status: RelationshipStatus;
  createdAt: EpochMs;
  expiresAt?: EpochMs;
}

/** Concrete access grant: who can do what to which shared resource. */
export interface AccessPermission {
  id: Id;
  granteeUserId: Id;
  resourceType: "library" | "playlist";
  resourceId: Id;
  role: AccessRole;
  grantedByUserId: Id;
  createdAt: EpochMs;
}

// ---------------------------------------------------------------------------
// Aggregate view of everything owned by one account — handy for export /
// account-deletion (GDPR) and for the future API's `/me` payload.
// ---------------------------------------------------------------------------

export interface AccountData {
  user: User;
  settings?: UserSettings;
  playerPreferences?: PlayerPreferences;
  driveConnections: DriveConnection[];
  libraries: LibraryItem[];
  watchHistory: WatchHistoryEntry[];
  favorites: Favorite[];
}
