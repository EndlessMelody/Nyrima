/**
 * Custom BlockNote side menu — replaces the bare 6-dot drag handle with a
 * small toolbar: drag, a type-icon badge, duplicate, delete. Delete
 * already existed in BlockNote (hidden behind the drag handle's
 * click-menu, `RemoveBlockItem`); this promotes it (and adds duplicate)
 * to one-click icons instead.
 *
 * Built directly on BlockNote's internal `SideMenuExtension` — the same
 * hooks (`useExtension`, `useExtensionState`) its own `DragHandleButton`
 * uses internally (see `@blocknote/react/src/components/SideMenu/
 * DefaultButtons/DragHandleButton.tsx`). This is BlockNote-internal, not
 * documented public API: re-verify against this file first on any
 * `@blocknote/*` major version bump.
 */

import { useBlockNoteEditor, useExtension, useExtensionState } from "@blocknote/react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { GripVertical, Copy, Trash2 } from "lucide-react";
import type { PostBlock } from "@shared/post-types";
import type { PostEditor, PostEditorBlock } from "./post-editor-schema";
import { BLOCK_TYPE_ICON, BLOCK_TYPE_LABEL } from "./workspace/block-type-options";
import { duplicateBlock, deleteBlock } from "./workspace/block-actions";

export function PostSideMenu() {
  const editor = useBlockNoteEditor() as unknown as PostEditor;
  const sideMenu = useExtension(SideMenuExtension);
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  }) as PostEditorBlock | undefined;

  if (!block) return null;
  const postBlock = block as unknown as PostBlock;
  const TypeIcon = BLOCK_TYPE_ICON[postBlock.type];

  return (
    <div
      className="ny-block-toolbar"
      contentEditable={false}
      // BlockNote decides which block is "hovered" (and thus whether this
      // toolbar should render at all) from raw mouse-coordinate -> block
      // resolution, which can momentarily miss at row boundaries/gaps
      // between blocks. Freezing on enter pins the menu to this block
      // regardless of further coordinate resolution while the cursor is
      // anywhere inside the toolbar's own (reliable) hitbox, and
      // unfreezing on leave hands control back to the normal hover logic.
      onMouseEnter={() => sideMenu.freezeMenu()}
      onMouseLeave={() => sideMenu.unfreezeMenu()}
    >
      <button
        type="button"
        className="ny-block-toolbar__drag"
        aria-label="Drag to reorder"
        draggable
        onDragStart={(e) => sideMenu.blockDragStart(e, block)}
        onDragEnd={sideMenu.blockDragEnd}
      >
        <GripVertical size={14} />
      </button>
      <span className="ny-block-toolbar__type" title={BLOCK_TYPE_LABEL[postBlock.type]}>
        <TypeIcon size={13} />
      </span>
      <button
        type="button"
        className="ny-block-toolbar__action"
        aria-label="Duplicate block"
        onClick={() => duplicateBlock(editor, block)}
      >
        <Copy size={13} />
      </button>
      <button
        type="button"
        className="ny-block-toolbar__action"
        aria-label="Delete block"
        onClick={() => deleteBlock(editor, block)}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
