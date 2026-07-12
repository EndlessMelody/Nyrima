/**
 * `post.json` sanitizer + pure helpers.
 *
 * A followed user's `post.json` is an untrusted input boundary — same
 * posture as `sanitizeShareIndex` for `Shared/index.json`. Rendering is
 * React-component-based off this sanitized JSON (never
 * `dangerouslySetInnerHTML`, never raw HTML from the wire), so prop
 * hygiene here IS the XSS defence, not a secondary layer over one.
 *
 * `sanitizePostDoc` never throws: reject the whole document only when its
 * own identity (id/author/timestamps) is unrecognisable. Individual
 * malformed blocks degrade to an `unsupported` stub instead of dropping —
 * one bad block shouldn't take down the rest of the post.
 */

import {
  MAX_POST_BLOCK_DEPTH,
  MAX_POST_BLOCKS,
  MAX_POST_CAPTION_CHARS,
  MAX_POST_EXCERPT_CHARS,
  MAX_POST_TAG_CHARS,
  MAX_POST_TAGS,
  MAX_POST_TEXT_RUN_CHARS,
  MAX_POST_TITLE_CHARS,
  SHARE_HANDLE_PATTERN,
} from "@shared/constants";
import { isDriveId } from "@shared/drive-id";
import type {
  PostBlock,
  PostBlockType,
  PostCover,
  PostDoc,
  PostInline,
  PostInlineStyles,
  PostStyledText,
  PostVisibility,
} from "@shared/post-types";
import { POST_DOC_SCHEMA_VERSION } from "@shared/post-types";
import type { ShareAuthor } from "@shared/types";

const MAX_ID_CHARS = 160;
const MAX_AUTHOR_NAME_CHARS = 80;
const MAX_AVATAR_URL_CHARS = 2048;
const MAX_ANIME_CARD_TITLE_CHARS = 200;
const MAX_BLOCK_STRING_PROP_CHARS = 400;

// ---------------------------------------------------------------------------
// Id generation
// ---------------------------------------------------------------------------

/** Stable random id for a new post. Only needs to be unique within the
 *  author's own `Posts/` folder — collisions across authors are namespaced
 *  by folder. */
export function generatePostId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Document sanitizer
// ---------------------------------------------------------------------------

export function sanitizePostDoc(raw: unknown): PostDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<PostDoc>;
  if (value.v !== POST_DOC_SCHEMA_VERSION) return null;

  const id = isNonEmptyText(value.id, MAX_ID_CHARS) ? value.id : null;
  const author = sanitizeAuthor(value.author);
  const title = isNonEmptyText(value.title, MAX_POST_TITLE_CHARS)
    ? value.title.trim()
    : null;
  const visibility = sanitizeVisibility(value.visibility);
  if (
    !id ||
    !author ||
    !title ||
    !visibility ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    return null;
  }

  const blocks = sanitizeBlockList(value.blocks, 0, {
    remaining: MAX_POST_BLOCKS,
  });
  const cover = sanitizeCover(value.cover);
  const tags = sanitizeTags(value.tags);
  const sharedFileIds = sanitizeFileIdList(value.sharedFileIds);

  return {
    v: POST_DOC_SCHEMA_VERSION,
    id,
    author,
    title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(isIsoTimestamp(value.publishedAt)
      ? { publishedAt: value.publishedAt }
      : {}),
    visibility,
    ...(cover ? { cover } : {}),
    ...(tags ? { tags } : {}),
    ...(sharedFileIds ? { sharedFileIds } : {}),
    blocks,
  };
}

function sanitizeVisibility(value: unknown): PostVisibility | null {
  return value === "draft" || value === "friends" || value === "public"
    ? value
    : null;
}

function sanitizeCover(value: unknown): PostCover | null {
  if (!value || typeof value !== "object") return null;
  const fileId = (value as Partial<PostCover>).fileId;
  return isDriveId(fileId) ? { fileId } : null;
}

function sanitizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (tags.length >= MAX_POST_TAGS) break;
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase().slice(0, MAX_POST_TAG_CHARS);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags.length > 0 ? tags : null;
}

function sanitizeFileIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter(isDriveId);
  return ids.length > 0 ? ids : null;
}

