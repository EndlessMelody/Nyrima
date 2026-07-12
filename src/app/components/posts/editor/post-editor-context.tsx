/**
 * Context that gives custom block renderers (currently just
 * `DriveImageBlock`) access to the post's folder id and the two ways to
 * add media without threading props through BlockNote's own render props.
 *
 * `pickDriveImage` is imperative-from-deep-in-the-tree: `PostEditor` owns
 * the `DriveFilePicker` dialog's open/closed state and resolves this
 * promise when the user picks a file (or cancels).
 */

import { createContext, useContext } from "react";
import type { DriveFile } from "@shared/types";

export interface PostEditorContextValue {
  postFolderId: string;
  /** Opens the Drive file picker and resolves with the chosen file, or
   *  null if the user cancels. */
  pickDriveImage: () => Promise<DriveFile | null>;
  /** Uploads a local file into the post's `assets/` folder. */
  uploadImage: (file: File) => Promise<DriveFile>;
}

export const PostEditorContext = createContext<PostEditorContextValue | null>(
  null,
);

export function usePostEditorContext(): PostEditorContextValue {
  const ctx = useContext(PostEditorContext);
  if (!ctx) {
    throw new Error("usePostEditorContext must be used inside <PostEditor>.");
  }
  return ctx;
}
