/**
 * Domain types used across the extension.
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string; // Drive API returns size as string (int64)
  modifiedTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  videoMediaMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: string;
  };
  parents?: string[];
}

export interface RecentFolder {
  id: string;
  name: string;
  lastOpenedAt: number; // epoch ms
  pinned?: boolean;
  itemCount?: number;
  coverFileId?: string; // optional thumbnail to display on the card
}

export interface UserProfile {
  email: string;
  name?: string;
  picture?: string;
}

export interface PlaybackPosition {
  fileId: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number;
  /** File name — stored so Continue Watching can render without re-fetching. */
  name?: string;
  /** Parent folder id — for routing back to the library. */
  folderId?: string;
  mimeType?: string;
}

export interface MovieMetadata {
  fileId: string;
  title: string;
  year?: number;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  quality?: string;
  tmdbId?: number;
  status: "ok" | "miss" | "no-key";
  fetchedAt: number;
}

export interface AppSettings {
  preferredSubtitleLanguage: string; // e.g. "vi", "en"
  autoplayNext: boolean;
  defaultVolume: number; // 0..1
  theme: "system" | "light" | "dark";
}

export const DEFAULT_SETTINGS: AppSettings = {
  preferredSubtitleLanguage: "vi",
  autoplayNext: true,
  defaultVolume: 1.0,
  theme: "dark",
};
