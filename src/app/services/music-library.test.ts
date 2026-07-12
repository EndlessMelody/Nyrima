import { describe, expect, it } from "vitest";
import { buildMusicAlbumGroups } from "./music-library";
import type { IndexedMediaFile } from "./media-library-index";
import type { DriveFile } from "@shared/types";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function folder(id: string, name: string, parents: string[] = []): DriveFile {
  return { id, name, mimeType: FOLDER_MIME, parents };
}

function track(id: string, name: string, parent: DriveFile, source: DriveFile): IndexedMediaFile {
  const relativeFolderNames = parent.id === source.id ? [] : [parent.name];
  const relativeFolderIds = parent.id === source.id ? [] : [parent.id];
  return {
    kind: "music",
    file: { id, name, mimeType: "audio/flac", parents: [parent.id] },
    sourceFolder: source,
    parentFolder: parent,
    relativeFolderIds,
    relativeFolderNames,
  };
}

describe("music album grouping", () => {
  it("treats each Drive folder as one album", () => {
    const music = folder("music", "Music");
    const albumA = folder("album-a", "Lullaby in the Shell", ["music"]);
    const albumB = folder("album-b", "Side Songs", ["music"]);

    const albums = buildMusicAlbumGroups([
      track("a2", "02. Second.flac", albumA, music),
      track("b1", "01. Other.flac", albumB, music),
      track("a1", "01. First.flac", albumA, music),
    ]);

    expect(albums.map((album) => album.title)).toEqual(["Lullaby in the Shell", "Side Songs"]);
    expect(albums[0]?.tracks.map((entry) => entry.file.id)).toEqual(["a1", "a2"]);
  });

  it("keeps root-level music as a playable album", () => {
    const music = folder("music", "Music");

    const albums = buildMusicAlbumGroups([track("single", "01. Single.flac", music, music)]);

    expect(albums).toHaveLength(1);
    expect(albums[0]?.id).toBe("music");
    expect(albums[0]?.title).toBe("Music");
    expect(albums[0]?.tracks.map((entry) => entry.file.id)).toEqual(["single"]);
  });
});
