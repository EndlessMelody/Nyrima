/**
 * Reader-facing jump-to-heading table of contents, shown when
 * `PostDoc.showToc` is set. Walks the same heading data the editor's
 * `StructureRail` outline uses, but duplicated here (not imported from
 * `editor/workspace/block-outline.ts`) so this renderer-side file stays
 * decoupled from the editor's folder — see `PostRenderer.tsx`'s "zero
 * BlockNote imports" note; this keeps the reader path independent of
 * editor-only code, not just editor-only *packages*.
 */

import type { PostBlock } from "@shared/post-types";
import { plainTextOf } from "./InlineContentRenderer";
import "./PostRenderer.scss";

interface HeadingEntry {
  id: string;
  level: number;
  text: string;
}

function collectHeadings(blocks: PostBlock[]): HeadingEntry[] {
  const entries: HeadingEntry[] = [];
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

export function TableOfContents({ blocks }: { blocks: PostBlock[] }) {
  const headings = collectHeadings(blocks);
  if (headings.length === 0) return null;

  return (
    <nav className="ny-post-toc" aria-label="Table of contents">
      <span className="ny-post-toc__label">Contents</span>
      <ol>
        {headings.map((h) => (
          <li key={h.id} style={{ paddingLeft: (h.level - 1) * 12 }}>
            <a href={`#${h.id}`}>{h.text || "Untitled heading"}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
