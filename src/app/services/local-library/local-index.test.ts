import { describe, expect, it } from "vitest";
import { scanLocalRoot } from "./local-index";
import { toLocalFileId, toLocalFolderId } from "@shared/local-id";

class FakeFileHandle {
  readonly kind = "file" as const;
  constructor(
    readonly name: string,
    private readonly content: string,
  ) {}
  async getFile(): Promise<File> {
    return new File([this.content], this.name, { lastModified: 0 });
  }
}

class FakeDirHandle {
  readonly kind = "directory" as const;
  constructor(
    readonly name: string,
    private readonly children: Record<string, FakeFileHandle | FakeDirHandle> = {},
  ) {}
  async *entries(): AsyncIterableIterator<[string, FakeFileHandle | FakeDirHandle]> {
    for (const [name, handle] of Object.entries(this.children)) {
      yield [name, handle];
    }
  }
}

function dir(name: string, children: Record<string, FakeFileHandle | FakeDirHandle>): FakeDirHandle {
  return new FakeDirHandle(name, children);
}

function file(name: string): FakeFileHandle {
  return new FakeFileHandle(name, "x");
}

describe("scanLocalRoot", () => {
  it("indexes Movies/Light Novel/Music top-level folders by convention", async () => {
    const root = dir("My Library", {
      Movies: dir("Movies", {
        "Episode 01.mkv": file("Episode 01.mkv"),
        "poster.jpg": file("poster.jpg"),
        Season1: dir("Season1", { "Episode 02.mkv": file("Episode 02.mkv") }),
      }),
      "Light Novel": dir("Light Novel", {
        "Book.epub": file("Book.epub"),
      }),
      Music: dir("Music", {
        Album: dir("Album", { "Track 01.flac": file("Track 01.flac") }),
      }),
    });

    const scans = await scanLocalRoot(root as unknown as FileSystemDirectoryHandle, "My Library");

    expect(scans.movies?.files.map((f) => f.file.id)).toEqual(
      [
        toLocalFileId("Movies/Episode 01.mkv"),
        toLocalFileId("Movies/Season1/Episode 02.mkv"),
      ],
    );
    expect(scans.movies?.folder.id).toBe(toLocalFolderId("Movies"));
    expect(scans.movies?.stats.unsupportedExtensions).toEqual({ ".jpg": 1 });
    expect(scans.movies?.files[1]?.relativeFolderNames).toEqual(["Season1"]);

    expect(scans["light-novel"]?.files.map((f) => f.file.id)).toEqual([
      toLocalFileId("Light Novel/Book.epub"),
    ]);
    expect(scans["light-novel"]?.files[0]?.file.mimeType).toBe("application/epub+zip");

    expect(scans.music?.files.map((f) => f.file.id)).toEqual([
      toLocalFileId("Music/Album/Track 01.flac"),
    ]);
    expect(scans.music?.files[0]?.file.mimeType).toBe("audio/flac");

    expect(scans.manga).toBeUndefined();
  });

  it("falls back to extension-based classification when no expected folders exist", async () => {
    const root = dir("Random Folder", {
      "Movie.mkv": file("Movie.mkv"),
      "Song.mp3": file("Song.mp3"),
      "Notes.txt": file("Notes.txt"),
    });

    const scans = await scanLocalRoot(root as unknown as FileSystemDirectoryHandle, "Random Folder");

    expect(scans.movies?.files.map((f) => f.file.name)).toEqual(["Movie.mkv"]);
    expect(scans.movies?.folder.id).toBe("local-root");
    expect(scans.music?.files.map((f) => f.file.name)).toEqual(["Song.mp3"]);
    expect(scans["light-novel"]).toBeUndefined();
  });
});
