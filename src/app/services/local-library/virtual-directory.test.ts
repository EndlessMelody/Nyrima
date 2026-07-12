import { describe, expect, it } from "vitest";
import { buildVirtualDirectoryHandle, virtualRootName } from "./virtual-directory";
import { scanLocalRoot } from "./local-index";
import { toLocalFileId, toLocalFolderId } from "@shared/local-id";

/** A `File` with `webkitRelativePath` set, as `<input webkitdirectory>` produces. */
function virtualFile(relativePath: string, content = "x"): File {
  const name = relativePath.split("/").pop() ?? relativePath;
  const file = new File([content], name);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

function fileList(files: File[]): FileList {
  return files as unknown as FileList;
}

describe("buildVirtualDirectoryHandle", () => {
  it("builds a navigable directory tree from webkitRelativePath entries", async () => {
    const root = buildVirtualDirectoryHandle(
      fileList([
        virtualFile("My Library/Movies/Episode 01.mkv"),
        virtualFile("My Library/Movies/Season1/Episode 02.mkv"),
        virtualFile("My Library/Music/Album/Track 01.flac"),
      ]),
    );

    expect(root.kind).toBe("directory");

    const movies = await root.getDirectoryHandle("Movies");
    expect(movies.kind).toBe("directory");

    const ep1 = await movies.getFileHandle("Episode 01.mkv");
    expect((await ep1.getFile()).name).toBe("Episode 01.mkv");

    const season1 = await movies.getDirectoryHandle("Season1");
    const ep2 = await season1.getFileHandle("Episode 02.mkv");
    expect((await ep2.getFile()).name).toBe("Episode 02.mkv");
  });

  it("rejects missing directories and files like the real API", async () => {
    const root = buildVirtualDirectoryHandle(fileList([virtualFile("Lib/Movies/a.mkv")]));
    const movies = await root.getDirectoryHandle("Movies");

    await expect(root.getDirectoryHandle("Nope")).rejects.toThrow();
    await expect(movies.getFileHandle("missing.mkv")).rejects.toThrow();
  });

  it("lists entries via async iteration", async () => {
    const root = buildVirtualDirectoryHandle(
      fileList([virtualFile("Lib/a.mkv"), virtualFile("Lib/Sub/b.mkv")]),
    );
    const names: string[] = [];
    for await (const [name] of root.entries()) names.push(name);
    expect(names.sort()).toEqual(["Sub", "a.mkv"]);
  });

  it("integrates with scanLocalRoot end-to-end (Movies/Music classification)", async () => {
    const root = buildVirtualDirectoryHandle(
      fileList([
        virtualFile("My Library/Movies/Episode 01.mkv"),
        virtualFile("My Library/Music/Track 01.flac"),
      ]),
    );

    const scans = await scanLocalRoot(root, "My Library");

    expect(scans.movies?.files.map((f) => f.file.id)).toEqual([
      toLocalFileId("Movies/Episode 01.mkv"),
    ]);
    expect(scans.movies?.folder.id).toBe(toLocalFolderId("Movies"));
    expect(scans.music?.files.map((f) => f.file.id)).toEqual([toLocalFileId("Music/Track 01.flac")]);
  });
});

describe("virtualRootName", () => {
  it("derives the picked folder's name from webkitRelativePath", () => {
    expect(virtualRootName(fileList([virtualFile("My Library/Movies/Episode 01.mkv")]))).toBe(
      "My Library",
    );
  });

  it("falls back to a default name for an empty FileList", () => {
    expect(virtualRootName(fileList([]))).toBe("Local Folder");
  });
});
