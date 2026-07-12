/**
 * Recursive indexer for a connected local library directory, producing the
 * same `MediaFolderScanResult` shape as `media-library-index.ts`'s Drive
 * scanner so library pages can merge local + Drive results without any
 * rendering changes.
 *
 * Convention mirrors Drive: look for `Movies/`, `Light Novel/`, `Music/`
 * top-level folders (case/whitespace-insensitive via
 * `normalizeMediaFolderName`). If none of those exist, fall back to
 * classifying every file under the root by extension/MIME. Manga is out of
 * scope for local libraries.
 */

import {
  MEDIA_LIBRARY_KINDS,
  getMediaFolderName,
  getSupportedMediaKind,
  normalizeMediaFolderName,
  type MediaLibraryKind,
} from "../media-library-source";
import type {
  IndexedMediaFile,
  MediaFolderScanResult,
  MediaFolderScanStats,
  UnsupportedMediaFileSample,
} from "../media-library-index";
import { LOCAL_ROOT_FOLDER_ID } from "@shared/local-id";
import {
  LOCAL_FOLDER_MIME,
  buildLocalFileDriveFile,
  buildLocalFolderDriveFile,
  inferLocalMimeType,
} from "./local-source";
import type { DriveFile } from "@shared/types";

/** Caps directory depth so a misclicked drive root (e.g. a whole user
 *  profile) can't hang indexing. */
const MAX_DEPTH = 12;

const INDEXABLE_KINDS: MediaLibraryKind[] = MEDIA_LIBRARY_KINDS.filter(
  (kind) => kind !== "manga",
);

interface QueueEntry {
  handle: FileSystemDirectoryHandle;
  driveFolder: DriveFile;
  relPath: string;
  relativeFolderIds: string[];
  relativeFolderNames: string[];
  depth: number;
}

interface WalkResult {
  filesByKind: Map<MediaLibraryKind, IndexedMediaFile[]>;
  folders: DriveFile[];
  scannedFolders: number;
  scannedFiles: number;
  unsupportedFiles: number;
  unsupportedExtensions: Record<string, number>;
  unsupportedSample: UnsupportedMediaFileSample[];
}

/**
 * BFS the tree rooted at `handle`. `classify(probe)` decides which kind (if
 * any) each file belongs to — callers either pin it to a single expected
 * kind or let every file fall into its own bucket (fallback mode).
 */
async function walkTree(
  handle: FileSystemDirectoryHandle,
  driveFolder: DriveFile,
  relPath: string,
  classify: (probe: DriveFile) => MediaLibraryKind | null,
): Promise<WalkResult> {
  const queue: QueueEntry[] = [
    { handle, driveFolder, relPath, relativeFolderIds: [], relativeFolderNames: [], depth: 0 },
  ];
  const folders: DriveFile[] = [];
  const filesByKind = new Map<MediaLibraryKind, IndexedMediaFile[]>();
  let scannedFolders = 0;
  let scannedFiles = 0;
  let unsupportedFiles = 0;
  const unsupportedExtensions: Record<string, number> = {};
  const unsupportedSample: UnsupportedMediaFileSample[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    scannedFolders += 1;
    folders.push(current.driveFolder);
    if (current.depth >= MAX_DEPTH) continue;

    for await (const [name, child] of current.handle.entries()) {
      if (name.startsWith(".")) continue;
      const childRelPath = current.relPath ? `${current.relPath}/${name}` : name;

      if (child.kind === "directory") {
        const childFolder = buildLocalFolderDriveFile(childRelPath, name);
        queue.push({
          handle: child as FileSystemDirectoryHandle,
          driveFolder: childFolder,
          relPath: childRelPath,
          relativeFolderIds: [...current.relativeFolderIds, childFolder.id],
          relativeFolderNames: [...current.relativeFolderNames, name],
          depth: current.depth + 1,
        });
        continue;
      }

      scannedFiles += 1;
      const probe: DriveFile = { id: "", name, mimeType: inferLocalMimeType(name) };
      const kind = classify(probe);
      if (!kind) {
        unsupportedFiles += 1;
        const ext = extensionLabel(name);
        unsupportedExtensions[ext] = (unsupportedExtensions[ext] ?? 0) + 1;
        if (unsupportedSample.length < 10) {
          unsupportedSample.push({ name, extension: ext, mimeType: probe.mimeType });
        }
        continue;
      }

      const fileObj = await (child as FileSystemFileHandle).getFile();
      const driveFile = buildLocalFileDriveFile(childRelPath, fileObj);
      const list = filesByKind.get(kind) ?? [];
      list.push({
        kind,
        file: driveFile,
        sourceFolder: driveFolder,
        parentFolder: current.driveFolder,
        relativeFolderIds: current.relativeFolderIds,
        relativeFolderNames: current.relativeFolderNames,
      });
      filesByKind.set(kind, list);
    }
  }

  return { filesByKind, folders, scannedFolders, scannedFiles, unsupportedFiles, unsupportedExtensions, unsupportedSample };
}

