/**
 * Account Center registry — the single typed model that drives the sidebar
 * nav, the content pane, and settings search.
 *
 * `SECTIONS` renders the grouped sidebar (USER SETTINGS / APP SETTINGS) and
 * maps each id to its content component. `SETTING_ENTRIES` is the
 * fine-grained search index: every row a user might type for, tagged with the
 * section that owns it and the `data-setting-id` the section stamps on the
 * row so search can scroll-to + highlight it.
 */

import type { ComponentType } from "react";
import {
  Captions,
  Cable,
  Database,
  KeyRound,
  LayoutDashboard,
  MonitorPlay,
  Palette,
  UserRound,
  IdCard,
  type LucideIcon,
} from "lucide-react";
import { MyAccountSection } from "./sections/MyAccountSection";
import { ProfileSection } from "./sections/ProfileSection";
import { PublicProfileSection } from "./sections/PublicProfileSection";
import { ConnectionsSection } from "./sections/ConnectionsSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { PlaybackSection } from "./sections/PlaybackSection";
import { SubtitlesSection } from "./sections/SubtitlesSection";
import { LibraryStorageSection } from "./sections/LibraryStorageSection";
import { AdvancedSection } from "./sections/AdvancedSection";

export type SectionId =
  | "my-account"
  | "profile"
  | "public-profile"
  | "connections"
  | "appearance"
  | "playback"
  | "subtitles"
  | "library-storage"
  | "advanced";

export interface SectionProps {
  /** Set when the user arrived via settings search — the section's row with
   *  this `data-setting-id` gets scrolled into view and pulsed. */
  highlightSettingId: string | null;
}

export interface AccountCenterSection {
  id: SectionId;
  label: string;
  group: "user" | "app";
  Icon: LucideIcon;
  Component: ComponentType<SectionProps>;
  keywords: string[];
}

export const SECTION_GROUPS: Record<AccountCenterSection["group"], string> = {
  user: "User Settings",
  app: "App Settings",
};

export const SECTIONS: AccountCenterSection[] = [
  {
    id: "my-account",
    label: "My Account",
    group: "user",
    Icon: UserRound,
    Component: MyAccountSection,
    keywords: ["account", "email", "sign out", "log out", "guest", "member"],
  },
  {
    id: "profile",
    label: "Profile",
    group: "user",
    Icon: IdCard,
    Component: ProfileSection,
    keywords: ["nickname", "avatar", "banner", "display name", "identity"],
  },
  {
    id: "public-profile",
    label: "Public Profile",
    group: "user",
    Icon: LayoutDashboard,
    Component: PublicProfileSection,
    keywords: ["dashboard", "handle", "bio", "genres", "pinned", "social links", "badges", "heatmap"],
  },
  {
    id: "connections",
    label: "Connections",
    group: "user",
    Icon: Cable,
    Component: ConnectionsSection,
    keywords: ["google drive", "connect", "disconnect", "oauth", "link"],
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "app",
    Icon: Palette,
    Component: AppearanceSection,
    keywords: ["theme", "dark", "light", "color", "accent", "motion", "banner"],
  },
  {
    id: "playback",
    label: "Playback",
    group: "app",
    Icon: MonitorPlay,
    Component: PlaybackSection,
    keywords: ["autoplay", "volume", "skip", "video", "player"],
  },
  {
    id: "subtitles",
    label: "Subtitles",
    group: "app",
    Icon: Captions,
    Component: SubtitlesSection,
    keywords: ["subtitle", "font", "typography", "captions", "outline"],
  },
  {
    id: "library-storage",
    label: "Library & Storage",
    group: "app",
    Icon: Database,
    Component: LibraryStorageSection,
    keywords: ["library", "density", "sort", "view", "cache", "history", "clear"],
  },
  {
    id: "advanced",
    label: "Advanced",
    group: "app",
    Icon: KeyRound,
    Component: AdvancedSection,
    keywords: ["api key", "oauth client", "credentials", "about", "version"],
  },
];

export function getSection(id: string | null): AccountCenterSection {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}

// ---------------------------------------------------------------------------
// Settings search index
// ---------------------------------------------------------------------------

export interface SettingEntry {
  /** Matches the `data-setting-id` attribute the owning section renders. */
  settingId: string;
  sectionId: SectionId;
  label: string;
  keywords: string[];
}

