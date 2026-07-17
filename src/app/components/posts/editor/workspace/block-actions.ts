/**
 * Shared block mutations for the custom side-menu toolbar (`PostSideMenu`)
 * and the inspector's block-actions row (`BlockInspector`) — one place for
 * "what does duplicate/delete actually do" instead of two.
 */

import type { PostEditor, PostEditorBlock } from "../post-editor-schema";

/** Inserts a copy of `block` right after itself. Omits `id` so BlockNote
 *  generates a fresh one — never reuse the source block's id. */
export function duplicateBlock(editor: PostEditor, block: PostEditorBlock): void {
  editor.insertBlocks(
    [
      {
        type: block.type,
        props: block.props,
        content: block.content,
        children: block.children,
      } as never,
    ],
    block,
    "after",
  );
}

export function deleteBlock(editor: PostEditor, block: PostEditorBlock): void {
  editor.removeBlocks([block]);
}
