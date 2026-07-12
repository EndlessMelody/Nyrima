/**
 * Publish / unpublish / delete lifecycle for a post.
 *
 * Publishing is the one moment a post's visibility permission actually
 * changes on Drive — everything before this is a private draft. The post
 * folder is the atomic permission unit (see post-folder.ts), so
 * `setFolderPublic` on it is what makes `post.json` + every asset in
 * `assets/` readable in one call. "Friends" and "public" share the same
 * Drive permission (link-public); the distinction is purely about where
 * the post gets announced — see the module doc on `post-types.ts`.
 */

import type {
  PostAnnouncement,
  PostBlock,
  PostDoc,
  PostVisibility,
  PostsManifest,
} from "@shared/post-types";
import { POSTS_MANIFEST_SCHEMA_VERSION } from "@shared/post-types";
import type { ShareAuthor } from "@shared/types";
import { deleteFile, setFolderPrivate, setFolderPublic } from "../drive-api";
import type { RequestOptions } from "../drive/types";
import { ensureShareFolders } from "../sharing";
import { derivePostExcerpt } from "./post-doc";
import { copyMediaIntoPost } from "./post-assets";
import { savePost } from "./post-io";
import {
  mutatePostsManifest,
  prependAnnouncement,
  removeAnnouncement,
} from "./posts-manifest";

export type PublishedVisibility = Exclude<PostVisibility, "draft">;

/**
 * Copy referenced media into the post folder so it's self-contained, flip
 * the folder public, persist the doc, and announce it in the author's
 * `Shared/posts.json`. Returns the updated (now-published) doc.
 */
export async function publishPost(
  postFolderId: string,
  doc: PostDoc,
  visibility: PublishedVisibility,
  reqOpts: RequestOptions = {},
): Promise<PostDoc> {
  const blocks = await copyExternalImagesIntoAssets(
    doc.blocks,
    postFolderId,
    reqOpts,
  );

  await setFolderPublic(postFolderId, reqOpts);

  const now = new Date().toISOString();
  const publishedAt = doc.publishedAt ?? now;
  const nextDoc: PostDoc = {
    ...doc,
    blocks,
    visibility,
    publishedAt,
    updatedAt: now,
  };
  await savePost(postFolderId, nextDoc, reqOpts);

  const announcement = buildAnnouncement(
    nextDoc,
    postFolderId,
    visibility,
    publishedAt,
  );
  const folders = await ensureShareFolders(reqOpts);
  await mutatePostsManifest(
    folders.root,
    (current) =>
      prependAnnouncement(current ?? emptyManifest(nextDoc.author), announcement),
    reqOpts,
  );

  return nextDoc;
}

/**
 * Revoke the post folder's public permission, revoke any individually
 * consented media files, drop the announcement, and reset the doc to a
 * draft. `publishedAt` is left in place as history — only `visibility`
 * flips back.
 */
export async function unpublishPost(
  postFolderId: string,
  doc: PostDoc,
  reqOpts: RequestOptions = {},
): Promise<PostDoc> {
  await setFolderPrivate(postFolderId, reqOpts);
  await revokeSharedFiles(doc.sharedFileIds, reqOpts);

  const nextDoc: PostDoc = {
    ...doc,
    visibility: "draft",
    updatedAt: new Date().toISOString(),
  };
  delete nextDoc.sharedFileIds;
  await savePost(postFolderId, nextDoc, reqOpts);

  const folders = await ensureShareFolders(reqOpts);
  await mutatePostsManifest(
    folders.root,
    (current) =>
      current
        ? removeAnnouncement(current, doc.id)
        : emptyManifest(doc.author),
    reqOpts,
  );

  return nextDoc;
}

/**
 * Drop the announcement, revoke any consented media files, and trash the
 * whole post folder (Drive trashes the folder's descendants — `post.json`
 * and `assets/` — along with it).
 */
export async function deletePost(
  postFolderId: string,
  doc: PostDoc,
  reqOpts: RequestOptions = {},
): Promise<void> {
  const folders = await ensureShareFolders(reqOpts);
  await mutatePostsManifest(
    folders.root,
    (current) =>
      current
        ? removeAnnouncement(current, doc.id)
        : emptyManifest(doc.author),
    reqOpts,
  );
  await revokeSharedFiles(doc.sharedFileIds, reqOpts);
  await deleteFile(postFolderId, reqOpts);
}

// ---------------------------------------------------------------------------

async function copyExternalImagesIntoAssets(
  blocks: PostBlock[],
  postFolderId: string,
  reqOpts: RequestOptions,
): Promise<PostBlock[]> {
  const result: PostBlock[] = [];
  for (const block of blocks) {
    let next = block;
    const fileId = block.props.fileId;
    if (block.type === "driveImage" && typeof fileId === "string") {
      const copy = await copyMediaIntoPost(fileId, postFolderId, reqOpts);
      if (copy.id !== fileId) {
        next = { ...block, props: { ...block.props, fileId: copy.id } };
      }
    }
    if (block.children && block.children.length > 0) {
      next = {
        ...next,
        children: await copyExternalImagesIntoAssets(
          block.children,
          postFolderId,
          reqOpts,
        ),
      };
    }
    result.push(next);
  }
  return result;
}

async function revokeSharedFiles(
  fileIds: string[] | undefined,
  reqOpts: RequestOptions,
): Promise<void> {
  if (!fileIds || fileIds.length === 0) return;
  for (const fileId of fileIds) {
    try {
      await setFolderPrivate(fileId, reqOpts);
    } catch {
      // Best-effort: a file the author already deleted/moved shouldn't
      // block the rest of the unpublish/delete flow.
    }
  }
}

function buildAnnouncement(
  doc: PostDoc,
  folderId: string,
  visibility: PublishedVisibility,
  publishedAt: string,
): PostAnnouncement {
  const excerpt = derivePostExcerpt(doc.blocks);
  return {
    v: 1,
    id: doc.id,
    folderId,
    title: doc.title,
    ...(excerpt ? { excerpt } : {}),
    visibility,
    publishedAt,
    updatedAt: doc.updatedAt,
    ...(doc.tags ? { tags: doc.tags } : {}),
  };
}

function emptyManifest(owner: ShareAuthor): PostsManifest {
  return {
    v: POSTS_MANIFEST_SCHEMA_VERSION,
    owner,
    updatedAt: new Date().toISOString(),
    posts: [],
  };
}
