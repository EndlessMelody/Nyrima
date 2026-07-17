/**
 * Right-hand inspector rail — "Block" (selected block's props) and
 * "Document" (tags/cover/visibility) tabs, Photoshop-panel style. The
 * Block tab is disabled in preview mode since there's no live BlockNote
 * selection to edit against.
 */

import type { PostDoc } from "@shared/post-types";
import type { PostStats } from "../../../../services/posts";
import type { PostEditor, PostEditorBlock } from "../post-editor-schema";
import { BlockInspector } from "./BlockInspector";
import { DocumentInspector } from "./DocumentInspector";
import "./InspectorRail.scss";

export type RailTab = "block" | "document";

interface Props {
  open: boolean;
  editor: PostEditor;
  tab: RailTab;
  onTabChange: (tab: RailTab) => void;
  selectedBlock: PostEditorBlock | null;
  mode: "edit" | "preview";
  doc: PostDoc;
  stats: PostStats;
  onDocPatch: (patch: Partial<PostDoc>) => void;
  onOpenPublish: () => void;
}

export function InspectorRail({
  open,
  editor,
  tab,
  onTabChange,
  selectedBlock,
  mode,
  doc,
  stats,
  onDocPatch,
  onOpenPublish,
}: Props) {
  return (
    <aside className={open ? "ny-inspector-rail" : "ny-inspector-rail is-closed"} aria-hidden={!open}>
      <div className="ny-inspector-rail__tabs">
        <button
          type="button"
          className={tab === "block" ? "is-active" : ""}
          disabled={mode === "preview"}
          onClick={() => onTabChange("block")}
        >
          Block
        </button>
        <button
          type="button"
          className={tab === "document" ? "is-active" : ""}
          onClick={() => onTabChange("document")}
        >
          Document
        </button>
      </div>
      <div className="ny-inspector-rail__body">
        {tab === "block" &&
          (mode === "preview" ? (
            <div className="ny-inspector-empty">Switch to Edit to modify blocks.</div>
          ) : selectedBlock ? (
            <BlockInspector
              editor={editor}
              block={selectedBlock}
              doc={doc}
              onDocPatch={onDocPatch}
            />
          ) : (
            <div className="ny-inspector-empty">Click a block to edit it.</div>
          ))}
        {tab === "document" && (
          <DocumentInspector doc={doc} stats={stats} onDocPatch={onDocPatch} onOpenPublish={onOpenPublish} />
        )}
      </div>
    </aside>
  );
}
