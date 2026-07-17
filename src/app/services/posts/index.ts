/**
 * Barrel re-export for the Posts (block-based blog) service.
 *
 * Keep the surface narrow — modules outside the posts tree should pull
 * from this barrel, not reach into individual files. Mirrors the
 * conventions in `src/app/services/sharing/index.ts`.
 */

export {
  generatePostId,
  sanitizePostDoc,
  derivePostExcerpt,
} from "./post-doc";

export {
  ensurePostsFolder,
  createPostFolder,
  ensureAssetsFolder,
  clearPostsFolderCache,
} from "./post-folder";

export { readPost, savePost, listMyPostFolders } from "./post-io";

export {
  readPostsManifest,
  sanitizePostsManifest,
  writePostsManifest,
  mutatePostsManifest,
  prependAnnouncement,
  removeAnnouncement,
} from "./posts-manifest";

export { uploadImageAsset, copyMediaIntoPost, setCover } from "./post-assets";

export {
  getDefaultPostVisibility,
  setDefaultPostVisibility,
  type DefaultPostVisibility,
} from "./post-prefs";

export {
  publishPost,
  unpublishPost,
  deletePost,
  type PublishedVisibility,
} from "./post-publish";

export {
  saveLocalDraft,
  readLocalDraft,
  deleteLocalDraft,
  listLocalDrafts,
  postDraftHasContent,
  isLocalDraftRouteId,
  toLocalDraftRouteId,
  fromLocalDraftRouteId,
  type LocalPostDraft,
} from "./post-local-draft";

export {
  promoteLocalDraftToDrive,
  type PromotedDraft,
} from "./post-local-draft-sync";

export { fetchLinkPreview, faviconUrlFor, LinkPreviewError, type LinkPreview } from "./link-preview";

export { derivePostStats, type PostStats } from "./post-stats";