function buildScanResult(
  kind: MediaLibraryKind,
  sourceFolder: DriveFile,
  walked: WalkResult,
): MediaFolderScanResult {
  const files = walked.filesByKind.get(kind) ?? [];
  const stats: MediaFolderScanStats = {
    categoryName: getMediaFolderName(kind),
    folderId: sourceFolder.id,
    scannedFolders: walked.scannedFolders,
    scannedFiles: walked.scannedFiles,
    supportedFiles: files.length,
    unsupportedFiles: walked.unsupportedFiles,
    supportedSample: files.slice(0, 10).map((entry) => entry.file.name),
    unsupportedSample: walked.unsupportedSample,
    unsupportedExtensions: walked.unsupportedExtensions,
  };
  return {
    kind,
    folder: sourceFolder,
    files,
    folders: walked.folders,
    stats,
    scannedAt: Date.now(),
    revalidating: false,
  };
}

/**
 * Index a connected local library root into per-kind scan results. Returns
 * an empty map for kinds that have neither a matching top-level folder nor
 * (in fallback mode) any matching files.
 */
export async function scanLocalRoot(
  root: FileSystemDirectoryHandle,
  rootName: string,
): Promise<Partial<Record<MediaLibraryKind, MediaFolderScanResult>>> {
  const topDirs: Array<[string, FileSystemDirectoryHandle]> = [];
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "directory" && !name.startsWith(".")) {
      topDirs.push([name, handle as FileSystemDirectoryHandle]);
    }
  }

  const results: Partial<Record<MediaLibraryKind, MediaFolderScanResult>> = {};
  const matched = new Set<string>();

  for (const kind of INDEXABLE_KINDS) {
    const expected = normalizeMediaFolderName(getMediaFolderName(kind));
    const match = topDirs.find(([name]) => normalizeMediaFolderName(name) === expected);
    if (!match) continue;
    const [name, handle] = match;
    matched.add(name);
    const sourceFolder = buildLocalFolderDriveFile(name, name);
    const walked = await walkTree(handle, sourceFolder, name, (probe) =>
      getSupportedMediaKind(probe) === kind ? kind : null,
    );
    results[kind] = buildScanResult(kind, sourceFolder, walked);
  }

  if (matched.size === 0) {
    const rootFolder: DriveFile = {
      id: LOCAL_ROOT_FOLDER_ID,
      name: rootName || "Local Library",
      mimeType: LOCAL_FOLDER_MIME,
    };
    const walked = await walkTree(root, rootFolder, "", getSupportedMediaKind);
    for (const kind of INDEXABLE_KINDS) {
      const files = walked.filesByKind.get(kind);
      if (!files || files.length === 0) continue;
      results[kind] = buildScanResult(kind, rootFolder, walked);
    }
  }

  return results;
}

function extensionLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? `.${name.slice(dot + 1).toLowerCase()}` : "(none)";
}
