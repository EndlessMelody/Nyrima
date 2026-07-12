/**
 * Constants shared across background, content, and app contexts.
 */

export const APP_NAME = "Nyrima";

/** The required folder name in Google Drive. */
export const REQUIRED_FOLDER_NAME = "Nyrima";

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
  /** Legacy Phase 4.0 child-folder cache. The current share layout is flat,
   *  but account reset still clears this key for users who upgraded from a
   *  build that created `entries/` or `comments/` subfolders. */
  SHARED_SUBFOLDER_IDS: "dc.sharedSubfolderIds",
  /** FollowedUser[] — people the user has subscribed to. The Inbox + Friends
   *  surfaces in Phase 4.2 read from this list. */
  FOLLOWED_USERS: "dc.followedUsers",
  /** Cached flattened inbox rows from the last successful social sync.
   *  Lets `/social` render the previous feed while Drive refreshes. */
  SOCIAL_INBOX_CACHE: "dc.socialInboxCache.v1",
  /** Cached `DirectoryEntry[]` from the P4.4 bootstrap directory plus its
   *  fetch timestamp. Refreshed on a 24h TTL so the Discover rail doesn't
   *  hammer GitHub every Social hub visit. */
  DIRECTORY_CACHE: "dc.directoryCache.v1",
  // --- Light Novel / EPUB reader ---------------------------------------------
  /** Global reader typography + theme preferences (one set, applied to every
   *  book) — see ReaderPrefs. */
  READER_PREFS: "dc.readerPrefs.v1",
  /** Per-book reading progress (chapter + scroll position), keyed by Drive
   *  file id. Restored on reopen so the reader resumes exactly where the user
   *  left off. */
  READER_PROGRESS: "dc.readerProgress.v1",
  /** Per-book bookmarks, keyed by Drive file id. */
  READER_BOOKMARKS: "dc.readerBookmarks.v1",
  /** Per-book highlights + notes, keyed by Drive file id. */
  READER_HIGHLIGHTS: "dc.readerHighlights.v1",
  // --- Posts (block-based blog) ----------------------------------------------
  /** Cached Drive folder id of the user's `Posts/` folder, mirroring
   *  SHARED_FOLDER_ID's caching strategy. Invalidated on Nyrima root re-pair. */
  POSTS_FOLDER_ID: "dc.postsFolderId",
  /** Cached flattened feed rows from the last successful posts sync. Lets
   *  the Posts feed render the previous state while Drive refreshes. */
  POSTS_FEED_CACHE: "dc.postsFeedCache.v1",
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

/** Filename of the index manifest at the root of `Shared/`. */
export const SHARED_INDEX_FILENAME = "index.json";

/** Filename of the user's flat comments stream at the root of `Shared/`.
 *  One JSONL file with every comment the user has ever posted — the share
 *  owner filters by `sharedFolderId` when aggregating. */
export const SHARED_COMMENTS_FILENAME = "comments.jsonl";

/** MIME type used when uploading JSON files to Drive. */
export const SHARED_JSON_MIME = "application/json";

/** MIME type used for the JSONL comment files. We use `text/plain` rather
 *  than `application/x-ndjson` so Drive's preview shows the contents and
 *  legacy clients can render them as plain text. */
export const SHARED_JSONL_MIME = "text/plain";

/** Soft cap on inlined entries in `index.json`. Beyond this, the oldest
 *  entry falls off the manifest entirely (the inline model drops the
 *  legacy entries/ folder, so old entries are gone — not archived). At
 *  ~600 B per entry the manifest stays comfortably under 200 KB. */
export const MAX_SHARE_INDEX_ENTRIES = 200;

/** Soft cap on a single comment's text length. */
export const MAX_SHARE_COMMENT_CHARS = 2000;

/** Soft cap on a share entry's caption length. */
export const MAX_SHARE_CAPTION_CHARS = 600;

/** Regex the share handle picker enforces. Lower-case slug, 3–32 chars,
 *  alphanumeric + dash + underscore. Keeps handles file-system safe and
 *  unambiguous across Drive listings. */
export const SHARE_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;

// ---------------------------------------------------------------------------
// Phase 4.4 — bootstrap directory
//
// A static `DirectoryEntry[]` published as a single JSON file on GitHub.
// The extension fetches + caches it for the Discover rail in People.
//
// Opt-in is manual (copy-paste a snippet into a GitHub issue); the
// repo maintainer reviews + merges. Spam-resistant by virtue of the
// PR gate — no in-app write to the directory itself.
// ---------------------------------------------------------------------------

/** Raw GitHub URL of the directory JSON. Swap when the registry repo
 *  is published — until then, a 404 is treated as "empty directory" and
 *  the Discover rail surfaces a friendly note instead of an error. */
export const NYRIMA_DIRECTORY_URL =
  "https://raw.githubusercontent.com/nyrima/directory/main/users.json";

/** Where to send opt-in requests. The dialog opens a new issue with the
 *  pre-filled JSON snippet pasted into the body via URL params. */
export const NYRIMA_DIRECTORY_ISSUE_URL =
  "https://github.com/nyrima/directory/issues/new";

/** Cache TTL for the directory pull, in ms. 24h is generous — entries
 *  don't churn fast, and a stale cache is strictly better than spamming
 *  unauthenticated requests at GitHub. */
export const DIRECTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Posts — block-based blog layer
//
// Drive-only, same trust model as the Phase 4 sharing layer: post bodies +
// media live under a private `Posts/` folder (sibling of `Shared/`) in the
// author's own Nyrima root. Publishing flips the individual post folder
// public and drops a slim announcement into `Shared/posts.json` — a new
// file, never inlined into the existing `Shared/index.json` (whose
// sanitizer rejects any schema it doesn't recognise).
// ---------------------------------------------------------------------------

/** Subfolder inside the Nyrima root that holds all of the user's posts
 *  (drafts + published), one child folder per post. Private until the
 *  individual post folder is explicitly published. */
export const POSTS_FOLDER_NAME = "Posts";

/** Subfolder inside a post folder holding uploaded/copied media assets. */
export const POST_ASSETS_FOLDER_NAME = "assets";

/** Filename of the post document at the root of a post folder. */
export const POST_JSON_FILENAME = "post.json";

/** Filename of the announcements manifest at the root of `Shared/`. Sibling
 *  of `index.json` / `comments.jsonl`, not merged into either. */
export const POSTS_MANIFEST_FILENAME = "posts.json";

/** MIME type used when uploading the post document JSON. */
export const POST_JSON_MIME = "application/json";

/** Soft cap on announcements inlined in `Shared/posts.json`. Beyond this,
 *  the oldest announcement falls off — mirrors MAX_SHARE_INDEX_ENTRIES. */
export const MAX_POSTS_MANIFEST_ENTRIES = 200;

/** Hard cap on the number of blocks in a single post document. Keeps the
 *  manifest + post.json bounded and gives the sanitizer a denial-of-service
 *  backstop against a malformed/hostile followed-user post. */
export const MAX_POST_BLOCKS = 500;

/** Hard cap on block nesting depth (children-of-children-of-children…). */
export const MAX_POST_BLOCK_DEPTH = 4;

export const MAX_POST_TITLE_CHARS = 240;
export const MAX_POST_EXCERPT_CHARS = 280;
export const MAX_POST_TAG_CHARS = 32;
export const MAX_POST_TAGS = 8;
export const MAX_POST_TEXT_RUN_CHARS = 10_000;
export const MAX_POST_CAPTION_CHARS = 600;
