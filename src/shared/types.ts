/**
 * Domain types used across the extension.
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string; // Drive API returns size as string (int64)
  modifiedTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  videoMediaMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: string;
  };
  parents?: string[];
}

export interface RecentFolder {
  id: string;
  name: string;
  lastOpenedAt: number; // epoch ms
  pinned?: boolean;
  /** Total entries (videos + subfolders) — kept for backwards compatibility. */
  itemCount?: number;
  /** Just the video count, written when the library page populates. */
  videoCount?: number;
  /** Sum of all known video durations in this library, in ms. */
  runtimeMs?: number;
  /** Count of videos with playback past the watched threshold. */
  watchedCount?: number;
  /** Best-known cover image for this folder — sourced from the user-placed
   *  `Poster.{jpg,jpeg,png,webp}` inside the folder on Drive (or the
   *  parent folder's poster when none exists locally). The library card on
   *  the lobby renders this; falls back to the initials tile when absent. */
  coverPosterUrl?: string;
  /** Drive file id of the matched `Poster.*` image. Persisted alongside the
   *  URL so a later visit can re-mint a fresh `thumbnailLink` via the
   *  metadata cache when the cached URL signature has expired. */
  coverFileId?: string;
  /** Epoch ms of the newest video file's modifiedTime in this library, as
   *  observed during the most recent enrichment pass. Compared against
   *  `lastSeenAt` to compute the "N new" badge on the LibraryCard. */
  newestModifiedAt?: number;
  /** Epoch ms of the user's last visit to this library's page. Initialised
   *  on the *first* enrichment to `newestModifiedAt` so a brand-new install
   *  doesn't flag every episode as new. */
  lastSeenAt?: number;
  /** Count of videos with `modifiedTime > lastSeenAt`. Cached so the lobby
   *  doesn't re-scan to render the badge. Cleared by LibraryPage on visit. */
  pendingNewCount?: number;
}

/** The single Nyrima root folder. Persisted once at onboarding; re-validated
 *  on every refresh so a renamed/missing folder surfaces immediately. */
export interface NyrimaRoot {
  id: string;
  /** The Drive folder's actual name at verification time. Used for display
   *  and so we can detect when the user renames it on Drive. */
  name: string;
  verifiedAt: number; // epoch ms
}

export interface UserProfile {
  email: string;
  name?: string;
  picture?: string;
}

export interface PlaybackPosition {
  fileId: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number;
  /** File name — stored so Continue Watching can render without re-fetching. */
  name?: string;
  /** Parent folder id — for routing back to the library. */
  folderId?: string;
  mimeType?: string;
}

/** Built-in subtitle font presets the picker exposes. "custom" means the
 *  user uploaded their own .woff2/.ttf — the file lives in
 *  `subtitleCustomFontDataUrl` and is registered via @font-face on load.
 *
 *  Renamed from the old `comic`/`geist` keys so the picker labels actually
 *  describe what the user sees: `anime-brush` is the fansub-flavored Comic
 *  Neue stack (the one the old "Comic Sans" preset really rendered as),
 *  `comic-dialogue` prefers the literal Comic Sans face when present, and
 *  `clean-sans` is the Geist Sans body stack. */
export type SubtitleFontPreset =
  | "anime-brush"
  | "comic-dialogue"
  | "clean-sans"
  | "system"
  | "custom";

export type LibrarySortKey = "name" | "modified" | "size" | "duration";
export type LibraryViewMode = "grouped" | "grid" | "list";

export interface AppSettings {
  preferredSubtitleLanguage: string; // e.g. "vi", "en"
  autoplayNext: boolean;
  defaultVolume: number; // 0..1
  theme: "system" | "light" | "dark";