export const SETTING_ENTRIES: SettingEntry[] = [
  // My Account
  { settingId: "account-identity", sectionId: "my-account", label: "Nyrima account", keywords: ["email", "signed in", "member since"] },
  { settingId: "account-sign-out", sectionId: "my-account", label: "Sign out", keywords: ["log out", "logout", "exit"] },
  // Profile
  { settingId: "profile-nickname", sectionId: "profile", label: "Nickname", keywords: ["display name", "name"] },
  { settingId: "profile-avatar", sectionId: "profile", label: "Avatar", keywords: ["picture", "photo", "image"] },
  { settingId: "profile-banner", sectionId: "profile", label: "Profile banner", keywords: ["banner", "cover", "header image"] },
  // Public Profile
  { settingId: "public-profile-handle", sectionId: "public-profile", label: "Handle", keywords: ["handle", "dashboard link", "u/"] },
  { settingId: "public-profile-bio", sectionId: "public-profile", label: "Bio", keywords: ["caption", "about", "bio"] },
  { settingId: "public-profile-genres", sectionId: "public-profile", label: "Favorite genres", keywords: ["genres", "tags", "interests"] },
  { settingId: "public-profile-pinned", sectionId: "public-profile", label: "Pinned item", keywords: ["pinned", "library", "post", "showcase"] },
  { settingId: "public-profile-links", sectionId: "public-profile", label: "Social links", keywords: ["links", "mal", "anilist", "website"] },
  // Connections
  { settingId: "connection-drive", sectionId: "connections", label: "Google Drive connection", keywords: ["drive", "connect", "disconnect", "oauth", "google"] },
  // Appearance
  { settingId: "appearance-theme", sectionId: "appearance", label: "Theme", keywords: ["dark", "light", "system", "mode"] },
  { settingId: "appearance-accent", sectionId: "appearance", label: "Accent color", keywords: ["pink", "color", "lamp", "violet", "cyan", "amber"] },
  { settingId: "appearance-reduced-motion", sectionId: "appearance", label: "Reduced motion", keywords: ["animation", "motion", "accessibility"] },
  { settingId: "appearance-landing", sectionId: "appearance", label: "Default landing page", keywords: ["home", "start page", "startup"] },
  { settingId: "appearance-lobby-banner", sectionId: "appearance", label: "Lobby banner", keywords: ["banner", "lobby", "dashboard image"] },
  // Playback
  { settingId: "playback-autoplay", sectionId: "playback", label: "Auto-play next", keywords: ["autoplay", "next episode", "continue"] },
  { settingId: "playback-volume", sectionId: "playback", label: "Default volume", keywords: ["volume", "audio", "sound", "loudness"] },
  { settingId: "playback-skip", sectionId: "playback", label: "Skip duration", keywords: ["skip", "seek", "jump", "seconds"] },
  // Subtitles
  { settingId: "subtitles-typography", sectionId: "subtitles", label: "Subtitle typography", keywords: ["font", "size", "color", "outline", "shadow", "position"] },
  // Library & Storage
  { settingId: "library-density", sectionId: "library-storage", label: "Library density", keywords: ["compact", "comfortable", "grid", "spacing"] },
  { settingId: "library-defaults", sectionId: "library-storage", label: "Library sort & view", keywords: ["sort", "view", "grid", "list", "grouped"] },
  { settingId: "storage-history", sectionId: "library-storage", label: "Clear watch history", keywords: ["history", "positions", "reset", "watched"] },
  { settingId: "storage-cache", sectionId: "library-storage", label: "Clear metadata cache", keywords: ["cache", "thumbnails", "metadata", "reset"] },
  // Advanced
  { settingId: "advanced-api", sectionId: "advanced", label: "API credentials", keywords: ["api key", "oauth client id", "byok", "google"] },
  { settingId: "advanced-about", sectionId: "advanced", label: "About Nyrima", keywords: ["version", "build", "info"] },
];

export interface SearchResult extends SettingEntry {
  sectionLabel: string;
}

/** Ranked search over the settings index: label prefix > label substring >
 *  keyword substring. Stable within a rank (registry order). */
export function searchSettings(query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranked: { rank: number; entry: SettingEntry }[] = [];
  for (const entry of SETTING_ENTRIES) {
    const label = entry.label.toLowerCase();
    let rank = 0;
    if (label.startsWith(q)) rank = 3;
    else if (label.includes(q)) rank = 2;
    else if (entry.keywords.some((k) => k.toLowerCase().includes(q))) rank = 1;
    if (rank > 0) ranked.push({ rank, entry });
  }
  ranked.sort((a, b) => b.rank - a.rank);
  return ranked.map(({ entry }) => ({
    ...entry,
    sectionLabel: getSection(entry.sectionId).label,
  }));
}
