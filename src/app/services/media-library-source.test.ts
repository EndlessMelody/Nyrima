import { describe, expect, it } from "vitest";
import {
  findMediaFolder,
  getMediaFolderName,
  getSupportedMediaKind,
  isSupportedMediaFile,
} from "./media-library-source";
import type { DriveFile } from "@shared/types";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function file(name: string, mimeType = "application/octet-stream"): DriveFile {
  return { id: name, name, mimeType };
}

function folder(name: string): DriveFile {
  return file(name, FOLDER_MIME);
}

describe("media library source mapping", () => {
  it("maps each dedicated page to the expected Nyrima child folder", () => {
    expect(getMediaFolderName("movies")).toBe("Movies");
    expect(getMediaFolderName("manga")).toBe("Manga");
    expect(getMediaFolderName("light-novel")).toBe("Light Novel");
    expect(getMediaFolderName("music")).toBe("Music");
  });

  it("locates media folders by name without accepting files", () => {
    const children = [
      folder("Manga"),
      file("Movies"),
      folder("Light Novel"),
      folder("music"),
    ];

    expect(findMediaFolder(children, "movies")).toBeNull();
    expect(findMediaFolder(children, "manga")?.name).toBe("Manga");
    expect(findMediaFolder(children, "light-novel")?.name).toBe("Light Novel");
    expect(findMediaFolder(children, "music")?.name).toBe("music");
  });

  it("normalizes category folder names before matching", () => {
    expect(findMediaFolder([folder("  movies  ")], "movies")?.name).toBe("  movies  ");
    expect(findMediaFolder([folder("LIGHT-NOVEL")], "light-novel")?.name).toBe("LIGHT-NOVEL");
    expect(findMediaFolder([folder("LightNovel")], "light-novel")?.name).toBe("LightNovel");
    expect(findMediaFolder([folder("Light   Novel")], "light-novel")?.name).toBe("Light   Novel");
  });

  it("classifies supported files by media type only", () => {
    expect(isSupportedMediaFile("movies", file("Film.mkv", "video/x-matroska"))).toBe(true);
    expect(getSupportedMediaKind(file("Film.mp4", "video/mp4"))).toBe("movies");
    expect(isSupportedMediaFile("movies", file("cover.jpg", "image/jpeg"))).toBe(false);

    expect(isSupportedMediaFile("manga", file("page.webp", "image/webp"))).toBe(true);
    expect(isSupportedMediaFile("manga", file("volume.cbz"))).toBe(true);
    expect(isSupportedMediaFile("manga", file("novel.epub", "application/epub+zip"))).toBe(false);

    expect(isSupportedMediaFile("light-novel", file("Novel.epub", "application/epub+zip"))).toBe(true);
    expect(isSupportedMediaFile("light-novel", file("page.png", "image/png"))).toBe(false);

    expect(isSupportedMediaFile("music", file("song.flac", "audio/flac"))).toBe(true);
    expect(isSupportedMediaFile("music", file("song.opus", "audio/opus"))).toBe(true);
    expect(isSupportedMediaFile("music", file("song.aac", "audio/aac"))).toBe(true);
    expect(isSupportedMediaFile("music", file("video.webm", "video/webm"))).toBe(false);
  });
});