function sanitizeAuthor(value: unknown): ShareAuthor | null {
  if (!value || typeof value !== "object") return null;
  const author = value as Partial<ShareAuthor>;
  if (
    typeof author.handle !== "string" ||
    !SHARE_HANDLE_PATTERN.test(author.handle)
  ) {
    return null;
  }
  return {
    handle: author.handle,
    name: sanitizeStringProp(author.name, MAX_AUTHOR_NAME_CHARS),
    avatarUrl: sanitizeHttpsUrl(author.avatarUrl, MAX_AVATAR_URL_CHARS),
  };
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

interface BlockBudget {
  remaining: number;
}

function sanitizeBlockList(
  value: unknown,
  depth: number,
  budget: BlockBudget = { remaining: MAX_POST_BLOCKS },
): PostBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: PostBlock[] = [];
  for (const raw of value) {
    if (budget.remaining <= 0) break;
    const block = sanitizeBlock(raw, depth, budget);
    if (!block) continue;
    budget.remaining -= 1;
    blocks.push(block);
  }
  return blocks;
}

function sanitizeBlock(
  raw: unknown,
  depth: number,
  budget: BlockBudget,
): PostBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<PostBlock>;
  if (!isNonEmptyText(value.id, MAX_ID_CHARS)) return null;

  const children =
    depth < MAX_POST_BLOCK_DEPTH
      ? sanitizeBlockList(value.children, depth + 1, budget)
      : [];

  const type = value.type as PostBlockType | undefined;
  const spec = type ? BLOCK_SPECS[type] : undefined;
  if (!type || !spec) {
    return {
      id: value.id,
      type: "unsupported",
      props: {},
      ...(children.length > 0 ? { children } : {}),
    };
  }

  const props = spec.sanitizeProps(
    value.props && typeof value.props === "object" ? value.props : {},
  );
  if (!props) {
    return {
      id: value.id,
      type: "unsupported",
      props: {},
      ...(children.length > 0 ? { children } : {}),
    };
  }

  const content = spec.allowsContent
    ? sanitizeInlineContent(value.content)
    : undefined;

  return {
    id: value.id,
    type,
    props,
    ...(content ? { content } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

function sanitizeInlineContent(value: unknown): PostInline[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const runs: PostInline[] = [];
  for (const raw of value) {
    const run = sanitizeInline(raw);
    if (run) runs.push(run);
  }
  return runs.length > 0 ? runs : undefined;
}

function sanitizeInline(raw: unknown): PostInline | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { type?: unknown };
  if (value.type === "text") return sanitizeStyledText(raw);
  if (value.type === "link") {
    const link = raw as { href?: unknown; content?: unknown };
    const href = sanitizeHttpsUrl(link.href, 2048);
    if (!href) return null;
    const content: PostStyledText[] = [];
    if (Array.isArray(link.content)) {
      for (const run of link.content) {
        const styled = sanitizeStyledText(run);
        if (styled) content.push(styled);
      }
    }
    return content.length > 0 ? { type: "link", href, content } : null;
  }
  return null;
}

function sanitizeStyledText(raw: unknown): PostStyledText | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { type?: unknown; text?: unknown; styles?: unknown };
  if (value.type !== "text" || typeof value.text !== "string") return null;
  return {
    type: "text",
    text: value.text.slice(0, MAX_POST_TEXT_RUN_CHARS),
    styles: sanitizeInlineStyles(value.styles),
  };
}

function sanitizeInlineStyles(value: unknown): PostInlineStyles {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const styles: PostInlineStyles = {};
  for (const key of ["bold", "italic", "underline", "strike", "code"] as const) {
    if (raw[key] === true) styles[key] = true;
  }
  const textColor = sanitizeColorToken(raw.textColor);
  if (textColor) styles.textColor = textColor;
  const backgroundColor = sanitizeColorToken(raw.backgroundColor);
  if (backgroundColor) styles.backgroundColor = backgroundColor;
  return styles;
}

/** Accepts a short CSS-safe token: hex colors or bare word tokens (e.g.
 *  BlockNote's named palette entries like "red"/"blue"). Rejects anything
 *  that could break out of a `style` attribute or `url()` context. */
function sanitizeColorToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9-]{0,31}$/.test(trimmed)) return trimmed;
  return undefined;
}

// ---------------------------------------------------------------------------
// Per-block-type prop whitelists
// ---------------------------------------------------------------------------

type Props = Record<string, string | number | boolean>;

