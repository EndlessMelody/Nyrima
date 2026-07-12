/**
 * Adapts a flat `FileList` (from `<input type="file" webkitdirectory>`) into
 * a `FileSystemDirectoryHandle`-shaped tree, implementing only the surface
 * `local-source.ts` and `local-index.ts` actually use: `entries()`,
 * `getDirectoryHandle()`, `getFileHandle()`, `.kind`, `.name`, `getFile()`.
 * This lets the Firefox/Safari "pick a folder" fallback reuse
 * `LocalLibraryRuntime` and `scanLocalRoot` verbatim — no separate
 * indexing/resolve code path for virtual trees.
 *
 * The resulting handle is a session-only in-memory view: it is not
 * structured-cloneable and must never be passed to `setStoredLocalLibrary`.
 */

interface DirNode {
  name: string;
  dirs: Map<string, DirNode>;
  files: Map<string, File>;
}

function buildTree(fileList: FileList): DirNode {
  const root: DirNode = { name: "", dirs: new Map(), files: new Map() };
  for (const file of Array.from(fileList)) {
    const raw = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
    const segments = raw.split("/").filter(Boolean);
    // The first segment is the picked folder's own name — entries are
    // resolved relative to its contents, mirroring a connected root handle.
    if (segments.length > 1) segments.shift();
    if (segments.length === 0) continue;

    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i];
      let child = node.dirs.get(name);
      if (!child) {
        child = { name, dirs: new Map(), files: new Map() };
        node.dirs.set(name, child);
      }
      node = child;
    }
    node.files.set(segments[segments.length - 1], file);
  }
  return root;
}

function dirHandleFromNode(node: DirNode): FileSystemDirectoryHandle {
  const handle = {
    kind: "directory" as const,
    name: node.name,
    async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
      const child = node.dirs.get(name);
      if (!child) throw new DOMException(`Directory not found: ${name}`, "NotFoundError");
      return dirHandleFromNode(child);
    },
    async getFileHandle(name: string): Promise<FileSystemFileHandle> {
      const file = node.files.get(name);
      if (!file) throw new DOMException(`File not found: ${name}`, "NotFoundError");
      return fileHandleFromFile(name, file);
    },
    async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
      for (const [name, child] of node.dirs) {
        yield [name, dirHandleFromNode(child)];
      }
      for (const [name, file] of node.files) {
        yield [name, fileHandleFromFile(name, file)];
      }
    },
  };
  return handle as unknown as FileSystemDirectoryHandle;
}

function fileHandleFromFile(name: string, file: File): FileSystemFileHandle {
  return {
    kind: "file" as const,
    name,
    async getFile(): Promise<File> {
      return file;
    },
  } as unknown as FileSystemFileHandle;
}

/** Build a virtual root handle from a `webkitdirectory` file picker result. */
export function buildVirtualDirectoryHandle(fileList: FileList): FileSystemDirectoryHandle {
  return dirHandleFromNode(buildTree(fileList));
}

/** Display name for the picked folder, derived from the first file's
 *  `webkitRelativePath` (e.g. "MyFolder/Movies/Show/Ep1.mkv" -> "MyFolder"). */
export function virtualRootName(fileList: FileList): string {
  const first = fileList[0];
  if (!first) return "Local Folder";
  const raw = (first.webkitRelativePath || first.name).replace(/\\/g, "/");
  return raw.split("/")[0] || "Local Folder";
}
