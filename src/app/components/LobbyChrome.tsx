/**
 * LobbyChrome — the reusable desktop app chrome (sidebar + command bar + shell
 * grid) shared by the lobby dashboard and the unified Library hub.
 *
 * The markup and class names mirror the lobby's own chrome so both surfaces
 * stay visually identical (dark glass, neon "world index rail" sidebar, sticky
 * command deck topbar). All of the styling lives in `LobbyPage.scss`, which we
 * import here so the chrome is fully styled wherever it's mounted — even on
 * routes that never render `LobbyPage` itself.
 *
 * Differences from the lobby's private copy:
 *   - The sidebar is route-aware and reads its primary links from the shared
 *     sidebar navigation config. The Drive source action is forwarded to the
 *     host page as an optional non-route utility.
 *   - The shell's bottom player dock is optional; pages that don't own a player
 *     pass `player={undefined}` and the grid collapses that row.
 */

import { type ReactNode, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import cn from "classnames";
import {
  Bell,
  BookOpen,
  BookText,
  Clock3,
  Cloud,
  Download,
  Film,
  FolderOpen,
  Heart,
  History,
  Home,
  LibraryBig,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { NyrimaMark } from "./NyrimaMark";
import { UserChip } from "./UserChip";
import {
  SIDEBAR_NAV_SECTIONS,
  resolveSidebarActiveId,
  type SidebarNavIcon,
} from "../navigation/sidebar-nav";
import "../pages/LobbyPage.scss";

// ---------------------------------------------------------------------------
// LobbyShell — the full-height app grid: sidebar | main, with an optional
// player dock pinned to the bottom row.
// ---------------------------------------------------------------------------

export function LobbyShell({
  collapsed,
  sidebar,
  topbar,
  player,
  children,
}: {
  collapsed: boolean;
  sidebar: ReactNode;
  topbar: ReactNode;
  player?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("ny-lobby-shell", {
        "is-sidebar-collapsed": collapsed,
        "ny-lobby-shell--no-dock": !player,
      })}
      style={{
        ["--sidebar-width" as string]: collapsed
          ? "var(--sidebar-collapsed-width)"
          : "var(--sidebar-expanded-width)",
      }}
    >
      {sidebar}
      <main className="ny-lobby-main">
        {topbar}
        <div className="ny-lobby-main__scroll">{children}</div>
      </main>
      {player}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LobbySidebar — the "World Index Rail". Same structure as the lobby's rail so
// the two pages share one visual language; navigation is route-driven.
// ---------------------------------------------------------------------------

const SIDEBAR_ICONS: Record<SidebarNavIcon, LucideIcon> = {
  home: Home,
  library: LibraryBig,
  movies: Film,
  manga: BookOpen,
  "light-novel": BookText,
  music: Music,
  favorites: Heart,
  continue: Clock3,
  history: History,
  downloads: Download,
  "google-drive": Cloud,
  "local-folder": FolderOpen,
};

export function LobbySidebar({
  collapsed,
  onToggle,
  onOpenDrive,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** Open the Drive setup dialog (Sources → Google Drive). */
  onOpenDrive?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const activeId = resolveSidebarActiveId(location.pathname);

  return (
    <aside className="ny-sidebar" aria-label="Primary navigation">
      <div className="ny-sidebar__brand-row">
        <button
          type="button"
          className="ny-sidebar__brand"
          onClick={() => navigate("/app")}
          aria-label="Go to Nyrima home"
        >
          <NyrimaMark size="header" />
          <span className="ny-sidebar__wordmark">Nyrima</span>
        </button>
        <button
          type="button"
          className="ny-sidebar__toggle"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </div>

      <nav className="ny-sidebar__nav">
        {SIDEBAR_NAV_SECTIONS.map((section) => (
          <div className="ny-sidebar__section" key={section.label}>
            <span className="ny-sidebar__section-label">{section.label}</span>
            <div className="ny-sidebar__section-items">
              {section.items.map((item) => {
                const Icon = SIDEBAR_ICONS[item.icon];
                const active = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn("ny-sidebar__item", {
                      "is-active": active,
                    })}
                    onClick={() => {
                      if (item.path) navigate(item.path);
                      else if (item.action === "open-drive-source") onOpenDrive?.();
                    }}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon aria-hidden="true" />
                    <span className="ny-sidebar__item-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// LobbyTopbar — the "Command Deck": sticky search field, status engraving, and
// the source / profile cluster. Identical spacing and behavior to the lobby.
// ---------------------------------------------------------------------------

export function LobbyTopbar({
  query,
  onQueryChange,
  inputRef,
  unreadCount,
  searchPlaceholder = "Search worlds, anime, movies, music...",
}: {
  query: string;
  onQueryChange: (query: string) => void;
  inputRef?: RefObject<HTMLInputElement>;
  unreadCount: number;
  searchPlaceholder?: string;
}) {
  const navigate = useNavigate();
  return (
    <header className="ny-command-bar">
      <label className="ny-command-bar__search" aria-label="Search your library">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="ny-command-bar__shortcut" aria-hidden="true">
          Ctrl K
        </span>
        <span className="ny-command-bar__shortcut" aria-hidden="true">
          /
        </span>
      </label>

      <div className="ny-command-bar__actions">
        <span className="ny-command-bar__status" aria-hidden="true">
          <span className="ny-command-bar__status-dot" />
          Every World, One Archive <i>//</i> Nyrima Online
        </span>
        <button
          type="button"
          className="ny-command-bar__action"
          onClick={() => navigate("/app")}
        >
          <LibraryBig />
          <span>Libraries</span>
        </button>
        <button
          type="button"
          className="ny-command-bar__action"
          onClick={() => navigate("/social")}
        >
          <Users />
          <span>Social</span>
          {unreadCount > 0 && (
            <span
              className="ny-command-bar__badge"
              aria-label={`${unreadCount} unread`}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <button
          type="button"
          className="ny-command-bar__action"
          onClick={() => navigate("/settings")}
        >
          <Settings />
          <span>Settings</span>
        </button>
        <button
          type="button"
          className="ny-command-bar__icon"
          onClick={() => navigate("/social")}
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell />
          {unreadCount > 0 && <span className="ny-command-bar__dot" />}
        </button>
        <UserChip />
      </div>
    </header>
  );
}
