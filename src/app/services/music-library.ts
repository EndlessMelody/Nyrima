import type { IndexedMediaFile } from "./media-library-index";

export interface MusicAlbumGroup {
  id: string;
  title: string;
  folderId: string;
  relativeFolderIds: string[];
  relativeFolderNames: string[];
  tracks: IndexedMediaFile[];
}

/**
 * Nyrima treats each Drive folder in Music as one playable album. Tracks that
 * sit directly inside the Music root still form an album named after that root.
 */
export function buildMusicAlbumGroups(entries: IndexedMediaFile[]): MusicAlbumGroup[] {
  const groups = new Map<string, MusicAlbumGroup>();

  for (const entry of entries) {
    const folder = entry.parentFolder;
    const existing = groups.get(folder.id);
    if (existing) {
      existing.tracks.push(entry);
      continue;
    }

    groups.set(folder.id, {
      id: folder.id,
      title: folder.name || entry.sourceFolder.name || "Album",
      folderId: folder.id,
      relativeFolderIds: entry.relativeFolderIds,
      relativeFolderNames:
        entry.relativeFolderNames.length > 0
          ? entry.relativeFolderNames
          : [entry.sourceFolder.name],
      tracks: [entry],
    });
  }

  return Array.from(groups.values())
    .map((album) => ({
      ...album,
      tracks: sortMusicTracks(album.tracks),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));
}

export function sortMusicTracks<T extends { file: { name: string } }>(tracks: T[]): T[] {
  return [...tracks].sort((a, b) =>
    a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}
