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
  capabilities?: {
    canCopy?: boolean;
    canDownload?: boolean;
    canReadRevisions?: boolean;
    [key: string]: boolean | undefined;
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
 *  Each key now matches the bundled face it ships with so the picker label,
 *  the @font-face family in fonts.scss, and the data shape stay in sync:
 *
 *    - `chinacat-teddybear` — Chinacat Teddybear (brush voice, was anime-brush)
 *    - `cascadia`           — Cascadia Mono (dialogue voice, was comic-dialogue)
 *    - `asap`               — Asap variable sans (was clean-sans)
 *    - `system`             — platform UI default
 *    - `custom`             — user-uploaded face from subtitleCustomFontDataUrl */
export type SubtitleFontPreset =
  | "chinacat-teddybear"
  | "cascadia"
  | "asap"
  | "system"
  | "custom";

export type LibrarySortKey = "name" | "modified" | "size" | "duration";
export type LibraryViewMode = "grouped" | "grid" | "list";

export interface AppSettings {
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
// Nyrima root, set to "Anyone with the link → Viewer". A single
// `index.json` at the folder root manifests every share *inline* — the
// schema v=2 collapses the old `entries/{id}.json` per-share files into the
// index itself. Followers pull one file to render the whole feed.
//
// Comments are decentralized: each commenter writes to *their own*
// `Shared/comments.jsonl` as append-only JSON-Lines. The share owner
// reconstructs threads by scanning each followed user's flat comments stream
// and filtering by `{ sharedFolderId, shareId }`. No user ever needs edit
// access to anyone else's folder — Drive's binary view/edit permission model
// is the reason we route comments through the commenter's own surface.
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

/** A single share entry. Inlined directly into `index.json` under v=2 —
 *  there is no longer a separate `entries/{id}.json` file. Author is
 *  implicit from the enclosing `ShareIndex.owner`. */
export interface ShareEntry {
  /** Stable random id (UUID-like). Cross-user reference key (e.g., for
   *  routing comments back to the right thread). */
  id: string;
  /** Schema version. v=2 = inlined in index.json; v=1 (legacy) had a
   *  separate per-entry file and is no longer read. */
  v: 2;
  /** ISO 8601 timestamp when the share was created. */
  sharedAt: string;
  /** ISO 8601 of last edit (caption change, re-share, etc.). */
  updatedAt: string;
  /** What's being shared — video file or whole library. */
  target: ShareTarget;
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

/** The `index.json` manifest at the root of every user's `Shared/` folder.
 *  Single source of truth for "what has this user shared and when".
 *
 *  v=2: entries are full ShareEntry payloads inlined here. One Drive read
 *  per follower yields the whole feed. v=1 indexes (pre-refactor) are
 *  ignored — `readShareIndex` returns null for them and the next share
 *  re-seeds a fresh v=2 manifest. */
export interface ShareIndex {
  v: 2;
  /** Owner profile — self-contained so following the index URL alone is
   *  enough to render attribution in the lobby. */
  owner: ShareAuthor;
  /** ISO 8601 of the last write to this index. */
  updatedAt: string;
  /** Newest-first. Soft-capped at MAX_SHARE_INDEX_ENTRIES; older entries
   *  fall off the manifest entirely under the inline model. */
  entries: ShareEntry[];
}

/** A single comment, written one per line inside the commenter's own
 *  `Shared/comments.jsonl`. The file is a flat JSONL stream — all comments
 *  the user has ever posted, regardless of which share they're on. The
 *  share owner reconstructs threads on a given share by reading every
 *  follower's `comments.jsonl` and filtering to entries where
 *  `sharedFolderId` matches their own folder. */
export interface ShareComment {
  v: 1;
  /** Stable random id (UUID-ish). Lets the UI dedupe across re-reads and
   *  gives a future "delete this comment" affordance something to target. */
  id: string;
  /** Drive folder id of the *share owner's* `Shared/` folder. Used by the
   *  aggregator to filter a follower's flat comments file down to just the
   *  comments that target this owner's shares. */
  sharedFolderId: string;
  /** Id of the specific share being commented on (`ShareEntry.id`). */
  shareId: string;
  /** ISO 8601 timestamp of the comment. */
  at: string;
  /** Commenter snapshot — handle/name/avatar at write time. */
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

/** One row in the P4.4 bootstrap directory — a public, opt-in list of
 *  discoverable users hosted as a single JSON file on GitHub. Each entry
 *  carries enough to render a People → Discover suggestion card and
 *  trigger a one-click follow. */
export interface DirectoryEntry {
  v: 1;
  /** Same handle slug rules as ShareProfile.handle. Used as the
   *  cross-entry dedup key. */
  handle: string;
  /** Display name. */
  name?: string;
  /** Drive folder id of the user's `Shared/` folder. Same primitive
   *  PeopleSearch's paste-by-URL flow lands on, so following a directory
   *  entry reuses the existing follow path with no extra plumbing. */
  folderId: string;
  /** Optional avatar URL — same source as ShareAuthor.avatarUrl. */
  avatarUrl?: string;
  /** Short bio rendered on the discover card. Plain text, no markdown. */
  bio?: string;
  /** Free-form interest tags ("anime", "studio-ghibli", "blu-ray"). Used
   *  to filter the Discover rail in future iterations. */
  tags?: string[];
  /** ISO 8601 of the date the entry was added — drives a "fresh" pill on
   *  recently-added cards. */
  addedAt: string;
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
  autoplayNext: true,
  defaultVolume: 1.0,
  theme: "dark",
  subtitleScale: 1.0,
  subtitleFont: "chinacat-teddybear",
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
