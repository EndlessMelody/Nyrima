/** Pure helpers for the left structure rail — no React, no BlockNote. */

import type { PostBlock, PostBlockType } from "@shared/post-types";
import { plainTextOf } from "../../renderer/InlineContentRenderer";
import { BLOCK_TYPE_LABEL } from "./block-type-options";

export interface HeadingOutlineEntry {
  id: string;
  level: number;
  text: string;
}

/** Headings only, depth-first, hierarchical by level. */
export function collectHeadingOutline(blocks: PostBlock[]): HeadingOutlineEntry[] {
  const entries: HeadingOutlineEntry[] = [];
  const visit = (list: PostBlock[]) => {
    for (const block of list) {
      if (block.type === "heading") {
        const level = typeof block.props.level === "number" ? block.props.level : 1;
        entries.push({ id: block.id, level, text: plainTextOf(block.content) });
      }
      if (block.children) visit(block.children);
    }
  };
  visit(blocks);
  return entries;
}

export interface BlockListEntry {
  id: string;
  type: PostBlockType;
  label: string;
}

const MAX_LABEL_CHARS = 40;

/** Top-level blocks only (no recursion into children — list items and
 *  spoiler bodies would make the minimap unreadably long). Text-bearing
 *  blocks show a truncated content preview; everything else falls back
 *  to its type label. */
export function collectBlockList(blocks: PostBlock[]): BlockListEntry[] {
  return blocks.map((block) => {
    const text = block.content ? plainTextOf(block.content).trim() : "";
    const label = text ? text.slice(0, MAX_LABEL_CHARS) : BLOCK_TYPE_LABEL[block.type];
    return { id: block.id, type: block.type, label };
  });
}
