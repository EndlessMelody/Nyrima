/**
 * Context that gives custom block renderers (currently just
 * `DriveImageBlock`) the two ways to add media, without threading props
 * through BlockNote's own render props.
 *
 * `pickDriveImage` is imperative-from-deep-in-the-tree: `PostEditor` owns
 * the `DriveFilePicker` dialog's open/closed state and resolves this
 * promise when the user picks a file (or cancels).
 *
 * There's no plain `postFolderId` here on purpose: a post is local-only
 * (post-local-draft.ts) until something needs real Drive storage, and an
 * *uploaded* image is exactly that trigger. `uploadImage` resolves the
 * real folder id lazily via `PostEditorPage`'s `ensureFolderId`, promoting
 * the post to Drive on first use if it hasn't been already. "Choose from
 * Drive" needs no folder at all — it references an existing file in place.
 */

import { createContext, useContext } from "react";
import type { DriveFile } from "@shared/types";

export interface PostEditorContextValue {
  /** Opens the Drive file picker and resolves with the chosen file, or
   *  null if the user cancels. */
  pickDriveImage: () => Promise<DriveFile | null>;
  /** Uploads a local file into the post's `assets/` folder, promoting the
   *  post to a real Drive folder first if it's still local-only. */
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
