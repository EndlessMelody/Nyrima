/**
 * Barrel re-export for the Phase 4 sharing service.
 *
 * Keep the surface narrow — modules outside the sharing tree should pull
 * from this barrel, not reach into individual files. That gives us room
 * to reshape the internal layout without churning every call site.
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
  mutateShareIndex,
  prependIndexEntry,
  removeIndexEntry,
  generateShareId,
} from "./index-store";

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

export {
  appendComment,
  readComments,
  aggregateComments,
  parseCommentsJsonl,
} from "./comments-store";

export {
  fetchDirectory,
  getCachedDirectory,
  clearDirectoryCache,
} from "./directory";

export {
  DRIVE_IMPORTS_FOLDER_NAME,
  buildImportFolderName,
  importShareTargetToDrive,
  sanitizeImportFolderName,
  shouldCopyVideoCompanion,
  type DriveImportFailure,
  type DriveImportResult,
} from "./drive-import";