  /** Multiplier applied on top of the base subtitle font-size. 1.0 = 100 %.
   *  UI exposes a 0.5–2.0 slider; defaults to 1.0 windowed and is the same
   *  multiplier in fullscreen (the base size itself is larger in fullscreen
   *  via CSS, see SubtitleOverlay.scss). */
  subtitleScale: number;
  /** Which font family the SubtitleOverlay should render with. */
  subtitleFont: SubtitleFontPreset;
  /** Display name of the user-uploaded font (for the picker label). */
  subtitleCustomFontName?: string;
  /** data: URL containing the woff2/ttf bytes — registered as @font-face
   *  family name `Nyrima Custom Sub` on app boot when present. */
  subtitleCustomFontDataUrl?: string;
  /** CSS font-weight applied to subtitle cues (400/500/600/700/800/900). */
  subtitleWeight: 400 | 500 | 600 | 700 | 800 | 900;
  /** CSS color for the subtitle fill. Hex, e.g. "#e8e8e8". */
  subtitleColor: string;
  /** Hex color of the painted stroke around each glyph. */
  subtitleOutlineColor: string;
  /** Stroke width in px (0 disables the outline). */
  subtitleOutlineWidth: number;
  /** Soft-shadow strength multiplier; 0 = none, 1 = default, up to 2. */
  subtitleShadow: number;
  /** CSS letter-spacing in em (e.g. 0.02). Range -0.05..0.2. */
  subtitleLetterSpacing: number;
  /** Vertical baseline offset as a 0..1 fraction of viewport height from the
   *  bottom. 0 = stuck to bottom edge, 0.5 = halfway up. */
  subtitlePosition: number;
  /** Seconds the skip-back / skip-forward HUD buttons jump by. */
  skipSeconds: 5 | 10 | 15 | 30;
  /** Last-used sort inside a library. */
  librarySort: LibrarySortKey;
  /** Last-used library video layout. */
  libraryView: LibraryViewMode;
}

// ---------------------------------------------------------------------------
// Phase 4 — sharing layer
//
// Drive-only social model: every user gets a `Shared/` subfolder under their
// Nyrima root, set to "Anyone with the link → Viewer". Their share entries
// live as one JSON file per share inside `Shared/entries/`; an
// `index.json` at the folder root manifests them so a recipient can pull a
// slim list before downloading individual entry bytes.
//
// Comments are decentralized: each commenter writes to *their own*
// `Shared/comments/{shareId}.jsonl` as append-only JSON-Lines. The share
// owner reconstructs a thread by scanning every follower's Shared folder
// for files matching their shareId. No user ever needs edit access to
// anyone else's folder — Drive's binary view/edit permission model is the
// reason we route comments through the commenter's own surface.
// ---------------------------------------------------------------------------

/** Author profile snapshot stamped into every ShareEntry + ShareComment.
 *  Snapshotted (not referenced) so a recipient can render attribution from
 *  the entry/comment file alone, without a second author-profile lookup. */
export interface ShareAuthor {
  /** User-chosen short handle (e.g., "khoa"). Lower-case, no spaces; the
   *  picker enforces a slug pattern. Required — drives display + de-dup. */
  handle: string;
  /** Optional display name (e.g., "Đăng Khoa"). Pulled from Google profile
   *  by default; can be overridden in the share profile editor. */
  name?: string;
  /** Optional avatar URL. Default source is the Google profile picture,
   *  surfaced verbatim so we don't need to re-host it. */
  avatarUrl?: string;
}

export type ShareTargetKind = "video" | "library";

export interface ShareVideoTarget {
  kind: "video";
  /** Drive file id of the shared video. */
  fileId: string;
  /** Parent Drive folder id so the recipient can browse siblings. */
  folderId?: string;
}

export interface ShareLibraryTarget {
  kind: "library";
  /** Drive folder id of the shared library. */
  folderId: string;
}

export type ShareTarget = ShareVideoTarget | ShareLibraryTarget;

/** A single share entry — one JSON file at
 *  `Shared/entries/{id}.json` in the author's folder. */
