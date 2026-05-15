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
  RECENT_FOLDERS: "dc.recentFolders",
  USER_PROFILE: "dc.userProfile",
  PLAYBACK_STATE: "dc.playbackState",
  SETTINGS: "dc.settings",
  METADATA_CACHE: "dc.metadataCache",
  TMDB_KEY: "dc.tmdbKey",
  /** Per-file last-known playback mode (native vs mse-remux) for MKV files. */
  PLAYBACK_ENGINE_CACHE: "dc.playbackEngineCache",
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
