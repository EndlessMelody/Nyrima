/**
 * Barrel re-export for the Phase 4 sharing service.
 *
 * Keep the surface narrow — modules outside the sharing tree should pull
 * from this barrel, not reach into individual files. That gives us room
 * to reshape the internal layout (e.g., splitting entry-store into
 * reader/writer) without churning every call site.
 */

export {
  ensureShareFolders,
  getCachedShareFolders,
  clearShareFolderCache,
  type ShareFolderIds,
} from "./share-folder";

export {
  readShareIndex,
  writeShareIndex,
  prependIndexEntry,
  removeIndexEntry,
} from "./index-store";

export {
  writeShareEntry,
  readShareEntry,
  generateShareId,
  entryFilename,
} from "./entry-store";

export {
  getShareProfile,
  setShareProfile,
  profileToAuthor,
  validateShareHandle,
} from "./share-profile";

export {
  isSharedFolderPublic,
  publishSharedFolder,
  unpublishSharedFolder,
  clearSharedFolderPublicCache,
} from "./share-permissions";
