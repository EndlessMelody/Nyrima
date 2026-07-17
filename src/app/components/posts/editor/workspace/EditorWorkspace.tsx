/**
 * The post editor's fullscreen workspace shell — a Jupyter-notebook ×
 * Docs hybrid. Owns the shared BlockNote editor instance (top bar,
 * left structure rail, canvas, and right inspector rail all read/write
 * the same instance instead of each mounting their own), the edit/preview
 * mode, both rails' open state, and the `driveImage` Drive-picker dialog
 * that used to live in `PostEditor.tsx`.
 *
 * All block mutations — typing, drag-reorder, and inspector edits alike —
 * flow through the one `editor.onChange` subscription into
 * `onBlocksChange`, so `PostEditorPage`'s single debounced autosave
 * pipeline stays the only save path (see that file's module doc).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import type { DriveFile } from "@shared/types";
import type { PostBlock, PostDoc } from "@shared/post-types";
import { uploadImageAsset, derivePostStats } from "../../../../services/posts";
import { fontStackFor } from "../../post-fonts";
import { DriveFilePicker } from "../../DriveFilePicker";
import { postEditorSchema } from "../post-editor-schema";
import { PostEditorContext, type PostEditorContextValue } from "../post-editor-context";
import { PostEditorSurface } from "../PostEditor";
import { EditorTopBar, type EditorMode, type SaveState } from "./EditorTopBar";
import { EditorPreview } from "./EditorPreview";
import { InspectorRail, type RailTab } from "./InspectorRail";
import { StructureRail } from "./StructureRail";
import { useSelectedBlock } from "./useSelectedBlock";
import "./EditorWorkspace.scss";

interface Props {
  doc: PostDoc;
  saveState: SaveState;
  localOnly: boolean;
  publishError: string | null;
  onTitleChange: (title: string) => void;
  onBlocksChange: (blocks: PostBlock[]) => void;
  onDocPatch: (patch: Partial<PostDoc>) => void;
  ensureFolderId: () => Promise<string>;
  onPublishClick: () => void;
  publishLabel: string;
  publishDisabled: boolean;
  onBack: () => void;
}

export function EditorWorkspace({
  doc,
  saveState,
  localOnly,
  publishError,
  onTitleChange,
  onBlocksChange,
  onDocPatch,
  ensureFolderId,
  onPublishClick,
  publishLabel,
  publishDisabled,
  onBack,
}: Props) {
  const editor = useCreateBlockNote({
    schema: postEditorSchema,
    initialContent:
      doc.blocks.length > 0
        ? (doc.blocks as never)
        : [{ type: "paragraph", props: {}, content: [] } as never],
  });

  const [mode, setMode] = useState<EditorMode>("edit");
  const [railOpen, setRailOpen] = useState(true);
  const [leftRailOpen, setLeftRailOpen] = useState(true);
  const [railTab, setRailTab] = useState<RailTab>("block");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerResolve, setPickerResolve] = useState<
    ((file: DriveFile | null) => void) | null
  >(null);

  const selectedBlock = useSelectedBlock(editor);
  const stats = useMemo(() => derivePostStats(doc.blocks), [doc.blocks]);

  useEffect(() => {
    const unsubscribe = editor.onChange((ed) => {
      onBlocksChange(ed.document as unknown as PostBlock[]);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Restrained "Jupyter cell" affordance: only the selected top-level block
  // gets a persistent brand hairline — a class toggle on BlockNote's own
  // DOM, not a re-render, so it's cheap and doesn't fight ProseMirror.
  useEffect(() => {
    const nodes = document.querySelectorAll(".ny-post-editor .bn-block-outer.ny-cell-active");
    nodes.forEach((n) => n.classList.remove("ny-cell-active"));
    if (!selectedBlock) return;
    const el = document.querySelector(`.ny-post-editor [data-id="${selectedBlock.id}"]`);
    const outer = el?.closest(".bn-block-outer");
    outer?.classList.add("ny-cell-active");
  }, [selectedBlock]);

  // Per-block font overrides (doc.blockFonts) aren't BlockNote props — they
  // don't survive a NodeView remount on their own, so re-apply them as
  // plain inline styles on the block's DOM whenever the map or the
  // document changes (same side-channel-styling approach as ny-cell-active
  // above).
  useEffect(() => {
    const styled = document.querySelectorAll(".ny-post-editor [data-ny-font-applied]");
    styled.forEach((el) => {
      const node = el as HTMLElement;
      node.style.fontFamily = "";
      node.style.fontSize = "";
      node.removeAttribute("data-ny-font-applied");
    });
    for (const [id, font] of Object.entries(doc.blockFonts ?? {})) {
      const el = document.querySelector(`.ny-post-editor [data-id="${id}"]`) as HTMLElement | null;
      if (!el) continue;
      if (font.family) el.style.fontFamily = fontStackFor(font.family) ?? "";
      if (font.size) el.style.fontSize = `${font.size}px`;
      el.setAttribute("data-ny-font-applied", "");
    }
  }, [doc.blockFonts, doc.blocks]);

  const contextValue = useMemo<PostEditorContextValue>(
    () => ({
      pickDriveImage: () =>
        new Promise<DriveFile | null>((resolve) => {
          setPickerResolve(() => resolve);
          setPickerOpen(true);
        }),
      uploadImage: async (file: File) => {
        const folderId = await ensureFolderId();
        return uploadImageAsset(folderId, file);
      },
    }),
    [ensureFolderId],
  );

  function closePicker(file: DriveFile | null) {
    setPickerOpen(false);
    pickerResolve?.(file);
    setPickerResolve(null);
  }

  function handleTitleEnter() {
    const first = editor.document[0];
    if (!first) return;
    editor.setTextCursorPosition(first.id, "start");
    editor.focus();
  }

  const handleOutlineClick = useCallback(
    (blockId: string) => {
      if (mode === "preview") {
        document.getElementById(blockId)?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      editor.setTextCursorPosition(blockId, "start");
      editor.focus();
      document
        .querySelector(`.ny-post-editor [data-id="${blockId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [editor, mode],
  );

  function handleAddBlock() {
    const blocks = editor.document;
    const last = blocks[blocks.length - 1];
    if (!last) return;
    const inserted = editor.insertBlocks([{ type: "paragraph" } as never], last, "after");
    const newBlock = inserted[0];
    if (newBlock) {
      editor.setTextCursorPosition(newBlock.id, "start");
      editor.focus();
    }
  }

  return (
    <PostEditorContext.Provider value={contextValue}>
      <div className="ny-editor-workspace">
        <EditorTopBar
          title={doc.title}
          onTitleChange={onTitleChange}
          onTitleEnter={handleTitleEnter}
          saveState={saveState}
          localOnly={localOnly}
          stats={stats}
          mode={mode}
          onModeChange={setMode}
          publishLabel={publishLabel}
          publishDisabled={publishDisabled}
          onPublishClick={onPublishClick}
          railOpen={railOpen}
          onToggleRail={() => setRailOpen((v) => !v)}
          leftRailOpen={leftRailOpen}
          onToggleLeftRail={() => setLeftRailOpen((v) => !v)}
          onBack={onBack}
        />

        {publishError && (
          <div className="ny-editor-workspace__error">{publishError}</div>
        )}

        <div className="ny-editor-workspace__body">
          <StructureRail
            open={leftRailOpen}
            blocks={doc.blocks}
            selectedBlockId={selectedBlock?.id ?? null}
            stats={stats}
            onEntryClick={handleOutlineClick}
          />

          <div className="ny-editor-workspace__canvas">
            <div className="ny-editor-workspace__scroll">
              <PostEditorSurface editor={editor} hidden={mode === "preview"} />
              {mode === "edit" && (
                <button type="button" className="ny-editor-workspace__add-block" onClick={handleAddBlock}>
                  + Add block
                </button>
              )}
              {mode === "preview" && <EditorPreview doc={doc} />}
            </div>
          </div>

          <InspectorRail
            open={railOpen}
            editor={editor}
            tab={railTab}
            onTabChange={setRailTab}
            selectedBlock={selectedBlock}
            mode={mode}
            doc={doc}
            stats={stats}
            onDocPatch={onDocPatch}
            onOpenPublish={onPublishClick}
          />
        </div>
      </div>

      <DriveFilePicker
        isOpen={pickerOpen}
        onClose={() => closePicker(null)}
        onPick={(file) => closePicker(file)}
      />
    </PostEditorContext.Provider>
  );
}