interface BlockSpec {
  /** Returns the sanitized prop bag, or null when a required prop is
   *  missing/invalid (caller downgrades the whole block to `unsupported`). */
  sanitizeProps: (raw: Record<string, unknown>) => Props | null;
  /** Whether this block type carries inline `content` (styled text runs). */
  allowsContent: boolean;
}

const TEXT_ALIGNMENTS = new Set(["left", "center", "right", "justify"]);
const IMAGE_WIDTHS = new Set(["inline", "wide", "full"]);
const IMAGE_ALIGNS = new Set(["left", "center", "right"]);
const RATING_STYLES = new Set(["stars", "bar"]);
const CALLOUT_TONES = new Set(["info", "warning", "fave"]);
const ANIME_STATUSES = new Set([
  "watching",
  "completed",
  "planned",
  "dropped",
  "on-hold",
]);

function commonTextProps(raw: Record<string, unknown>): Props {
  const props: Props = {};
  const textColor = sanitizeColorToken(raw.textColor);
  if (textColor) props.textColor = textColor;
  const backgroundColor = sanitizeColorToken(raw.backgroundColor);
  if (backgroundColor) props.backgroundColor = backgroundColor;
  if (
    typeof raw.textAlignment === "string" &&
    TEXT_ALIGNMENTS.has(raw.textAlignment)
  ) {
    props.textAlignment = raw.textAlignment;
  }
  return props;
}

function textBlockSpec(): BlockSpec {
  return {
    allowsContent: true,
    sanitizeProps: (raw) => commonTextProps(raw),
  };
}

