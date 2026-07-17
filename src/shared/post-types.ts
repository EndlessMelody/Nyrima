/**
 * Domain types for the Posts (block-based blog) layer.
 *
 * A post is a BlockNote document (`PostDoc.blocks`) persisted as Drive-safe
 * JSON: block `props` are flat scalars only, and media blocks reference
 * Drive `fileId`s rather than URLs (thumbnail/stream URLs expire and are
 * auth-state-dependent — see drive-api.ts `buildPublicStreamUrl`). BlockNote's
 * own document shape (`{ id, type, props, content, children }`) already
 * satisfies this, so `PostBlock` mirrors it directly rather than introducing
 * a translation layer between editor and storage.
 *
 * Untrusted input boundary: any `PostDoc`/`PostsManifest` read from another
 * user's Drive must go through `sanitizePostDoc` / `sanitizePostsManifest`
 * (src/app/services/posts/) before the app trusts it. See those sanitizers
 * for the authoritative per-type prop whitelist.
 */

import type { ShareAuthor } from "./types";

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

export interface PostInlineStyles {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
  /** CSS color value or a Nyrima token name. */
  textColor?: string;
  backgroundColor?: string;
}

export interface PostStyledText {
  type: "text";
  text: string;
  styles: PostInlineStyles;
}

export interface PostLinkInline {
  type: "link";
  /** https-only — enforced by the sanitizer. */
  href: string;
  content: PostStyledText[];
}

export type PostInline = PostStyledText | PostLinkInline;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Built-in block types, whitelisted from BlockNote's larger default set
 *  (table is deferred — its content shape doesn't fit the flat-props model
 *  cleanly yet). */
export type PostBuiltinBlockType =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "quote"
  | "codeBlock";

/** Custom Nyrima block types. */
export type PostCustomBlockType =
  | "driveImage"
  | "driveVideo"
  | "driveAudio"
  | "animeCard"
  | "rating"
  | "spoiler"
  | "callout"
  | "linkCard";

/** Placeholder type the sanitizer substitutes for any block type it doesn't
 *  recognise (e.g. written by a newer Nyrima version). Rendered as a dashed
 *  stub so one exotic block doesn't take down the whole post. */
export type PostUnsupportedBlockType = "unsupported";

export type PostBlockType =
  | PostBuiltinBlockType
  | PostCustomBlockType
  | PostUnsupportedBlockType;

/** A single block. Props are flat scalars only (Drive-JSON-safe and a
 *  reasonable match for BlockNote's own custom-block prop constraint).
 *  `content` carries inline runs for text-bearing blocks; `children` nests
 *  child blocks (list indentation, or the collapsed body of a `spoiler`). */
export interface PostBlock {
  id: string;
  type: PostBlockType;
  props: Record<string, string | number | boolean>;
  content?: PostInline[];
  children?: PostBlock[];
}

// ---------------------------------------------------------------------------
// Post document
// ---------------------------------------------------------------------------

/** "draft" = still being written. "private" = finished, intentionally kept
 *  off Drive-sharing — same Drive permissions as "draft" (folder never made
 *  public), distinct only in intent/UI framing. "friends"/"public" flip the
 *  post folder to "anyone with the link" (see post-publish.ts). */
export type PostVisibility = "draft" | "private" | "friends" | "public";

/** Current on-disk schema version for `post.json`. */
export const POST_DOC_SCHEMA_VERSION = 1 as const;

export interface PostCover {
  /** Drive file id inside the post's `assets/` folder. */
  fileId: string;
}

/** `<postFolder>/post.json` — the full post document. */
export interface PostDoc {
  v: 1;
  /** Stable id, generated once at creation. Also the value announced in
   *  `PostAnnouncement.id`; the post *folder* id (not this field) is the
   *  routing key, since a folder id is what's addressable on Drive. */
  id: string;
  author: ShareAuthor;
  title: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  visibility: PostVisibility;
  cover?: PostCover;
  /** Optional per-post accent — a hex color or bare named token, same
   *  shape as an inline run's `textColor` (see `PostInlineStyles`). A
   *  light personalization layer: tints the cover frame and a couple of
   *  small accents on the published page, never a full theme override. */
  accent?: string;
  tags?: string[];
  /** Author-written share-preview blurb — distinct from the auto-derived
   *  excerpt (`derivePostExcerpt`), which an author may not want verbatim
   *  in a social/search preview. */
  metaDescription?: string;
  /** Renders a reader-facing jump-to-heading table of contents on the
   *  published page, reusing the same heading-outline logic as the
   *  editor's own structure rail. */
  showToc?: boolean;
  /** Per-block font family/size overrides, keyed by block id. Deliberately
   *  a doc-level side-car map rather than BlockNote block props: adding
   *  custom props to BlockNote's built-in text block types would require
   *  reimplementing their ProseMirror node specs (propSchema is baked into
   *  the node at creation time, not patchable after the fact), risking
   *  dropped behavior (keyboard shortcuts, list semantics). This map is
   *  applied as plain inline styles by the editor/renderer instead. */
  blockFonts?: Record<string, { family?: string; size?: number }>;
  /** Drive file ids OUTSIDE the post folder (e.g. a library video
   *  referenced by a `driveVideo` block) that were flipped "anyone with
   *  the link" at publish time with the author's per-file consent.
   *  Unpublish revokes exactly these ids and no others. */
  sharedFileIds?: string[];
  blocks: PostBlock[];
}

// ---------------------------------------------------------------------------
// Posts manifest (`Shared/posts.json`) — follow-feed announcements
// ---------------------------------------------------------------------------

export const POSTS_MANIFEST_SCHEMA_VERSION = 1 as const;

/** Slim, feed-card-sized projection of a `PostDoc`. The feed sync only ever
 *  downloads this manifest per followed user — the full `post.json` (and its
 *  block tree) is fetched lazily when a reader opens a specific post. */
export interface PostAnnouncement {
  v: 1;
  /** Matches `PostDoc.id`. */
  id: string;
  /** Drive folder id of the post — the `/posts/view/:folderId` route param
   *  and the address used to fetch the full `post.json` on open. */
  folderId: string;
  title: string;
  /** Plain-text excerpt derived from the first text blocks at publish time. */
  excerpt?: string;
  /** Poster/cover snapshot, sourced the same way as `ShareEntry.posterUrl` —
   *  accepted to rot; the viewer falls back to resolving `cover.fileId`. */
  posterUrl?: string;
  visibility: Exclude<PostVisibility, "draft" | "private">;
  publishedAt: string;
  updatedAt: string;
  tags?: string[];
}

/** `Shared/posts.json` — sibling of `index.json`, never merged into it. */
export interface PostsManifest {
  v: 1;
  owner: ShareAuthor;
  updatedAt: string;
  /** Newest-first. Soft-capped at MAX_POSTS_MANIFEST_ENTRIES. */
  posts: PostAnnouncement[];
}
