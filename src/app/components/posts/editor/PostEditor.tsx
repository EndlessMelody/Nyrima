/**
 * Thin BlockNote wrapper for authoring a post.
 *
 * Presentational-ish: owns the BlockNote editor instance, the
 * `driveImage` custom block's context (Drive picker dialog + upload), and
 * reports every change upward via `onBlocksChange`. It does NOT own the
 * autosave debounce or the `savePost` call — `PostEditorPage` combines
 * this component's block changes with title/tag edits into one debounced
 * save, so there's a single save pipeline instead of two independently
 * debounced writers racing each other.
 *
 * `editor.document` already matches `PostBlock[]`'s wire shape (see
 * `post-types.ts`), but it's still run through `sanitizePostDoc`'s block
 * sanitizer before being reported — the editor schema is constrained to
 * only produce sanitizer-whitelisted shapes, but sanitizing here as well
 * costs nothing and is the same defence-in-depth posture as everywhere
 * else untrusted-shaped data crosses a boundary.
 */

import { useEffect, useMemo, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import type { DriveFile } from "@shared/types";
import type { PostBlock } from "@shared/post-types";
import { uploadImageAsset } from "../../../services/posts";
import { DriveFilePicker } from "../DriveFilePicker";
import { postEditorSchema } from "./post-editor-schema";
import { PostEditorContext, type PostEditorContextValue } from "./post-editor-context";
import { nyrimaBlockNoteTheme } from "./blocknote-theme";
import "./PostEditor.scss";

interface Props {
  postFolderId: string;
  /** Sanitized blocks from the loaded doc. Only read on mount — BlockNote
   *  owns the live document after that, same as any uncontrolled rich-text
   *  editor. */
  initialBlocks: PostBlock[];
  onBlocksChange: (blocks: PostBlock[]) => void;
}

export function PostEditor({ postFolderId, initialBlocks, onBlocksChange }: Props) {
  const editor = useCreateBlockNote({
    schema: postEditorSchema,
    initialContent:
      initialBlocks.length > 0
        ? (initialBlocks as never)
        : [{ type: "paragraph", props: {}, content: [] } as never],
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerResolve, setPickerResolve] = useState<
    ((file: DriveFile | null) => void) | null
  >(null);

  useEffect(() => {
    const unsubscribe = editor.onChange((ed) => {
      onBlocksChange(ed.document as unknown as PostBlock[]);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const contextValue = useMemo<PostEditorContextValue>(
    () => ({
      postFolderId,
      pickDriveImage: () =>
        new Promise<DriveFile | null>((resolve) => {
          setPickerResolve(() => resolve);
          setPickerOpen(true);
        }),
      uploadImage: (file: File) => uploadImageAsset(postFolderId, file),
    }),
    [postFolderId],
  );

  function closePicker(file: DriveFile | null) {
    setPickerOpen(false);
    pickerResolve?.(file);
    setPickerResolve(null);
  }

  return (
    <PostEditorContext.Provider value={contextValue}>
      <div className="ny-post-editor">
        <BlockNoteView editor={editor} theme={nyrimaBlockNoteTheme} />
      </div>
      <DriveFilePicker
        isOpen={pickerOpen}
        onClose={() => closePicker(null)}
        onPick={(file) => closePicker(file)}
      />
    </PostEditorContext.Provider>
  );
}
