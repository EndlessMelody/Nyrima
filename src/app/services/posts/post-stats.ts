/**
 * Word count / reading-time estimate for the editor's top bar. Same
 * depth-first block walk as `derivePostExcerpt` (post-doc.ts), but
 * exhaustive — it includes `spoiler` children, since the author is reading
 * their own draft, not a stranger's excerpt — and counts instead of
 * concatenating.
 */

import type { PostBlock, PostBlockType, PostInline } from "@shared/post-types";

const WORDS_PER_MINUTE = 200;
const SECONDS_PER_MEDIA_BLOCK = 10;

export interface PostStats {
  words: number;
  minutes: number;
  /** Block count by type, depth-first (includes nested/children blocks) —
   *  feeds the Document tab's stats breakdown. */
  counts: Partial<Record<PostBlockType, number>>;
}

export function derivePostStats(blocks: PostBlock[]): PostStats {
  let words = 0;
  let media = 0;
  const counts: Partial<Record<PostBlockType, number>> = {};

  const visit = (list: PostBlock[]) => {
    for (const block of list) {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
      if (block.content) {
        for (const run of block.content) {
          words += countWords(run.type === "text" ? run.text : plainTextOfLink(run));
        }
      }
      if (block.type === "driveImage" || block.type === "linkCard") media += 1;
      if (block.children) visit(block.children);
    }
  };
  visit(blocks);

  const minutes = Math.max(
    1,
    Math.ceil(words / WORDS_PER_MINUTE + (media * SECONDS_PER_MEDIA_BLOCK) / 60),
  );
  return { words, minutes, counts };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function plainTextOfLink(run: PostInline): string {
  if (run.type !== "link") return "";
  return run.content.map((t) => t.text).join("");
}
