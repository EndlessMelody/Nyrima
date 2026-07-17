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
  BookOpen,
  BookText,
  Clock3,
  Cloud,
  Download,
  FileText,
  Film,
  FolderOpen,
  Heart,
  History,
  Home,
  LibraryBig,
  Moon,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { NyrimaMark } from "./NyrimaMark";
import { UserChip } from "./UserChip";
import { NotificationsBell } from "./NotificationsBell";
import { useTheme } from "../providers/AppProviders";
import { useSettingsStore } from "../stores/settings-store";
import { useSocialStore } from "../stores/social-store";
import { useNyrimaRootStore } from "../stores/nyrima-root-store";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
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
  social: Users,
  posts: FileText,
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
          <span className="ny-sidebar__wordmark ny-wordmark">Nyrima</span>
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
  searchPlaceholder = "Search worlds, anime, movies, music...",
}: {
  query: string;
  onQueryChange: (query: string) => void;
  inputRef?: RefObject<HTMLInputElement>;
  searchPlaceholder?: string;
}) {
  const navigate = useNavigate();
  const unreadCount = useSocialStore((s) => s.unreadCount);
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
        <ConnectionStatus />
        <ThemeToggleButton />
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
        <NotificationsBell />
        <UserChip />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// ThemeToggleButton — one-click dark/light flip. Deterministic by design: a
// topbar toggle needs a single obvious next state, so it always resolves to
// an explicit light/dark. "System" stays available in UserCenter + Appearance.
// ---------------------------------------------------------------------------

function ThemeToggleButton() {
  const { resolved, setMode } = useTheme();
  const patch = useSettingsStore((s) => s.patch);
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="ny-command-bar__icon"
      onClick={() => {
        setMode(next);
        void patch({ theme: next });
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {resolved === "dark" ? <Sun /> : <Moon />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ConnectionStatus — replaces the old static "Nyrima Online" engraving with
// the actual guest / offline / Drive-connection state.
// ---------------------------------------------------------------------------

function ConnectionStatus() {
  const { status } = useAuth();
  const isOnline = useOnlineStatus();
  const root = useNyrimaRootStore((s) => s.root);
  const rootError = useNyrimaRootStore((s) => s.rootError);

  let tone: "ok" | "warn" | "off";
  let label: string;
  if (status === "guest") {
    tone = "warn";
    label = "Guest Mode";
  } else if (!isOnline) {
    tone = "off";
    label = "Offline";
  } else if (root && !rootError) {
    tone = "ok";
    label = `Drive Connected · ${root.name}`;
  } else {
    tone = "off";
    label = "Drive Not Connected";
  }

  return (
    <span className={`ny-command-bar__status ny-command-bar__status--${tone}`} aria-hidden="true">
      <span className="ny-command-bar__status-dot" />
      {label}
    </span>
  );
}