export interface ShareEntry {
  /** Stable random id (UUID-like). Used as the filename + cross-user
   *  reference key (e.g., for routing comments back to the right thread). */
  id: string;
  /** Schema version for forward-compat. Bumped if/when the shape changes. */
  v: 1;
  /** ISO 8601 timestamp when the share was created. */
  sharedAt: string;
  /** ISO 8601 of last edit (caption change, re-share, etc.). */
  updatedAt: string;
  /** What's being shared — video file or whole library. */
  target: ShareTarget;
  /** Author snapshot at share time. */
  author: ShareAuthor;
  /** Optional caption / commentary by the author. Plain text only — no
   *  HTML or markdown rendering for safety + simplicity. */
  caption?: string;
  /** Optional poster URL, snapshotted at share time so the recipient
   *  renders something immediately. Sourced from the folder's `Poster.*`
   *  image on Drive (or the Drive frame thumbnail as fallback). */
  posterUrl?: string;
  /** Display title at share time. Lets the recipient render a card
   *  immediately without resolving titles themselves. */
  title?: string;
}

/** Slim per-entry record in `index.json`. Just enough for a recipient to
 *  render a list card; full payload comes from the entry JSON file. */
export interface ShareIndexEntry {
  id: string;
  sharedAt: string;
  /** Drive file id of the entry JSON inside `Shared/entries/`. */
  entryFileId: string;
  kind: ShareTargetKind;
  title?: string;
  posterUrl?: string;
}

/** The `index.json` manifest at the root of every user's `Shared/` folder.
 *  Single source of truth for "what has this user shared and when". */
export interface ShareIndex {
  v: 1;
  /** Owner profile — self-contained so following the index URL alone is
   *  enough to render attribution in the lobby. */
  owner: ShareAuthor;
  /** ISO 8601 of the last write to this index. */
  updatedAt: string;
  /** Newest-first. Soft-capped at MAX_SHARE_INDEX_ENTRIES; older entries
   *  remain on Drive but stop being listed in the index. */
  entries: ShareIndexEntry[];
}

/** A single comment, one per line inside
 *  `Shared/comments/{shareId}.jsonl`. */
export interface ShareComment {
  v: 1;
  /** ISO 8601 timestamp of the comment. */
  at: string;
  /** Commenter snapshot. */
  author: ShareAuthor;
  /** Plain text. Capped at MAX_SHARE_COMMENT_CHARS. */
  text: string;
}

/** Local persisted record of someone the user follows. Stored as a list in
 *  chrome.storage.local under STORAGE_KEYS.FOLLOWED_USERS. */
export interface FollowedUser {
  /** Drive folder id of their `Shared/` folder. The follow URL the user
   *  pasted is parsed down to this id before persistence. */
  sharedFolderId: string;
  /** Owner profile from the last successful index pull. */
  profile: ShareAuthor;
  /** ISO 8601 of when we last successfully pulled their index. */
  lastPulledAt?: string;
  /** Id of the most recent entry seen during the last pull; lets the
   *  Inbox compute "N new since" without a full diff. */
  lastSeenEntryId?: string;
  /** ISO 8601 of when the user added them. */
  followedAt: string;
}

/** The user's own sharing profile. Stamped into every ShareEntry +
 *  ShareComment they write. Persisted under STORAGE_KEYS.SHARE_PROFILE. */
export interface ShareProfile {
  v: 1;
  /** Lower-case slug (3–32 chars, [a-z0-9_-]). Required. */
  handle: string;
  /** Optional friendly name. */
  name?: string;
  /** Optional avatar URL (defaults to Google profile picture when present). */
  avatarUrl?: string;
  /** ISO 8601 of the last edit. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: AppSettings = {
  preferredSubtitleLanguage: "vi",
  autoplayNext: true,
  defaultVolume: 1.0,
  theme: "dark",
  subtitleScale: 1.0,
  subtitleFont: "anime-brush",
  subtitleWeight: 700,
  subtitleColor: "#e8e8e8",
  subtitleOutlineColor: "#000000",
  subtitleOutlineWidth: 2.5,
  subtitleShadow: 1,
  subtitleLetterSpacing: 0.01,
  subtitlePosition: 0,
  skipSeconds: 10,
  librarySort: "name",
  libraryView: "grouped",
};
