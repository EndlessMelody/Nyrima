/**
 * Thin BlockNote surface — renders the shared editor instance (owned by
 * `EditorWorkspace`) plus the custom slash menu and side menu. Split out
 * from the workspace so the `BlockNoteView` mount/theme wiring stays in
 * one small, easily-testable component instead of tangled into the top
 * bar/inspector layout code.
 */

import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { SuggestionMenuController } from "@blocknote/react";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import { getCustomSlashMenuItems } from "./slash-menu-items";
import { nyrimaBlockNoteTheme } from "./blocknote-theme";
import { PostSideMenuController } from "./PostSideMenuController";
import type { PostEditor as PostEditorInstance } from "./post-editor-schema";
import "./PostEditor.scss";

interface Props {
  editor: PostEditorInstance;
  hidden?: boolean;
}

export function PostEditorSurface({ editor, hidden }: Props) {
  return (
    <div className="ny-post-editor" style={hidden ? { display: "none" } : undefined}>
      <BlockNoteView editor={editor} theme={nyrimaBlockNoteTheme} slashMenu={false} sideMenu={false}>
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(getCustomSlashMenuItems(editor), query)
          }
        />
        <PostSideMenuController />
      </BlockNoteView>
    </div>
  );
}
