/**
 * Drive-to-Drive import for shared Nyrima targets.
 *
 * A share entry only points at someone else's Drive file/folder. Import turns
 * that pointer into a private copy under the recipient's own Nyrima root:
 *
 *   Nyrima/
 *     Imports/
 *       <share title - timestamp>/
 *         copied files...
 *
 * The heavy lifting is Google Drive's `files.copy` endpoint. No video bytes
 * flow through the browser; Drive copies from source to destination server-side
 * while preserving the owner's access/copy restrictions.
 */

import type { DriveFile, ShareTarget } from "@shared/types";
import {
  copyFileToFolder,
  createFolder,
  findOrCreateChildFolder,
  getFile,
  isFolder,
  isSubtitleFile,
  listFolderAll,
} from "../drive-api";
import type { RequestOptions } from "../drive/types";
import { getNyrimaRoot } from "../storage";

export const DRIVE_IMPORTS_FOLDER_NAME = "Imports";

const MAX_IMPORT_TITLE_CHARS = 96;
const FILE_METADATA_FIELDS =
  "id,name,mimeType,size,modifiedTime,md5Checksum,thumbnailLink,parents,capabilities(canCopy,canDownload),videoMediaMetadata(width,height,durationMillis)";
const POSTER_NAME_RE = /^poster\.(jpe?g|png|webp)$/i;

export interface DriveImportFailure {
  sourceId: string;
  name?: string;
  message: string;
}

export interface DriveImportResult {
  targetKind: ShareTarget["kind"];
  importsFolder: DriveFile;
  destinationFolder: DriveFile;
  copiedFiles: DriveFile[];
  createdFolders: DriveFile[];
  failures: DriveImportFailure[];
}

export async function importShareTargetToDrive(
  target: ShareTarget,
  title?: string,
  reqOpts: RequestOptions = {},
): Promise<DriveImportResult> {
  const root = await getNyrimaRoot();
  if (!root) {
    throw new Error("Pair a Nyrima root folder before importing shares.");
  }

  const importsFolder = await findOrCreateChildFolder(
    root.id,
    DRIVE_IMPORTS_FOLDER_NAME,
    reqOpts,
  );
  const destinationFolder = await createFolder(
    importsFolder.id,
    buildImportFolderName(title),
    reqOpts,
  );

  const result: DriveImportResult = {
    targetKind: target.kind,
    importsFolder,
    destinationFolder,
    copiedFiles: [],
    createdFolders: [destinationFolder],
    failures: [],
  };

  if (target.kind === "video") {
    await importVideoTarget(target.fileId, target.folderId, result, reqOpts);
  } else {
    const source = await getFile(target.folderId, FILE_METADATA_FIELDS, reqOpts);
    if (!isFolder(source)) {
      throw new Error("This share points at a file, not a Drive folder.");
    }
    await copyFolderContents(source, destinationFolder.id, result, reqOpts);
    if (result.copiedFiles.length === 0 && result.failures.length > 0) {
      throw new Error(
        `Couldn't import any files. First failure: ${result.failures[0].message}`,
      );
    }
  }

  return result;
}

export function sanitizeImportFolderName(raw: string | undefined): string {
  const cleaned = (raw ?? "")
    // eslint-disable-next-line no-control-regex -- intentionally strips C0 control chars from imported folder names
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_IMPORT_TITLE_CHARS)
    .trim();
  return cleaned || "Imported share";
}

export function buildImportFolderName(
  title: string | undefined,
  date = new Date(),
): string {
  return `${sanitizeImportFolderName(title)} - ${formatLocalStamp(date)}`;
}

export function shouldCopyVideoCompanion(
  videoName: string,
  candidate: DriveFile,
): boolean {
  if (isFolder(candidate)) return false;
  if (POSTER_NAME_RE.test(candidate.name)) return true;
  if (!isSubtitleFile(candidate)) return false;

  const videoBase = stripExtension(videoName).toLowerCase();
  const candidateBase = stripExtension(candidate.name).toLowerCase();
  return (
    candidateBase === videoBase ||
    candidateBase.startsWith(`${videoBase}.`) ||
    candidateBase.startsWith(`${videoBase} `) ||
    candidateBase.startsWith(`${videoBase}[`) ||
    candidateBase.startsWith(`${videoBase}(`)
  );
}

async function importVideoTarget(
  fileId: string,
  folderId: string | undefined,
  result: DriveImportResult,
  reqOpts: RequestOptions,
): Promise<void> {
  const source = await getFile(fileId, FILE_METADATA_FIELDS, reqOpts);
  const copied = await copyRequiredFile(
    source,
    result.destinationFolder.id,
    reqOpts,
  );
  result.copiedFiles.push(copied);

  if (!folderId) return;

  let siblings: DriveFile[];
  try {
    siblings = await listFolderAll(folderId, { ...reqOpts, priority: "low" });
  } catch {
    return;
  }

  for (const file of siblings) {
    if (file.id === source.id) continue;
    if (!shouldCopyVideoCompanion(source.name, file)) continue;
    await copyOptionalFile(file, result.destinationFolder.id, result, reqOpts);
  }
}

async function copyFolderContents(
  sourceFolder: DriveFile,
  destinationFolderId: string,
  result: DriveImportResult,
  reqOpts: RequestOptions,
): Promise<void> {
  let children: DriveFile[];
  try {
    children = await listFolderAll(sourceFolder.id, reqOpts);
  } catch (e) {
    result.failures.push({
      sourceId: sourceFolder.id,
      name: sourceFolder.name,
      message: errorMessage(e),
    });
    return;
  }

  for (const child of children) {
    if (isFolder(child)) {
      let childDestination: DriveFile;
      try {
        childDestination = await createFolder(
          destinationFolderId,
          child.name,
          reqOpts,
        );
        result.createdFolders.push(childDestination);
      } catch (e) {
        result.failures.push({
          sourceId: child.id,
          name: child.name,
          message: errorMessage(e),
        });
        continue;
      }
      await copyFolderContents(child, childDestination.id, result, reqOpts);
    } else {
      await copyOptionalFile(child, destinationFolderId, result, reqOpts);
    }
  }
}

async function copyRequiredFile(
  source: DriveFile,
  destinationFolderId: string,
  reqOpts: RequestOptions,
): Promise<DriveFile> {
  if (source.capabilities?.canCopy === false) {
    throw new Error(cannotCopyMessage(source));
  }
  return await copyFileToFolder(
    source.id,
    { parentId: destinationFolderId, name: source.name },
    reqOpts,
  );
}

async function copyOptionalFile(
  source: DriveFile,
  destinationFolderId: string,
  result: DriveImportResult,
  reqOpts: RequestOptions,
): Promise<void> {
  try {
    const copied = await copyRequiredFile(source, destinationFolderId, reqOpts);
    result.copiedFiles.push(copied);
  } catch (e) {
    result.failures.push({
      sourceId: source.id,
      name: source.name,
      message: errorMessage(e),
    });
  }
}

function cannotCopyMessage(file: DriveFile): string {
  return `${file.name} cannot be copied. The owner may have disabled viewer downloads/copies.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Drive copy failed.";
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function formatLocalStamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}${min}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
