/**
 * Tracks the block the cursor/selection is currently in, so the inspector
 * rail can show and edit its props. Subscribes to both
 * `onSelectionChange` (cursor moved) and `onChange` (props/content edited,
 * including by the inspector itself) — without the second subscription the
 * rail's own edits wouldn't be reflected back into its controls.
 */

import { useEffect, useState } from "react";
import type { PostEditor, PostEditorBlock } from "../post-editor-schema";

export function useSelectedBlock(editor: PostEditor): PostEditorBlock | null {
  const [block, setBlock] = useState<PostEditorBlock | null>(null);

  useEffect(() => {
    const read = () => {
      try {
        const selected = editor.getSelection()?.blocks;
        if (selected && selected.length > 0) {
          setBlock(selected[0]);
          return;
        }
        setBlock(editor.getTextCursorPosition().block);
      } catch {
        setBlock(null);
      }
    };
    read();
    const unsubSelection = editor.onSelectionChange(read);
    const unsubChange = editor.onChange(read);
    return () => {
      unsubSelection?.();
      unsubChange?.();
    };
  }, [editor]);

  return block;
}
