/**
 * Promotes a local-only draft (post-local-draft.ts) to a real Drive post
 * folder. The one place `Posts/<postId>/` actually gets created — called
 * from `PostEditorPage` (on Publish, or the first image upload) and from
 * the Posts feed's resume-draft banner, so both paths share one code path
 * instead of re-deriving the same "create folder, save, clear the local
 * copy" sequence.
 */

import type { PostDoc } from "@shared/post-types";
import { getShareProfile, profileToAuthor } from "../sharing";
import { createPostFolder } from "./post-folder";
import { savePost } from "./post-io";
import { deleteLocalDraft, type LocalPostDraft } from "./post-local-draft";

export interface PromotedDraft {
  folderId: string;
  doc: PostDoc;
}

export async function promoteLocalDraftToDrive(
  entry: LocalPostDraft,
): Promise<PromotedDraft> {
  // Re-stamp from the freshest profile, same as publishPost — a draft may
  // have been started before a share handle existed.
  const profile = await getShareProfile();
  const doc: PostDoc = profile ? { ...entry.doc, author: profileToAuthor(profile) } : entry.doc;

  const folder = await createPostFolder(doc.id);
  await savePost(folder.id, doc);
  await deleteLocalDraft(entry.localId);

  return { folderId: folder.id, doc };
}
