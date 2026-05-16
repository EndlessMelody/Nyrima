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

/** The single Nyrima root folder. Persisted once at onboarding; re-validated
 *  on every refresh so a renamed/missing folder surfaces immediately. */
export interface NyrimaRoot {
  id: string;
  /** The Drive folder's actual name at verification time. Used for display
   *  and so we can detect when the user renames it on Drive. */
  name: string;
  verifiedAt: number; // epoch ms
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

/** Built-in subtitle font presets the picker exposes. "custom" means the
 *  user uploaded their own .woff2/.ttf — the file lives in
 *  `subtitleCustomFontDataUrl` and is registered via @font-face on load.
 *
 *  Renamed from the old `comic`/`geist` keys so the picker labels actually
 *  describe what the user sees: `anime-brush` is the fansub-flavored Comic
 *  Neue stack (the one the old "Comic Sans" preset really rendered as),
 *  `comic-dialogue` prefers the literal Comic Sans face when present, and
 *  `clean-sans` is the Geist Sans body stack. */
export type SubtitleFontPreset =
  | "anime-brush"
  | "comic-dialogue"
  | "clean-sans"
  | "system"
  | "custom";

export interface AppSettings {
  preferredSubtitleLanguage: string; // e.g. "vi", "en"
  autoplayNext: boolean;
  defaultVolume: number; // 0..1
  theme: "system" | "light" | "dark";

  /** Multiplier applied on top of the base subtitle font-size. 1.0 = 100 %.
   *  UI exposes a 0.5–2.0 slider; defaults to 1.0 windowed and is the same
   *  multiplier in fullscreen (the base size itself is larger in fullscreen
   *  via CSS, see SubtitleOverlay.scss). */
  subtitleScale: number;
  /** Which font family the SubtitleOverlay should render with. */
  subtitleFont: SubtitleFontPreset;
  /** Display name of the user-uploaded font (for the picker label). */
  subtitleCustomFontName?: string;
  /** data: URL containing the woff2/ttf bytes — registered as @font-face
   *  family name `Nyrima Custom Sub` on app boot when present. */
  subtitleCustomFontDataUrl?: string;
  /** CSS font-weight applied to subtitle cues (400/500/600/700/800/900). */
  subtitleWeight: 400 | 500 | 600 | 700 | 800 | 900;
  /** CSS color for the subtitle fill. Hex, e.g. "#e8e8e8". */
  subtitleColor: string;
  /** Hex color of the painted stroke around each glyph. */
  subtitleOutlineColor: string;
  /** Stroke width in px (0 disables the outline). */
  subtitleOutlineWidth: number;
  /** Soft-shadow strength multiplier; 0 = none, 1 = default, up to 2. */
  subtitleShadow: number;
  /** CSS letter-spacing in em (e.g. 0.02). Range -0.05..0.2. */
  subtitleLetterSpacing: number;
  /** Vertical baseline offset as a 0..1 fraction of viewport height from the
   *  bottom. 0 = stuck to bottom edge, 0.5 = halfway up. */
  subtitlePosition: number;
  /** Seconds the skip-back / skip-forward HUD buttons jump by. */
  skipSeconds: 5 | 10 | 15 | 30;
}

export const DEFAULT_SETTINGS: AppSettings = {
  preferredSubtitleLanguage: "vi",
  autoplayNext: true,
  defaultVolume: 1.0,
  theme: "dark",
  subtitleScale: 1.0,
  subtitleFont: "anime-brush",
  subtitleWeight: 700,
  subtitleColor: "#e8e8e8",
  subtitleOutlineColor: "#000000",
  subtitleOutlineWidth: 2.5,
  subtitleShadow: 1,
  subtitleLetterSpacing: 0.01,
  subtitlePosition: 0,
  skipSeconds: 10,
};
