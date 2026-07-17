/**
 * Left structure rail — always-visible document navigation, mirroring the
 * right inspector's glassy panel look. Two sections: a heading outline
 * (hierarchical) and a flat block list/minimap (every top-level block),
 * both clickable to jump. Complements the right rail's per-block editing
 * with per-document navigation.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { PostBlock } from "@shared/post-types";
import type { PostStats } from "../../../../services/posts";
import { BLOCK_TYPE_ICON } from "./block-type-options";
import { collectBlockList, collectHeadingOutline } from "./block-outline";
import "./StructureRail.scss";

interface Props {
  open: boolean;
  blocks: PostBlock[];
  selectedBlockId: string | null;
  stats: PostStats;
  onEntryClick: (blockId: string) => void;
}

export function StructureRail({ open, blocks, selectedBlockId, stats, onEntryClick }: Props) {
  const [query, setQuery] = useState("");
  const outline = collectHeadingOutline(blocks);
  const blockList = collectBlockList(blocks);

  const q = query.trim().toLowerCase();
  const filteredOutline = q ? outline.filter((h) => h.text.toLowerCase().includes(q)) : outline;
  const filteredBlockList = q ? blockList.filter((b) => b.label.toLowerCase().includes(q)) : blockList;

  const typeCounts = useMemo(() => {
    const entries = Object.entries(stats.counts) as [string, number][];
    return entries.filter(([, count]) => count > 0);
  }, [stats.counts]);

  return (
    <aside className={open ? "ny-structure-rail" : "ny-structure-rail is-closed"} aria-hidden={!open}>
      {typeCounts.length > 0 && (
        <div className="ny-structure-rail__stats">
          <span>
            {stats.words} word{stats.words === 1 ? "" : "s"} · {stats.minutes} min read
          </span>
          <div className="ny-structure-rail__stats-bar">
            {typeCounts.map(([type, count]) => (
              <span
                key={type}
                className="ny-structure-rail__stats-segment"
                style={{ flexGrow: count }}
                title={`${count} ${type}`}
              />
            ))}
          </div>
        </div>
      )}

      <div className="ny-structure-rail__search">
        <Search size={13} />
        <input
          type="text"
          placeholder="Filter outline…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="ny-structure-rail__section">
        <span className="ny-structure-rail__heading">Outline</span>
        {filteredOutline.length === 0 ? (
          <div className="ny-structure-rail__empty">
            {outline.length === 0 ? "No headings yet." : "No matches."}
          </div>
        ) : (
          <div className="ny-structure-rail__list">
            {filteredOutline.map((h) => (
              <button
                key={h.id}
                type="button"
                className="ny-structure-rail__item"
                style={{ paddingLeft: 10 + (h.level - 1) * 12 }}
                onClick={() => onEntryClick(h.id)}
              >
                {h.text || "Untitled heading"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ny-structure-rail__section">
        <span className="ny-structure-rail__heading">Blocks</span>
        <div className="ny-structure-rail__list">
          {filteredBlockList.map((b, i) => {
            const Icon = BLOCK_TYPE_ICON[b.type];
            return (
              <button
                key={b.id}
                type="button"
                className={
                  b.id === selectedBlockId
                    ? "ny-structure-rail__item is-active"
                    : "ny-structure-rail__item"
                }
                onClick={() => onEntryClick(b.id)}
              >
                <span className="ny-structure-rail__item-index">{i + 1}</span>
                <Icon size={13} className="ny-structure-rail__item-icon" />
                <span className="ny-structure-rail__item-label">{b.label || "Empty block"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
