import { VIDEO_EXTENSIONS } from "@shared/constants";
import type { DriveFile } from "@shared/types";

export type MediaLibraryKind = "movies" | "manga" | "light-novel" | "music";

export type SupportedMediaKind = MediaLibraryKind;

const FOLDER_MIME = "application/vnd.google-apps.folder";

export const MEDIA_LIBRARY_KINDS: MediaLibraryKind[] = [
  "movies",
  "manga",
  "light-novel",
  "music",
];

const MEDIA_FOLDER_NAMES: Record<MediaLibraryKind, string> = {
  movies: "Movies",
  manga: "Manga",
  "light-novel": "Light Novel",
  music: "Music",
};

const MANGA_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "gif"] as const;
const MANGA_ARCHIVE_EXTENSIONS = ["cbz", "cbr"] as const;
export const LIGHT_NOVEL_EXTENSIONS = ["epub"] as const;
export const MUSIC_EXTENSIONS = ["flac", "mp3", "m4a", "ogg", "wav", "opus", "aac"] as const;

export function getMediaFolderName(kind: MediaLibraryKind): string {
  return MEDIA_FOLDER_NAMES[kind];
}

export function findMediaFolder(
  rootChildren: DriveFile[],
  kind: MediaLibraryKind,
): DriveFile | null {
  const expected = normalizeMediaFolderName(getMediaFolderName(kind));
  return (
    rootChildren.find(
      (file) => isFolder(file) && normalizeMediaFolderName(file.name) === expected,
    ) ?? null
  );
}

export function normalizeMediaFolderName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "light-novel" || normalized === "lightnovel") {
    return "light novel";
  }
  return normalized;
}

export function isFolder(file: DriveFile): boolean {
  return file.mimeType === FOLDER_MIME;
}

export function isSupportedMediaFile(
  kind: MediaLibraryKind,
  file: DriveFile,
): boolean {
  return getSupportedMediaKind(file) === kind;
}

export function getSupportedMediaKind(file: DriveFile): SupportedMediaKind | null {
  if (isFolder(file)) return null;
  const ext = getExtension(file.name);
  const mime = file.mimeType.toLowerCase();

  if (
    VIDEO_EXTENSIONS.includes(ext as (typeof VIDEO_EXTENSIONS)[number]) ||
    mime.startsWith("video/") ||
    mime === "application/x-matroska"
  ) {
    return "movies";
  }

  if (
    MANGA_IMAGE_EXTENSIONS.includes(ext as (typeof MANGA_IMAGE_EXTENSIONS)[number]) ||
    MANGA_ARCHIVE_EXTENSIONS.includes(ext as (typeof MANGA_ARCHIVE_EXTENSIONS)[number]) ||
    mime.startsWith("image/")
  ) {
    return "manga";
  }

  if (
    LIGHT_NOVEL_EXTENSIONS.includes(ext as (typeof LIGHT_NOVEL_EXTENSIONS)[number]) ||
    mime === "application/epub+zip"
  ) {
    return "light-novel";
  }

  if (
    MUSIC_EXTENSIONS.includes(ext as (typeof MUSIC_EXTENSIONS)[number]) ||
    mime.startsWith("audio/")
  ) {
    return "music";
  }

  return null;
}

export function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function mediaFormatLabel(file: DriveFile): string {
  const ext = getExtension(file.name);
  if (ext) return ext.toUpperCase();
  const [type, subtype] = file.mimeType.split("/");
  if (type === "video" || type === "audio" || type === "image") {
    return subtype ? subtype.toUpperCase() : type.toUpperCase();
  }
  return "FILE";
}

export function mediaResolutionLabel(file: DriveFile): string | undefined {
  const height = file.videoMediaMetadata?.height;
  if (!height || height <= 0) return undefined;
  return `${height}p`;
}

export function mediaDurationMs(file: DriveFile): number | undefined {
  const raw = file.videoMediaMetadata?.durationMillis;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
