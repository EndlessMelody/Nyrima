/**
 * Constants shared across background, content, and app contexts.
 */

export const APP_NAME = "Nyrima";

/** The required folder name in Google Drive. */
export const REQUIRED_FOLDER_NAME = "Nyrima";

/** Path to the main app page bundled by the extension. */
export const APP_PAGE = "src/app/index.html";

/** Storage keys used in chrome.storage.local. */
export const STORAGE_KEYS = {
  /** The user's verified Nyrima root folder. Single source of truth for what
   *  the library shelf is allowed to show. */
  NYRIMA_ROOT: "dc.nyrimaRoot",
  RECENT_FOLDERS: "dc.recentFolders",
  USER_PROFILE: "dc.userProfile",
  PLAYBACK_STATE: "dc.playbackState",
  SETTINGS: "dc.settings",
  /** Legacy MAL/Jikan poster cache. Removed on 2026-05-18 in favour of
   *  user-placed `Poster.{jpg,png,…}` files inside each Drive folder. The
   *  key stays here so the boot-time migration can purge any stale entry
   *  on existing installs. Safe to drop entirely once all clients have
   *  rolled past the migration marker. */
  METADATA_CACHE: "dc.metadataCache.v3",
  OAUTH_CLIENT_ID: "dc.oauthClientId",
  /** Per-file last-known playback mode (native vs mse-remux) for MKV files. */
  PLAYBACK_ENGINE_CACHE: "dc.playbackEngineCache",
  /** Per-folder UI state (last query, collapsed groups). Keyed by folderId.
   *  Used by LibraryPage so navigating between libraries remembers where the
   *  user left off instead of resetting filters every time. */
  LIBRARY_VIEW_STATE: "dc.libraryViewState",
  // --- Phase 4 sharing layer -------------------------------------------------
  /** The user's own ShareProfile (handle + display name + avatar). Stamped
   *  into every ShareEntry / ShareComment they write. */
  SHARE_PROFILE: "dc.shareProfile",
  /** Cached Drive folder id of the user's `Shared/` folder so the bootstrap
   *  service doesn't re-resolve it on every Phase 4 call. Invalidated when
   *  the Nyrima root is re-paired (see account-reset.ts). */
  SHARED_FOLDER_ID: "dc.sharedFolderId",
  /** Cached child folder ids inside `Shared/` (entries/ + comments/) so the
   *  service can fetch them without re-listing. Shape: Record<string, string>
   *  keyed by subfolder name. */
  SHARED_SUBFOLDER_IDS: "dc.sharedSubfolderIds",
  /** FollowedUser[] — people the user has subscribed to. The Inbox + Friends
   *  surfaces in Phase 4.2 read from this list. */
  FOLLOWED_USERS: "dc.followedUsers",
} as const;

/** Max entries kept in the per-file playback-mode LRU. */
export const MAX_PLAYBACK_ENGINE_ENTRIES = 50;

/** Maximum number of recent folders kept. */
export const MAX_RECENT_FOLDERS = 20;

/** Context menu IDs registered by the background script. */
export const CONTEXT_MENU = {
  OPEN_FOLDER_IN_APP: "dc.openFolderInApp",
} as const;

/** Video file extensions Nyrima will list. */
export const VIDEO_EXTENSIONS = [
  "mp4",
  "mkv",
  "webm",
  "mov",
  "avi",
  "m4v",
  "ts",
  "m2ts",
  "wmv",
  "flv",
] as const;

/** Subtitle file extensions Nyrima will list and match. */
export const SUBTITLE_EXTENSIONS = ["srt", "vtt", "ass", "ssa", "sub"] as const;

/** MIME types Drive will use for video files. */
export const VIDEO_MIME_PATTERNS = [
  "video/",
  "application/x-matroska",
  "application/octet-stream", // some MKVs are uploaded as octet-stream
] as const;

/**
 * Containers the browser can't play natively and that aren't covered by our
 * MKV remux pipeline. Used by PlayerPage to fail fast with a friendly message.
 */
export const UNSUPPORTED_CONTAINERS = [
  "avi",
  "ts",
  "m2ts",
  "wmv",
  "flv",
] as const;

/** Percent watched at or above which Nyrima treats a video as "Watched". */
export const WATCHED_THRESHOLD_PCT = 95;

// ---------------------------------------------------------------------------
// Phase 4 — sharing layer paths + caps
// ---------------------------------------------------------------------------

/** Subfolder inside the Nyrima root that holds the user's public shares.
 *  Created on first share; intentionally private until the user opts to
 *  publish it (Phase 4.1 surfaces the publish confirmation). */
export const SHARED_FOLDER_NAME = "Shared";

/** Subfolder of `Shared/` holding one JSON file per share entry. */
export const SHARED_ENTRIES_SUBFOLDER = "entries";

/** Subfolder of `Shared/` holding the user's comment JSONL files (each
 *  file targets one shareId the user has commented on). */
export const SHARED_COMMENTS_SUBFOLDER = "comments";

/** Filename of the index manifest at the root of `Shared/`. */
export const SHARED_INDEX_FILENAME = "index.json";

/** MIME type used when uploading JSON files to Drive. */
export const SHARED_JSON_MIME = "application/json";

/** MIME type used for the JSONL comment files. We use `text/plain` rather
 *  than `application/x-ndjson` so Drive's preview shows the contents and
 *  legacy clients can render them as plain text. */
export const SHARED_JSONL_MIME = "text/plain";

/** Soft cap on index.json — entries beyond this are still on Drive but
 *  not listed. Lets the index stay small for fast pulls. */
export const MAX_SHARE_INDEX_ENTRIES = 200;

/** Soft cap on a single comment's text length. */
export const MAX_SHARE_COMMENT_CHARS = 2000;

/** Soft cap on a share entry's caption length. */
export const MAX_SHARE_CAPTION_CHARS = 600;

/** Regex the share handle picker enforces. Lower-case slug, 3–32 chars,
 *  alphanumeric + dash + underscore. Keeps handles file-system safe and
 *  unambiguous across Drive listings. */
export const SHARE_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;
