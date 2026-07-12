import { describe, expect, it, vi } from "vitest";
import {
  scanAllMediaFolders,
  scanMediaFolderRecursive,
  type MediaFolderListResult,
} from "./media-library-index";
import type { DriveFile } from "@shared/types";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function folder(id: string, name: string, parents: string[] = []): DriveFile {
  return { id, name, mimeType: FOLDER_MIME, parents };
}

function file(
  id: string,
  name: string,
  mimeType = "application/octet-stream",
  parents: string[] = [],
): DriveFile {
  return { id, name, mimeType, parents };
}

function makeLister(tree: Record<string, DriveFile[]>): (folderId: string) => Promise<MediaFolderListResult> {
  return async (folderId: string) => ({
    files: tree[folderId] ?? [],
    fromCache: false,
    scannedAt: 1000,
    revalidating: false,
  });
}

describe("scanMediaFolderRecursive", () => {
  it("recursively indexes supported movie files without returning folders", async () => {
    const movies = folder("movies", "Movies");
    const shared = folder("shared", "Shared", ["movies"]);
    const imports = folder("imports", "Imports", ["shared"]);
    const film = file("film", "Film.MKV", "application/octet-stream", ["imports"]);
    const poster = file("poster", "poster.jpg", "image/jpeg", ["imports"]);

    const scan = await scanMediaFolderRecursive({
      kind: "movies",
      folder: movies,
      listFolder: makeLister({
        movies: [shared],
        shared: [imports],
        imports: [film, poster],
      }),
    });

    expect(scan.files.map((entry) => entry.file.id)).toEqual(["film"]);
    expect(scan.files[0]?.parentFolder.id).toBe("imports");
    expect(scan.files[0]?.relativeFolderNames).toEqual(["Shared", "Imports"]);
    expect(scan.stats.scannedFolders).toBe(3);
    expect(scan.stats.scannedFiles).toBe(2);
    expect(scan.stats.supportedFiles).toBe(1);
    expect(scan.stats.unsupportedFiles).toBe(1);
    expect(scan.stats.unsupportedExtensions).toEqual({ ".jpg": 1 });
  });

  it("tracks visited folders and deduplicates supported files by Drive ID", async () => {
    const music = folder("music", "Music");
    const album = folder("album", "Album", ["music"]);
    const sameTrack = file("track", "Song.flac", "audio/flac", ["album"]);

    const scan = await scanMediaFolderRecursive({
      kind: "music",
      folder: music,
      listFolder: makeLister({
        music: [album, sameTrack],
        album: [music, sameTrack],
      }),
    });

    expect(scan.files.map((entry) => entry.file.id)).toEqual(["track"]);
    expect(scan.stats.scannedFolders).toBe(2);
    expect(scan.stats.supportedFiles).toBe(1);
  });
});

describe("scanAllMediaFolders", () => {
  it("aggregates only supported files from the discovered category folders", async () => {
    const movies = folder("movies", "Movies");
    const manga = folder("manga", "Manga");
    const lightNovel = folder("ln", "Light Novel");
    const music = folder("music", "Music");

    const scans = await scanAllMediaFolders({
      folders: { movies, manga, "light-novel": lightNovel, music },
      listFolder: makeLister({
        movies: [file("film", "Film.mp4", "video/mp4", ["movies"])],
        manga: [file("page", "page001.webp", "image/webp", ["manga"])],
        ln: [file("novel", "Novel.epub", "application/epub+zip", ["ln"])],
        music: [file("track", "Track.opus", "audio/opus", ["music"])],
      }),
    });

    expect(Object.fromEntries(scans.map((scan) => [scan.kind, scan.files.length]))).toEqual({
      movies: 1,
      manga: 1,
      "light-novel": 1,
      music: 1,
    });
  });

  it("logs category scan diagnostics only in development mode", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    await scanMediaFolderRecursive({
      kind: "movies",
      folder: folder("movies", "Movies"),
      listFolder: makeLister({
        movies: [file("film", "Film.mp4", "video/mp4", ["movies"])],
      }),
      debug: true,
    });

    expect(debug.mock.calls[0]?.[0]).toContain("[nyrima:index] Movies folderId=movies");
    expect(debug.mock.calls.some((call) => String(call[0]).includes("supported sample"))).toBe(true);
    debug.mockRestore();
  });
});
