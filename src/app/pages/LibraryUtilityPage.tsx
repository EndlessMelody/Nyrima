import { useRef, useState } from "react";
import {
  Download,
  FolderOpen,
  Heart,
  History,
  LibraryBig,
  PlayCircle,
  type LucideIcon,
} from "lucide-react";
import { LobbyShell, LobbySidebar, LobbyTopbar } from "../components/LobbyChrome";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import { LibraryHeroHeader, LibraryStatePanel, LocalFolderPanel, localFolderTotalLabel } from "../components/library-hub";
import { useLocalLibraryStore } from "../services/local-library/local-library-store";
import "./AllLibraryPage.scss";

export type LibraryUtilityKind =
  | "favorites"
  | "continue"
  | "history"
  | "downloads"
  | "local-folder";

interface UtilityDefinition {
  title: string;
  brandLabel: string;
  subtitle: string;
  statusLabel: string;
  icon: LucideIcon;
  tracker: string;
  emptyTitle: string;
  emptyMessage: string;
}

const UTILITY_DEFINITIONS: Record<LibraryUtilityKind, UtilityDefinition> = {
  favorites: {
    title: "Favorites",
    brandLabel: "Nyrima Favorites",
    subtitle: "Pinned media from your connected library sources.",
    statusLabel: "No favorites indexed",
    icon: Heart,
    tracker: "Empty quick access",
    emptyTitle: "No favorites yet",
    emptyMessage: "Favorite support is source-aware. Items will appear here once a connected source exposes pinned media.",
  },
  continue: {
    title: "Continue",
    brandLabel: "Nyrima Continue",
    subtitle: "Resume media with real saved progress.",
    statusLabel: "No progress indexed",
    icon: PlayCircle,
    tracker: "Empty quick access",
    emptyTitle: "Nothing to continue yet",
    emptyMessage: "Watch or read something from a supported source and it will appear here.",
  },
  history: {
    title: "History",
    brandLabel: "Nyrima History",
    subtitle: "Recent activity from indexed playback and reading sources.",
    statusLabel: "No history indexed",
    icon: History,
    tracker: "Empty quick access",
    emptyTitle: "No history yet",
    emptyMessage: "Nyrima will show real activity here after media has been opened from connected sources.",
  },
  downloads: {
    title: "Downloads",
    brandLabel: "Nyrima Downloads",
    subtitle: "Offline-ready items from sources that support local download state.",
    statusLabel: "No downloads indexed",
    icon: Download,
    tracker: "Source unavailable",
    emptyTitle: "Downloads are not indexed yet",
    emptyMessage: "No connected source currently reports offline download state to Nyrima.",
  },
  "local-folder": {
    title: "Local Folder",
    brandLabel: "Nyrima Local",
    subtitle: "Local source access for media stored outside Google Drive.",
    statusLabel: "Not connected",
    icon: FolderOpen,
    tracker: "Local source",
    emptyTitle: "Local folder source is not connected",
    emptyMessage: "Local folder indexing is not available in this build. Google Drive remains the active source.",
  },
};

export function LibraryUtilityPage({ kind }: { kind: LibraryUtilityKind }) {
  const definition = UTILITY_DEFINITIONS[kind];
  const [collapsed, setCollapsed] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < 1280,
  );
  const [query, setQuery] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const Icon = definition.icon;

  const localStatus = useLocalLibraryStore((s) => s.status);
  const localScans = useLocalLibraryStore((s) => s.scans);
  const totalLabel =
    kind === "local-folder" ? localFolderTotalLabel(localStatus, localScans) : definition.statusLabel;

  return (
      <LobbyShell
      collapsed={collapsed}
      sidebar={
        <LobbySidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
          onOpenDrive={() => setSetupOpen(true)}
        />
      }
      topbar={
        <LobbyTopbar
          query={query}
          onQueryChange={setQuery}
          inputRef={searchInputRef}
          searchPlaceholder={`Search ${definition.title.toLowerCase()}...`}
        />
      }
    >
      <div className="lib-page">
        <LibraryHeroHeader
          totalLabel={totalLabel}
          title={definition.title}
          brandLabel={definition.brandLabel}
          subtitle={definition.subtitle}
          icon={<Icon />}
        />
        {kind === "local-folder" ? (
          <LocalFolderPanel />
        ) : (
          <LibraryStatePanel
            icon={<LibraryBig />}
            tracker={definition.tracker}
            title={definition.emptyTitle}
            message={definition.emptyMessage}
            tone="accent"
          />
        )}
      </div>
      <SetupAccessDialog
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onSaved={() => setSetupOpen(false)}
      />
      </LobbyShell>
  );
}
