/**
 * Media asset helpers for a post's `assets/` folder.
 *
 * Two paths add an image to a post:
 *   - **Upload**: bytes come straight from the user's disk (drag-drop/paste)
 *     and are written directly into `assets/` — already self-contained.
 *   - **Pick from Drive**: the block just references an existing library
 *     file id while drafting (no copy yet, so swapping the pick doesn't
 *     leave orphaned copies behind). `copyMediaIntoPost` is what makes it
 *     self-contained, called by `post-publish.ts` at publish time so the
 *     post folder's public permission covers every asset it needs.
 */

import type { DriveFile } from "@shared/types";
import type { PostDoc } from "@shared/post-types";
import { copyFileToFolder, getFile, uploadBinaryFile } from "../drive-api";
import type { RequestOptions } from "../drive/types";
import { ensureAssetsFolder } from "./post-folder";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
};

/** Upload a local Blob/File into a post's `assets/` folder. */
export async function uploadImageAsset(
  postFolderId: string,
  data: Blob,
  opts: { mimeType?: string; name?: string } = {},
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const assetsFolder = await ensureAssetsFolder(postFolderId, reqOpts);
  const mimeType =
    opts.mimeType || (data instanceof File ? data.type : "") || "application/octet-stream";
  const name = opts.name ?? `img-${randomAssetId()}${extensionForMime(mimeType)}`;
  return uploadBinaryFile(assetsFolder.id, name, data, mimeType, reqOpts);
}

/**
 * Server-side copy of an existing Drive file into a post's `assets/`
 * folder. No-op (returns the file as-is) when it already lives there —
 * an uploaded asset re-copying itself would otherwise duplicate on every
 * publish.
 */
export async function copyMediaIntoPost(
  fileId: string,
  postFolderId: string,
  reqOpts: RequestOptions = {},
): Promise<DriveFile> {
  const assetsFolder = await ensureAssetsFolder(postFolderId, reqOpts);
  const meta = await getFile(fileId, undefined, reqOpts);
  if (meta.parents?.includes(assetsFolder.id)) return meta;
  return copyFileToFolder(fileId, { parentId: assetsFolder.id }, reqOpts);
}

/** Pure helper — set (or replace) a post's cover image. Caller persists
 *  via `savePost`. */
export function setCover(doc: PostDoc, fileId: string): PostDoc {
  return { ...doc, cover: { fileId }, updatedAt: new Date().toISOString() };
}

function extensionForMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? "";
}

function randomAssetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
