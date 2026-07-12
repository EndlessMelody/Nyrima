/**
 * Session runtime for the connected local library: resolves local ids to
 * `File`/`FileSystemDirectoryHandle` objects via the persisted root handle,
 * and synthesizes `DriveFile`-shaped records so the rest of the app (which
 * only knows about Drive's shape) can render local entries unchanged.
 */

import { parseLocalId, toLocalFileId, toLocalFolderId } from "@shared/local-id";
import { getExtension } from "../media-library-source";
import type { DriveFile } from "@shared/types";

export const LOCAL_FOLDER_MIME = "application/vnd.google-apps.folder";

/** Virtual relative-path prefix for files picked via "Open file" (quick-open)
 *  — they have no real parent directory, so `listEntries` must not try to
 *  walk one. Shared with `quick-open.ts` and `local-video.ts`/`local-music.ts`. */
export const QUICK_OPEN_REL_PATH = "__quick-open__";

export function isQuickOpenPath(relPath: string): boolean {
  return relPath === QUICK_OPEN_REL_PATH || relPath.startsWith(`${QUICK_OPEN_REL_PATH}/`);
}

/**
 * Extension -> MIME map for files the platform reports with an empty
 * `File.type` (notably .mkv and .flac on Windows). Falls back to the
 * browser-reported type, then `application/octet-stream`.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  // video
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
  ts: "video/mp2t",
  m2ts: "video/mp2t",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  // audio
  flac: "audio/flac",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  opus: "audio/opus",
  aac: "audio/aac",
  // documents
  epub: "application/epub+zip",
  // subtitles
  srt: "application/x-subrip",
  vtt: "text/vtt",
  ass: "text/x-ssa",
  ssa: "text/x-ssa",
  sub: "text/plain",
};

export function inferLocalMimeType(name: string, browserReportedType?: string): string {
  const ext = getExtension(name);
  return MIME_BY_EXTENSION[ext] ?? (browserReportedType || "application/octet-stream");
}

export function buildLocalFileDriveFile(relativePath: string, file: File): DriveFile {
  const name = relativePath.split("/").pop() ?? relativePath;
  return {
    id: toLocalFileId(relativePath),
    name,
    mimeType: inferLocalMimeType(name, file.type),
    size: String(file.size),
    modifiedTime: new Date(file.lastModified).toISOString(),
  };
}

export function buildLocalFolderDriveFile(relativePath: string, name: string): DriveFile {
  return {
    id: toLocalFolderId(relativePath),
    name,
    mimeType: LOCAL_FOLDER_MIME,
  };
}

class LocalLibraryRuntime {
  private root: FileSystemDirectoryHandle | null = null;
  private rootName = "";
  private fileCache = new Map<string, File>();
  private objectUrls = new Map<string, string>();
  /** Quick-open files: resolvable by id without a connected library root. */
  private sessionFiles = new Map<string, File>();

  setRoot(handle: FileSystemDirectoryHandle | null, name = ""): void {
    this.root = handle;
    this.rootName = name;
    this.fileCache.clear();
    this.revokeAllObjectUrls();
  }

  hasRoot(): boolean {
    return this.root !== null;
  }

  getRootName(): string {
    return this.rootName;
  }

  getRootHandle(): FileSystemDirectoryHandle {
    if (!this.root) throw new Error("Local library is not connected");
    return this.root;
  }

  /** Walk the root handle to the directory at `relPath` ("" = root). */
  async resolveDirectory(relPath: string): Promise<FileSystemDirectoryHandle> {
    let dir = this.getRootHandle();
    if (!relPath) return dir;
    for (const segment of relPath.split("/")) {
      if (!segment) continue;
      dir = await dir.getDirectoryHandle(segment);
    }
    return dir;
  }

  /** Register a file picked via "Open file" (quick-open), resolvable by id
   *  without walking the connected library root. */
  registerSessionFile(localId: string, file: File): void {
    this.sessionFiles.set(localId, file);
  }

  async resolveFile(localId: string): Promise<File> {
    const sessionFile = this.sessionFiles.get(localId);
    if (sessionFile) return sessionFile;

    const relPath = parseLocalId(localId);
    if (relPath === null || !relPath) {
      throw new Error("Invalid local file id");
    }
    const cached = this.fileCache.get(relPath);
    if (cached) return cached;

    const segments = relPath.split("/").filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) throw new Error("Invalid local file id");

    const dir = await this.resolveDirectory(segments.join("/"));
    const handle = await dir.getFileHandle(fileName);
    const file = await handle.getFile();
    this.fileCache.set(relPath, file);
    return file;
  }

  /** List the immediate children of a local folder id as DriveFile-shaped
   *  entries, mirroring `cachedListFolder`'s result shape. */
  async listEntries(localFolderId: string): Promise<DriveFile[]> {
    const relPath = parseLocalId(localFolderId);
    if (relPath === null) throw new Error("Invalid local folder id");
    // Quick-opened files have no real parent directory to list — and no
    // siblings to find one in.
    if (isQuickOpenPath(relPath)) return [];

    const dir = await this.resolveDirectory(relPath);
    const entries: DriveFile[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith(".")) continue;
      const childRelPath = relPath ? `${relPath}/${name}` : name;
      if (handle.kind === "directory") {
        entries.push(buildLocalFolderDriveFile(childRelPath, name));
        continue;
      }
      const file = await (handle as FileSystemFileHandle).getFile();
      this.fileCache.set(childRelPath, file);
      entries.push(buildLocalFileDriveFile(childRelPath, file));
    }
    return entries;
  }

  /** Mint (or reuse) a same-origin object URL for a local file. Centralized
   *  so the runtime can revoke every URL it handed out on disconnect. */
  getStreamUrl(localId: string, file: File): string {
    const existing = this.objectUrls.get(localId);
    if (existing) return existing;
    const url = URL.createObjectURL(file);
    this.objectUrls.set(localId, url);
    return url;
  }

  revokeStreamUrl(localId: string): void {
    const url = this.objectUrls.get(localId);
    if (!url) return;
    URL.revokeObjectURL(url);
    this.objectUrls.delete(localId);
  }

  private revokeAllObjectUrls(): void {
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }
}

/** Singleton: there is exactly one connected local library per session. */
export const localLibrary = new LocalLibraryRuntime();
