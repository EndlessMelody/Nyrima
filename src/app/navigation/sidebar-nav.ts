export type SidebarNavItemId =
  | "home"
  | "library"
  | "movies"
  | "manga"
  | "light-novel"
  | "music"
  | "favorites"
  | "continue"
  | "history"
  | "downloads"
  | "google-drive"
  | "local-folder";

export type SidebarNavIcon =
  | "home"
  | "library"
  | "movies"
  | "manga"
  | "light-novel"
  | "music"
  | "favorites"
  | "continue"
  | "history"
  | "downloads"
  | "google-drive"
  | "local-folder";

export interface SidebarNavItem {
  id: SidebarNavItemId;
  label: string;
  icon: SidebarNavIcon;
  path?: string;
  action?: "open-drive-source";
}

export interface SidebarNavSection {
  label: string;
  items: SidebarNavItem[];
}

export const HOME_ROUTE = "/app";
export const LIBRARY_ROUTE = "/library";

export const SIDEBAR_NAV_SECTIONS: SidebarNavSection[] = [
  {
    label: "Browse",
    items: [
      { id: "home", label: "Home", path: HOME_ROUTE, icon: "home" },
      { id: "library", label: "Library", path: LIBRARY_ROUTE, icon: "library" },
      { id: "movies", label: "Movies", path: "/library/movies", icon: "movies" },
      { id: "manga", label: "Manga", path: "/library/manga", icon: "manga" },
      {
        id: "light-novel",
        label: "Light Novel",
        path: "/library/light-novel",
        icon: "light-novel",
      },
      { id: "music", label: "Music", path: "/library/music", icon: "music" },
    ],
  },
  {
    label: "Quick Access",
    items: [
      { id: "favorites", label: "Favorites", path: "/library/favorites", icon: "favorites" },
      { id: "continue", label: "Continue", path: "/library/continue", icon: "continue" },
      { id: "history", label: "History", path: "/library/history", icon: "history" },
      {
        id: "downloads",
        label: "Downloads",
        path: "/library/downloads",
        icon: "downloads",
      },
    ],
  },
  {
    label: "Sources",
    items: [
      {
        id: "google-drive",
        label: "Google Drive",
        icon: "google-drive",
        action: "open-drive-source",
      },
      {
        id: "local-folder",
        label: "Local Folder",
        path: "/library/local-folder",
        icon: "local-folder",
      },
    ],
  },
];

const ROUTE_TO_ID = new Map(
  getSidebarNavItems().map((item) => [normalizePathname(item.path!), item.id]),
);

const LIBRARY_CHROME_ROUTES = new Set(
  getSidebarNavItems()
    .map((item) => normalizePathname(item.path!))
    .filter((path) => path === LIBRARY_ROUTE || path.startsWith(`${LIBRARY_ROUTE}/`)),
);

export function getSidebarNavItems(): Array<SidebarNavItem & { path: string }> {
  return SIDEBAR_NAV_SECTIONS.flatMap((section) => section.items).filter(
    (item): item is SidebarNavItem & { path: string } => typeof item.path === "string",
  );
}

export function resolveSidebarActiveId(pathname: string): SidebarNavItemId {
  const normalized = normalizePathname(pathname);
  const exact = ROUTE_TO_ID.get(normalized);
  if (exact) return exact;
  if (normalized.startsWith(`${LIBRARY_ROUTE}/`)) return "library";
  return "home";
}

export function isLibraryChromeRoute(pathname: string): boolean {
  return LIBRARY_CHROME_ROUTES.has(normalizePathname(pathname));
}

function normalizePathname(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || "/";
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}
