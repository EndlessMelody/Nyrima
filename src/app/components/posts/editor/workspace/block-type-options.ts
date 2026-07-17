/** Shared block-type metadata for the inspector's type switcher and the
 *  lossy-conversion check. Kept separate from `BlockTypeSwitcher.tsx` so
 *  `isLossyConversion` can be unit-tested without pulling in React. */

import {
  Pilcrow,
  Heading,
  List,
  ListOrdered,
  ListChecks,
  Quote as QuoteIcon,
  Code2,
  MessageSquareText,
  Image,
  Link2,
  EyeOff,
  Star,
  Film,
  Music,
  Sparkles,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import type { PostBlock, PostBlockType } from "@shared/post-types";

/** Named color tokens BlockNote's inline styles accept (see
 *  `resolveColor` in renderer/colors.ts) — shared by the Block tab's
 *  text/background color pickers and the Document tab's accent picker so
 *  there's one canonical swatch list, not two. "pink" is deliberately
 *  excluded here (9 swatches incl. "default" fits the 300px rail's
 *  swatch row in one line without wrapping; 10 doesn't, and pink sits
 *  closest to the app's own reserved neon-pink brand accent anyway) —
 *  `resolveColor`/the sanitizer still recognize it for posts saved before
 *  this change, it's just not offered as a new pick. */
export const COLOR_NAMES = [
  "default",
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
];

export type ContentKind = "inline" | "none";

export const CONTENT_KIND: Record<PostBlockType, ContentKind> = {
  paragraph: "inline",
  heading: "inline",
  bulletListItem: "inline",
  numberedListItem: "inline",
  checkListItem: "inline",
  quote: "inline",
  codeBlock: "inline",
  callout: "inline",
  driveImage: "none",
  driveVideo: "none",
  driveAudio: "none",
  animeCard: "none",
  rating: "none",
  spoiler: "none",
  linkCard: "none",
  unsupported: "none",
};

export interface TypeOption {
  type: PostBlockType;
  label: string;
  /** Extra props merged into the fresh prop bag on conversion (e.g. heading level). */
  extraProps?: Record<string, string | number | boolean>;
}

export const BLOCK_TYPE_OPTIONS: TypeOption[] = [
  { type: "paragraph", label: "Text" },
  { type: "heading", label: "Heading 1", extraProps: { level: 1 } },
  { type: "heading", label: "Heading 2", extraProps: { level: 2 } },
  { type: "heading", label: "Heading 3", extraProps: { level: 3 } },
  { type: "bulletListItem", label: "Bulleted list" },
  { type: "numberedListItem", label: "Numbered list" },
  { type: "checkListItem", label: "Checklist" },
  { type: "quote", label: "Quote" },
  { type: "codeBlock", label: "Code" },
  { type: "callout", label: "Callout" },
  { type: "driveImage", label: "Image" },
  { type: "linkCard", label: "Link card" },
  { type: "spoiler", label: "Spoiler" },
  { type: "rating", label: "Rating" },
];

/** Fresh, sanitizer-matching default props for a type — always passed
 *  explicitly on conversion instead of letting BlockNote carry over
 *  same-named props from the old type. */
export function freshPropsFor(option: TypeOption): Record<string, string | number | boolean> {
  const base: Record<string, Record<string, string | number | boolean>> = {
    paragraph: {},
    heading: { level: 1 },
    bulletListItem: {},
    numberedListItem: {},
    checkListItem: { checked: false },
    quote: {},
    codeBlock: {},
    callout: { tone: "info" },
    driveImage: { fileId: "", caption: "", width: "wide", align: "center" },
    linkCard: { url: "", title: "", description: "", imageUrl: "", siteName: "", fetched: false },
    spoiler: { label: "" },
    rating: { value: 0, style: "stars", label: "" },
  };
  return { ...(base[option.type] ?? {}), ...option.extraProps };
}

/** Single label per type (not per switcher variant — heading collapses to
 *  one label regardless of level) — used by the structure rail's block
 *  list and the document stats breakdown. */
export const BLOCK_TYPE_LABEL: Record<PostBlockType, string> = {
  paragraph: "Text",
  heading: "Heading",
  bulletListItem: "Bulleted list",
  numberedListItem: "Numbered list",
  checkListItem: "Checklist",
  quote: "Quote",
  codeBlock: "Code",
  callout: "Callout",
  driveImage: "Image",
  driveVideo: "Video",
  driveAudio: "Audio",
  animeCard: "Anime card",
  rating: "Rating",
  spoiler: "Spoiler",
  linkCard: "Link card",
  unsupported: "Unsupported",
};

export const BLOCK_TYPE_ICON: Record<PostBlockType, LucideIcon> = {
  paragraph: Pilcrow,
  heading: Heading,
  bulletListItem: List,
  numberedListItem: ListOrdered,
  checkListItem: ListChecks,
  quote: QuoteIcon,
  codeBlock: Code2,
  callout: MessageSquareText,
  driveImage: Image,
  driveVideo: Film,
  driveAudio: Music,
  animeCard: Sparkles,
  rating: Star,
  spoiler: EyeOff,
  linkCard: Link2,
  unsupported: HelpCircle,
};

export function isLossyConversion(block: PostBlock, target: PostBlockType): boolean {
  if (block.type === target) return false;
  const fromKind = CONTENT_KIND[block.type];
  const toKind = CONTENT_KIND[target];
  const hasText =
    fromKind === "inline" &&
    !!block.content?.some((run) =>
      run.type === "text" ? run.text.trim().length > 0 : run.content.length > 0,
    );
  const losesText = hasText && toKind === "none";
  const losesMedia =
    (block.type === "driveImage" && !!block.props.fileId) ||
    (block.type === "linkCard" && !!block.props.url);
  return losesText || losesMedia;
}