const BLOCK_SPECS: Partial<Record<PostBlockType, BlockSpec>> = {
  paragraph: textBlockSpec(),
  quote: textBlockSpec(),
  bulletListItem: textBlockSpec(),
  numberedListItem: {
    allowsContent: true,
    sanitizeProps: (raw) => {
      const props = commonTextProps(raw);
      if (typeof raw.start === "number" && Number.isInteger(raw.start) && raw.start >= 0) {
        props.start = raw.start;
      }
      return props;
    },
  },
  checkListItem: {
    allowsContent: true,
    sanitizeProps: (raw) => ({
      ...commonTextProps(raw),
      checked: raw.checked === true,
    }),
  },
  heading: {
    allowsContent: true,
    sanitizeProps: (raw) => {
      const level = raw.level;
      if (level !== 1 && level !== 2 && level !== 3) return null;
      return { ...commonTextProps(raw), level };
    },
  },
  codeBlock: {
    allowsContent: true,
    sanitizeProps: (raw) => {
      const props: Props = {};
      if (
        typeof raw.language === "string" &&
        /^[a-zA-Z0-9_+-]{0,32}$/.test(raw.language)
      ) {
        props.language = raw.language;
      }
      return props;
    },
  },
  callout: {
    allowsContent: true,
    sanitizeProps: (raw) => {
      const tone =
        typeof raw.tone === "string" && CALLOUT_TONES.has(raw.tone)
          ? raw.tone
          : "info";
      return { tone };
    },
  },
  driveImage: {
    allowsContent: false,
    sanitizeProps: (raw) => {
      if (!isDriveId(raw.fileId)) return null;
      const props: Props = { fileId: raw.fileId };
      const caption = sanitizeStringProp(raw.caption, MAX_POST_CAPTION_CHARS);
      if (caption) props.caption = caption;
      props.width =
        typeof raw.width === "string" && IMAGE_WIDTHS.has(raw.width)
          ? raw.width
          : "wide";
      props.align =
        typeof raw.align === "string" && IMAGE_ALIGNS.has(raw.align)
          ? raw.align
          : "center";
      return props;
    },
  },
  driveVideo: {
    allowsContent: false,
    sanitizeProps: (raw) => {
      if (!isDriveId(raw.fileId)) return null;
      const props: Props = { fileId: raw.fileId };
      if (isDriveId(raw.folderId)) props.folderId = raw.folderId;
      if (isDriveId(raw.posterFileId)) props.posterFileId = raw.posterFileId;
      const title = sanitizeStringProp(raw.title, MAX_BLOCK_STRING_PROP_CHARS);
      if (title) props.title = title;
      if (typeof raw.startAt === "number" && raw.startAt >= 0) {
        props.startAt = raw.startAt;
      }
      return props;
    },
  },
  driveAudio: {
    allowsContent: false,
    sanitizeProps: (raw) => {
      if (!isDriveId(raw.fileId)) return null;
      const props: Props = { fileId: raw.fileId };
      const title = sanitizeStringProp(raw.title, MAX_BLOCK_STRING_PROP_CHARS);
      if (title) props.title = title;
      const artist = sanitizeStringProp(raw.artist, MAX_BLOCK_STRING_PROP_CHARS);
      if (artist) props.artist = artist;
      return props;
    },
  },
  animeCard: {
    allowsContent: false,
    sanitizeProps: (raw) => {
      const title = sanitizeStringProp(raw.title, MAX_ANIME_CARD_TITLE_CHARS);
      if (!title) return null;
      const props: Props = { title };
      const coverUrl = sanitizeHttpsUrl(raw.coverUrl, 2048);
      if (coverUrl) props.coverUrl = coverUrl;
      if (isDriveId(raw.coverFileId)) props.coverFileId = raw.coverFileId;
      if (typeof raw.year === "number" && raw.year >= 1900 && raw.year <= 2200) {
        props.year = raw.year;
      }
      if (
        typeof raw.episodes === "number" &&
        raw.episodes >= 0 &&
        raw.episodes <= 100_000
      ) {
        props.episodes = raw.episodes;
      }
      if (typeof raw.score === "number" && raw.score >= 0 && raw.score <= 10) {
        props.score = raw.score;
      }
      if (typeof raw.status === "string" && ANIME_STATUSES.has(raw.status)) {
        props.status = raw.status;
      }
      const link = sanitizeHttpsUrl(raw.link, 2048);
      if (link) props.link = link;
      return props;
    },
  },
  rating: {
    allowsContent: false,
    sanitizeProps: (raw) => {
      if (
        typeof raw.value !== "number" ||
        raw.value < 0 ||
        raw.value > 10 ||
        !Number.isFinite(raw.value)
      ) {
        return null;
      }
      const props: Props = {
        value: Math.round(raw.value * 2) / 2,
        style:
          typeof raw.style === "string" && RATING_STYLES.has(raw.style)
            ? raw.style
            : "stars",
      };
      const label = sanitizeStringProp(raw.label, MAX_BLOCK_STRING_PROP_CHARS);
      if (label) props.label = label;
      return props;
    },
  },
  spoiler: {
    allowsContent: false,
    sanitizeProps: (raw) => {
      const props: Props = {};
      const label = sanitizeStringProp(raw.label, MAX_BLOCK_STRING_PROP_CHARS);
      if (label) props.label = label;
      return props;
    },
  },
};

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function sanitizeStringProp(
  value: unknown,
  maxChars: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxChars);
}

function sanitizeHttpsUrl(
  value: unknown,
  maxChars: number,
): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isNonEmptyText(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxChars
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

// ---------------------------------------------------------------------------
// Excerpt derivation
// ---------------------------------------------------------------------------

const TEXT_BEARING_TYPES = new Set<PostBlockType>([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "callout",
]);

/** Plain-text excerpt for feed cards, derived from the first text-bearing
 *  blocks (depth-first, skipping media/spoiler blocks) up to
 *  MAX_POST_EXCERPT_CHARS. Pure — callers persist the result on the
 *  announcement, they don't re-derive it on every feed render. */
export function derivePostExcerpt(blocks: PostBlock[]): string | undefined {
  const parts: string[] = [];
  let total = 0;

  const visit = (list: PostBlock[]) => {
    for (const block of list) {
      if (total >= MAX_POST_EXCERPT_CHARS) return;
      if (TEXT_BEARING_TYPES.has(block.type) && block.content) {
        const text = block.content
          .map((run) => (run.type === "text" ? run.text : plainTextOfLink(run)))
          .join("")
          .trim();
        if (text) {
          parts.push(text);
          total += text.length;
        }
      }
      if (block.type !== "spoiler" && block.children) visit(block.children);
    }
  };
  visit(blocks);

  if (parts.length === 0) return undefined;
  return parts.join(" ").slice(0, MAX_POST_EXCERPT_CHARS).trim() || undefined;
}

function plainTextOfLink(run: PostInline): string {
  if (run.type !== "link") return "";
  return run.content.map((t) => t.text).join("");
}
