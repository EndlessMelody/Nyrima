/**
 * Lobby — Neon Drive Cinema dashboard.
 *
 * Library shelf sourcing has changed: instead of "every folder you've ever
 * opened" (the old recents list), the shelf renders the immediate child
 * folders of the user's verified Nyrima root. That makes the extension a
 * true cinema bound to a single Drive folder rather than a free-form file
 * browser. See `useNyrimaRootStore` for the validation / wipe flow.
 *
 * Layout strategy:
 *   - No root paired yet → WelcomeBlock + NyrimaRootDialog.
 *   - Paired but root errored (renamed, missing) → block with an error card
 *     that offers "Pick a different folder".
 *   - Otherwise → cinematic dashboard with hero, search/filter, shelves.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Column, Row, Text, Button } from "@once-ui-system/core/components";
import {
  Activity,
  Bell,
  BookOpen,
  BookText,
  Captions,
  ChevronDown,
  Cloud,
  Clock3,
  Database,
  Download,
  Film,
  FolderOpen,
  Gauge,
  Grid2X2,
  HardDrive,
  Heart,
  History,
  Home,
  LibraryBig,
  List,
  ListMusic,
  Maximize2,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Users,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import cn from "classnames";
import { useLocation, useNavigate } from "react-router-dom";
import { useNyrimaRootStore } from "../stores/nyrima-root-store";
import { useRecentStore } from "../stores/recent-store";
import { useSettingsStore } from "../stores/settings-store";
import { useSocialStore } from "../stores/social-store";
import { usePlaybackPositions } from "../hooks/usePlaybackPositions";
import { LibraryCard } from "../components/LibraryCard";
import { ContinueWatchingRow } from "../components/ContinueWatchingRow";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import { NyrimaRootDialog } from "../components/NyrimaRootDialog";
import { ConnectDriveScreen } from "../components/ConnectDriveScreen";
import { GuestBanner } from "../components/GuestBanner";
import { NyrimaMark } from "../components/NyrimaMark";
import { UserChip } from "../components/UserChip";
import { useLibraryHub, type LibraryItem } from "../components/library-hub";
import {
  HOME_ROUTE,
  SIDEBAR_NAV_SECTIONS,
  resolveSidebarActiveId,
  type SidebarNavIcon,
} from "../navigation/sidebar-nav";
import { hasApiKey } from "../services/api-key";
import { getOAuthSessionState } from "../services/auth";
import { getFileMetadata } from "../services/drive/metadata-service";
import { formatTimecode } from "../services/formatters";
import { isInProgress, isWatched } from "../services/storage";
import {
  getCpuInfo,
  getGpuInfo,
  getRamInfo,
  measureDownloadSpeed,
} from "../services/system-info";
import { shuffle, pickSeeded } from "../utils/shuffle";
import type { DriveFile, PlaybackPosition, RecentFolder } from "@shared/types";
import "./LobbyPage.scss";

type DashboardFilter =
  | "all"
  | "continue"
  | "unwatched"
  | "favorites"
  | "recent";

type LibrarySort = "recent" | "name" | "episodes" | "runtime";
type LibraryViewMode = "grid" | "list";
type HomeShelfItem = RecentFolder;

const RECENTLY_ADDED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function padClockPart(value: number) {
  return String(value).padStart(2, "0");
}

function getOrdinalSuffix(value: number) {
  const moduloHundred = value % 100;
  if (moduloHundred >= 11 && moduloHundred <= 13) return "th";

  switch (value % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function homeItemOpenPath(item: LibraryItem): string {
  if (item.type === "movies" && item.fileId && item.folderId) {
    return `/play/${encodeURIComponent(item.folderId)}/${encodeURIComponent(item.fileId)}`;
  }
  return `/library/${encodeURIComponent(item.folderId ?? item.id)}`;
}

function formatArchiveClock(now: Date) {
  const offsetMinutes = -now.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
  const offsetRemainderMinutes = absoluteOffsetMinutes % 60;
  const gmtOffset = `GMT${offsetSign}${padClockPart(offsetHours)}:${padClockPart(
    offsetRemainderMinutes,
  )}`;

  const date = `${now.getFullYear()}-${padClockPart(
    now.getMonth() + 1,
  )}-${padClockPart(now.getDate())}`;
  const time = `${padClockPart(now.getHours())}:${padClockPart(now.getMinutes())}`;
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  const day = now.getDate();
  const month = new Intl.DateTimeFormat("en", { month: "short" }).format(now);

  return {
    date,
    day,
    daySuffix: getOrdinalSuffix(day),
    month,
    time,
    timeZone,
    gmtOffset,
    dateTime: `${date}T${time}:00${offsetSign}${padClockPart(
      offsetHours,
    )}:${padClockPart(offsetRemainderMinutes)}`,
  };
}

// Friendly Ny-chan faces (from public/ny_chan/<face>.png) used to give the
// "Nyrima Pick" shelf some personality. Kept to upbeat expressions so a
// suggestion never reads as panicked/teary; one is chosen at random per visit.
const NY_CHAN_PICK_FACES = [
  "adoring",
  "determined",
  "happy",
  "pointing",
  "proud",
  "smug",
  "surprised",
  "thinking",
  "shy",
] as const;

type NyChanPickFace = (typeof NY_CHAN_PICK_FACES)[number];

function pickNyChanFace(previousFace?: NyChanPickFace): NyChanPickFace {
  const availableFaces =
    previousFace && NY_CHAN_PICK_FACES.length > 1
      ? NY_CHAN_PICK_FACES.filter((face) => face !== previousFace)
      : NY_CHAN_PICK_FACES;

  return availableFaces[Math.floor(Math.random() * availableFaces.length)];
}

export function LobbyPage() {
  const root = useNyrimaRootStore((s) => s.root);
  const rootLoading = useNyrimaRootStore((s) => s.loading);
  const rootError = useNyrimaRootStore((s) => s.rootError);
  const loadRoot = useNyrimaRootStore((s) => s.load);
  const refreshRoot = useNyrimaRootStore((s) => s.refresh);

  const { load: loadRecents } = useRecentStore();
  const [setupOpen, setSetupOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("setup") === "1";
    }
    return false;
  });
  const [rootDialogOpen, setRootDialogOpen] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [oauthActive, setOAuthActive] = useState<boolean | null>(null);
  const [positions] = usePlaybackPositions();
  const [continueFile, setContinueFile] = useState<DriveFile | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DashboardFilter>("all");
  const [sortKey, setSortKey] = useState<LibrarySort>("recent");
  const [viewMode, setViewMode] = useState<LibraryViewMode>("grid");
  // Subfolders of the libraries, discovered cheaply from the warm folder-scan
  // cache (no extra network). Feeds the "Nyrima Pick" candidate pool so picks
  // can surface a deeper folder, not just a top-level library.
  const [subfolderCandidates, setSubfolderCandidates] = useState<
    RecentFolder[]
  >([]);
  // Ny-chan's expression is random per visit and rerollable from the banner.
  const [mascotFace, setMascotFace] = useState<NyChanPickFace>(() =>
    pickNyChanFace(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < 1280,
  );
  // True only for the brief sidebar collapse/expand transition. While set, the
  // shell sheds its expensive paint work (backdrop blurs + ambient loops) so
  // the layout-driven rail-width animation can hit frame rate. See the
  // `.is-sidebar-animating` rules in LobbyPage.scss.
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  const sidebarAnimTimer = useRef<number | undefined>(undefined);
  const [randomBusy, setRandomBusy] = useState(false);
  const [randomError, setRandomError] = useState<string | null>(null);
  // Bumped by "Refresh Library" to re-trigger the background enrichment pass
  // (poster-cache rebuild) even when the library list itself is unchanged.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const mascotRouteKeyRef = useRef(location.key);
  const isOnline = useOnlineStatus();
  const unreadCount = useSocialStore((s) => s.unreadCount);
  const customBannerUrl = useSettingsStore(
    (s) => s.settings.lobbyBannerImageDataUrl,
  );
  const libraryHub = useLibraryHub();

  const handleRollMascotFace = () => {
    setMascotFace((currentFace) => pickNyChanFace(currentFace));
  };

  // Toggle the rail and flag the shell as "animating" for the transition's
  // duration. The CSS keeps the duration in sync (280ms width + a little
  // settle); 360ms covers it without leaving the heavy paint suppressed.
  const handleToggleSidebar = () => {
    setSidebarCollapsed((v) => !v);
    setSidebarAnimating(true);
    if (sidebarAnimTimer.current !== undefined) {
      window.clearTimeout(sidebarAnimTimer.current);
    }
    sidebarAnimTimer.current = window.setTimeout(() => {
      setSidebarAnimating(false);
      sidebarAnimTimer.current = undefined;
    }, 360);
  };

  useEffect(
    () => () => {
      if (sidebarAnimTimer.current !== undefined) {
        window.clearTimeout(sidebarAnimTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (mascotRouteKeyRef.current === location.key) return;

    mascotRouteKeyRef.current = location.key;
    setMascotFace((currentFace) => pickNyChanFace(currentFace));
  }, [location.key]);

  // The lobby owns the command search because `/app` no longer renders the
  // global AppShell topbar. `/` and Ctrl/Cmd+K focus the library search; Esc
  // clears it while focused.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isCommandK =
        e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey);
      if ((e.key === "/" || isCommandK) && !isTypingTarget(target)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "Escape" && target === searchInputRef.current && query) {
        e.preventDefault();
        setQuery("");
        searchInputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query]);

  useEffect(() => {
    void loadRoot();
    void loadRecents();
  }, [loadRoot, loadRecents]);

  // Auto-refresh the Nyrima scan on a fresh visit so a folder added to Drive
  // a moment ago shows up without the user clicking refresh.
  useEffect(() => {
    if (root) void refreshRoot();
  }, [root, refreshRoot]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const has = await hasApiKey();
      if (!cancelled) setKeyConfigured(has);
    }
    void refresh();
    const onChanged = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === "local" && "dc.apiKey" in changes) void refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  // OAuth-only sign-ins never touch `dc.apiKey`, so the dashboard gate can't
  // rely on `keyConfigured` alone — that would trap OAuth-only users on the
  // onboarding screen forever. This runs once on mount; a fresh Connect Drive
  // consent always returns via a full-page redirect (AuthGoogleCallbackPage),
  // which remounts this page anyway.
  useEffect(() => {
    let cancelled = false;
    void getOAuthSessionState().then((s) => {
      if (!cancelled) setOAuthActive(s.state === "active");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const homeOpenPaths = useMemo<Record<string, string>>(() => {
    const paths: Record<string, string> = {};
    for (const item of libraryHub.items) {
      paths[item.id] = homeItemOpenPath(item);
    }
    return paths;
  }, [libraryHub.items]);

  // Adapt the aggregate indexed media items to the card shape used by the
  // Home shelf. The root's immediate category/source folders are intentionally
  // not rendered here.
  const adaptedFolders = useMemo<HomeShelfItem[]>(() => {
    const fallback = root?.verifiedAt ?? 0;
    return libraryHub.items.map((item) => ({
      id: item.id,
      name: item.title,
      lastOpenedAt: item.updatedAt ?? fallback,
      pinned: item.favorite,
      itemCount: item.episodes,
      videoCount: item.type === "movies" ? 1 : undefined,
      runtimeMs: item.runtimeMs,
      watchedCount: item.watchedCount,
      coverPosterUrl: item.cover,
      newestModifiedAt: item.updatedAt,
      lastSeenAt: item.updatedAt,
      pendingNewCount:
        item.updatedAt && Date.now() - item.updatedAt <= RECENTLY_ADDED_WINDOW_MS ? 1 : undefined,
    }));
  }, [libraryHub.items, root]);

  // The Home shelf now uses aggregate indexed media entries. The old
  // folder-enrichment and subfolder-pick path is intentionally disabled here:
  // raw Drive folders belong in source management, not the media grid.
  useEffect(() => {
    setSubfolderCandidates([]);
  }, [libraryHub.items]);

  // --- Continue / Featured -------------------------------------------------
  // Skip positions without a `folderId` — those came from an earlier bug
  // where `handleTimeUpdate` in PlayerPage didn't stamp folderId on the
  // first save. ContinueHero / Resume would otherwise build `/play//fileId`
  // (router warning + broken navigation). New saves carry folderId from
  // tick zero, so this guard just suppresses legacy orphan rows.
  const mostRecentInProgress = useMemo<PlaybackPosition | null>(() => {
    const inProgress = Object.values(positions).filter(
      (p) => isInProgress(p) && !!p.folderId,
    );
    if (inProgress.length === 0) return null;
    return inProgress.reduce((best, p) =>
      (p.updatedAt ?? 0) > (best.updatedAt ?? 0) ? p : best,
    );
  }, [positions]);

  const continueFolder = useMemo<RecentFolder | undefined>(() => {
    if (!mostRecentInProgress?.folderId) return undefined;
    return adaptedFolders.find((f) => f.id === mostRecentInProgress.folderId);
  }, [adaptedFolders, mostRecentInProgress]);

  useEffect(() => {
    if (!mostRecentInProgress) {
      setContinueFile(null);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const f = await getFileMetadata(mostRecentInProgress.fileId, {
          signal: ctrl.signal,
          priority: "low",
        });
        if (!cancelled) setContinueFile(f);
      } catch {
        if (!cancelled) setContinueFile(null);
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [mostRecentInProgress]);

  // --- Continue Watching stubs (for the horizontal row) --------------------
  // When `ContinueHero` is rendered, the most-recent in-progress item already
  // owns the lobby's top slot — including it in this row would show the same
  // poster twice. Skipping it here makes the two surfaces complementary: hero
  // = "your last episode", row = "everything else you've started".
  const heroFileId = mostRecentInProgress?.fileId;
  const continueFiles = useMemo<DriveFile[]>(
    () =>
      Object.values(positions)
        .filter((p) => p.name && p.folderId && p.fileId !== heroFileId)
        .map(
          (p) =>
            ({
              id: p.fileId,
              name: p.name!,
              mimeType: p.mimeType || "video/mp4",
              modifiedTime: p.updatedAt
                ? new Date(p.updatedAt).toISOString()
                : undefined,
            }) as DriveFile,
        ),
    [positions, heroFileId],
  );

  // --- Folder filtering ----------------------------------------------------
  const inProgressFolderIds = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const p of Object.values(positions)) {
      if (isInProgress(p) && p.folderId) set.add(p.folderId);
      if (isInProgress(p) && p.fileId) set.add(p.fileId);
    }
    return set;
  }, [positions]);

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    return adaptedFolders.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q)) return false;
      if (filter === "continue" && !inProgressFolderIds.has(f.id)) return false;
      if (filter === "unwatched" && inProgressFolderIds.has(f.id)) return false;
      if (filter === "favorites" && !f.pinned) return false;
      if (
        filter === "recent" &&
        !(
          (f.pendingNewCount ?? 0) > 0 ||
          (f.newestModifiedAt != null &&
            now - f.newestModifiedAt <= RECENTLY_ADDED_WINDOW_MS)
        )
      ) {
        return false;
      }
      return true;
    });
  }, [adaptedFolders, query, filter, inProgressFolderIds]);

  const displayFolders = useMemo(() => {
    const sorted = [...filteredFolders].sort((a, b) => {
      if (sortKey === "name") {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      if (sortKey === "episodes") {
        return (
          (b.videoCount ?? b.itemCount ?? 0) -
          (a.videoCount ?? a.itemCount ?? 0)
        );
      }
      if (sortKey === "runtime") {
        return (b.runtimeMs ?? 0) - (a.runtimeMs ?? 0);
      }
      const bTime = b.newestModifiedAt ?? b.lastOpenedAt ?? 0;
      const aTime = a.newestModifiedAt ?? a.lastOpenedAt ?? 0;
      return bTime - aTime;
    });
    if (filter !== "all") return sorted;
    const pinned = sorted.filter((f) => f.pinned);
    const rest = sorted.filter((f) => !f.pinned);
    return [...pinned, ...rest];
  }, [filteredFolders, filter, sortKey]);

  // --- Curated Home shelves ------------------------------------------------
  // Favorites: pinned libraries, most-recently used first. The curated box
  // shows up to 4 (sliced in the preview grid).
  const favoriteLibraries = useMemo(
    () =>
      [...adaptedFolders]
        .filter((f) => f.pinned)
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
    [adaptedFolders],
  );

  // folderId → most recent playback time, so "Recently Picked" reflects what
  // the user actually played, not merely opened.
  const lastPlayedByFolder = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of Object.values(positions)) {
      const at = p.updatedAt ?? 0;
      if (p.folderId && at > (map.get(p.folderId) ?? 0)) map.set(p.folderId, at);
      if (p.fileId && at > (map.get(p.fileId) ?? 0)) map.set(p.fileId, at);
    }
    return map;
  }, [positions]);

  // Recently Picked: libraries you touched most recently (played → opened →
  // newest imported file as fallbacks), so even a fresh install — where
  // nothing has been opened yet — shows the newest libraries instead of empty.
  const recentlyPicked = useMemo(() => {
    const recencyOf = (f: RecentFolder) =>
      Math.max(
        lastPlayedByFolder.get(f.id) ?? 0,
        f.lastOpenedAt ?? 0,
        f.newestModifiedAt ?? 0,
      );
    return [...adaptedFolders].sort((a, b) => recencyOf(b) - recencyOf(a));
  }, [adaptedFolders, lastPlayedByFolder]);

  // Nyrima Pick: 2 daily-stable suggestions drawn from libraries *and* their
  // subfolders. `pickSeeded` keeps the same picks for the whole day and across
  // re-renders, so a background fetch resolving never reshuffles the shelf.
  const nyrimaPicks = useMemo(() => {
    const seen = new Set<string>();
    const pool = [...adaptedFolders, ...subfolderCandidates].filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
    const seed = `nyrima-pick:${new Date().toISOString().slice(0, 10)}`;
    return pickSeeded(pool, 2, seed, (f) => f.id);
  }, [adaptedFolders, subfolderCandidates]);

  // folderId → user-placed poster URL, for the Continue Watching row. The
  // lobby's row mixes items from many libraries; each card looks up its own
  // folder so a missing Drive frame thumbnail falls back to that library's
  // cover art instead of the empty NyrimaMark tile.
  const postersByFolder = useMemo<Record<string, string | undefined>>(() => {
    const map: Record<string, string | undefined> = {};
    for (const item of libraryHub.items) {
      if (item.cover) {
        map[item.id] = item.cover;
        if (item.folderId) map[item.folderId] = item.cover;
      }
    }
    return map;
  }, [libraryHub.items]);

  const hasRoot = !!root;
  const hasLibraries = adaptedFolders.length > 0;
  const driveReady = !!keyConfigured || !!oauthActive;
  const showFullOnboarding = !driveReady || !hasRoot;
  const watchedAnything = Object.values(positions).some(
    (p) => p && p.positionSeconds > 5,
  );

  // --- Dialog plumbing -----------------------------------------------------
  const handleCloseSetup = () => {
    setSetupOpen(false);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("setup") === "1") {
        params.delete("setup");
        const next = params.toString();
        const url =
          window.location.pathname +
          (next ? `?${next}` : "") +
          window.location.hash;
        window.history.replaceState({}, "", url);
      }
    }
  };

  // "Refresh Library" — the single rescan + repair action surfaced in the
  // hero and the Quick Actions panel. It:
  //   1. Re-validates + re-scans the Nyrima root, so libraries added, removed,
  //      or renamed on Drive surface immediately (handled by `refreshRoot`,
  //      which invalidates the root listing and force-refreshes it).
  //   2. Rebuilds the missing-poster / stale-metadata cache: it drops the
  //      per-session enrichment guard and invalidates the cached listing of
  //      every library that currently lacks a cover, so the background
  //      enrichment pass re-lists those folders against Drive and re-discovers
  //      their `Poster.*` file + recomputes stats. Folders that already have a
  //      poster are left untouched — we never overwrite a user's cover.
  // TODO: a true thumbnail/segment cache rebuild and Local Folder rescan land
  //       once those sources exist; for now this wires the Drive path only.
  const handleRefreshLibrary = () => {
    setRandomError(null);
    void refreshRoot();
    libraryHub.refresh();
    setRefreshNonce((n) => n + 1);
  };

  const handleRandomPlay = () => {
    const playable = libraryHub.items.filter(
      (item) => item.type === "movies" && item.folderId && item.fileId,
    );
    if (playable.length === 0) {
      setRandomError("No supported movie files were found inside Nyrima/Movies.");
      return;
    }
    setRandomBusy(true);
    setRandomError(null);
    const pick = shuffle(playable)[0];
    navigate(`/play/${encodeURIComponent(pick.folderId!)}/${encodeURIComponent(pick.fileId!)}`);
    setRandomBusy(false);
  };

  // --- Render --------------------------------------------------------------
  // No API key OR no Nyrima root → unified LoginScreen. Replaces the prior
  // WelcomeBlock + SetupAccessDialog + NyrimaRootDialog handoff: every step
  // lives on one surface so the user never wonders which button maps to
  // which side of "Drive access".
  if (showFullOnboarding) {
    return (
      <div className="ny-landing">
        <ConnectDriveScreen
          keyConfigured={!!keyConfigured}
          rootPaired={hasRoot}
          rootName={root?.name ?? null}
          onKeySaved={() => setKeyConfigured(true)}
        />
      </div>
    );
  }

  // Root paired but validation failed (renamed, deleted, etc.). Replace the
  // shelf with a block — no point showing stale libraries.
  if (rootError) {
    return (
      <div className="ny-landing">
        <RootErrorCard
          message={rootError.message}
          onPick={() => setRootDialogOpen(true)}
          onRetry={() => void refreshRoot()}
        />
        <DashboardDialogs
          rootDialogOpen={rootDialogOpen}
          setRootDialogOpen={setRootDialogOpen}
          setupOpen={setupOpen}
          handleCloseSetup={handleCloseSetup}
          setKeyConfigured={setKeyConfigured}
        />
      </div>
    );
  }

  const bannerBackdrop = customBannerUrl || "/poster.png";
  const driveStatus = !isOnline
    ? "Offline"
    : driveReady
      ? "Ready"
      : "Needs Login";

  const handleResumeWatching = () => {
    if (!mostRecentInProgress?.folderId) {
      handleRefreshLibrary();
      return;
    }

    navigate(
      `/play/${encodeURIComponent(mostRecentInProgress.folderId)}/${encodeURIComponent(mostRecentInProgress.fileId)}`,
    );
  };

  // Dashboard view (default for returning users).
  return (
      <LobbyShell
        collapsed={sidebarCollapsed}
        animating={sidebarAnimating}
        sidebar={
          <Sidebar
            collapsed={sidebarCollapsed}
            locationPath={location.pathname}
            onToggle={handleToggleSidebar}
            onFilterChange={setFilter}
            onOpenDrive={() => setSetupOpen(true)}
          />
        }
        topbar={
          <TopCommandBar
            query={query}
            onQueryChange={setQuery}
            inputRef={searchInputRef}
            unreadCount={unreadCount}
            onNavigate={(path) => navigate(path)}
          />
        }
        player={
          <ContinuePlayerDock
            position={mostRecentInProgress}
            folder={continueFolder}
            file={continueFile}
            fallbackPosterUrl={continueFolder?.coverPosterUrl}
            onPlayRandom={() => void handleRandomPlay()}
          />
        }
      >
        <div className="ny-lobby-main__guest">
          <GuestBanner />
        </div>

        <section className="ny-hero-section" aria-label="Lobby welcome">
          <WelcomeBanner
            backdropUrl={bannerBackdrop}
            driveStatus={driveStatus}
            rootName={root?.name ?? null}
            mascotFace={mascotFace}
            empty={!hasLibraries}
            randomBusy={randomBusy}
            randomError={randomError}
            canResume={!!mostRecentInProgress?.folderId}
            onResumeWatching={handleResumeWatching}
            onRefreshLibrary={handleRefreshLibrary}
            onRandomPlay={() => void handleRandomPlay()}
            onRollMascotFace={handleRollMascotFace}
          />
        </section>

        <div className="ny-dashboard-split">
          <div className="ny-library-pane">
            <HomeLibraryShelf
              favorites={favoriteLibraries}
              nyrimaPicks={nyrimaPicks}
              recentlyPicked={recentlyPicked}
              browseFolders={displayFolders}
              mascotFace={mascotFace}
              positions={positions}
              query={query}
              filter={filter}
              sortKey={sortKey}
              viewMode={viewMode}
              rootLoading={rootLoading}
              hasLibraries={hasLibraries}
              watchedAnything={watchedAnything}
              continueFiles={continueFiles}
              postersByFolder={postersByFolder}
              openPaths={homeOpenPaths}
              onSortChange={setSortKey}
              onViewModeChange={setViewMode}
              onRefresh={handleRefreshLibrary}
              onResetBrowse={() => {
                setQuery("");
                setFilter("all");
              }}
              onPickRoot={() => setRootDialogOpen(true)}
            />
          </div>

          <div className="ny-health-pane">
            <HealthRail
              folders={adaptedFolders}
              positions={positions}
              apiKeyConfigured={driveReady}
              rootName={root?.name ?? null}
              isOnline={isOnline}
              onPickRoot={() => setRootDialogOpen(true)}
              onOpenSetup={() => setSetupOpen(true)}
              onRefreshLibrary={handleRefreshLibrary}
            />
          </div>
        </div>

        <DashboardDialogs
          rootDialogOpen={rootDialogOpen}
          setRootDialogOpen={setRootDialogOpen}
          setupOpen={setupOpen}
          handleCloseSetup={handleCloseSetup}
          setKeyConfigured={setKeyConfigured}
        />
      </LobbyShell>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function LobbyShell({
  collapsed,
  animating,
  sidebar,
  topbar,
  player,
  children,
}: {
  collapsed: boolean;
  animating: boolean;
  sidebar: ReactNode;
  topbar: ReactNode;
  player: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("ny-lobby-shell", {
        "is-sidebar-collapsed": collapsed,
        "is-sidebar-animating": animating,
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

function Sidebar({
  collapsed,
  locationPath,
  onToggle,
  onFilterChange,
  onOpenDrive,
}: {
  collapsed: boolean;
  locationPath: string;
  onToggle: () => void;
  onFilterChange: (filter: DashboardFilter) => void;
  onOpenDrive: () => void;
}) {
  const navigate = useNavigate();
  const activeId = resolveSidebarActiveId(locationPath);

  const navigateTo = (path: string) => {
    if (path === HOME_ROUTE) onFilterChange("all");
    navigate(path);
  };

  return (
    <aside className="ny-sidebar" aria-label="Primary navigation">
      <div className="ny-sidebar__brand-row">
        <button
          type="button"
          className="ny-sidebar__brand"
          onClick={() => navigateTo(HOME_ROUTE)}
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
                      if (item.path) navigateTo(item.path);
                      else if (item.action === "open-drive-source") onOpenDrive();
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

function TopCommandBar({
  query,
  onQueryChange,
  inputRef,
  unreadCount,
  onNavigate,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  unreadCount: number;
  onNavigate: (path: string) => void;
}) {
  return (
    <header className="ny-command-bar">
      <label className="ny-command-bar__search" aria-label="Search libraries">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search worlds, anime, movies, music..."
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
          onClick={() => onNavigate("/app")}
        >
          <LibraryBig />
          <span>Libraries</span>
        </button>
        <button
          type="button"
          className="ny-command-bar__action"
          onClick={() => onNavigate("/social")}
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
          onClick={() => onNavigate("/settings")}
        >
          <Settings />
          <span>Settings</span>
        </button>
        <button
          type="button"
          className="ny-command-bar__icon"
          onClick={() => onNavigate("/social")}
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

function WelcomeBanner({
  backdropUrl,
  driveStatus,
  rootName,
  mascotFace,
  empty,
  randomBusy,
  randomError,
  canResume,
  onResumeWatching,
  onRefreshLibrary,
  onRandomPlay,
  onRollMascotFace,
}: {
  backdropUrl: string;
  driveStatus: string;
  rootName: string | null;
  mascotFace: string;
  empty: boolean;
  randomBusy: boolean;
  randomError: string | null;
  canResume: boolean;
  onResumeWatching: () => void;
  onRefreshLibrary: () => void;
  onRandomPlay: () => void;
  onRollMascotFace: () => void;
}) {
  const primaryLabel = canResume ? "Resume Watching" : "Refresh Archive";
  const [clockNow, setClockNow] = useState(() => new Date());
  const archiveClock = useMemo(
    () => formatArchiveClock(clockNow),
    [clockNow],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockNow(new Date());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <section className="ny-welcome-banner" aria-label="Lobby summary">
      <img
        className="ny-welcome-banner__image"
        src={backdropUrl}
        alt=""
        loading="eager"
        decoding="async"
      />
      <div className="ny-welcome-banner__overlay" aria-hidden="true" />
      <div className="ny-welcome-banner__rings" aria-hidden="true" />
      <div className="ny-welcome-banner__vfx" aria-hidden="true">
        <span className="ny-welcome-banner__vfx-beam" />
        <span className="ny-welcome-banner__vfx-beam" />
        <span className="ny-welcome-banner__vfx-pulse" />
      </div>

      <div className="ny-welcome-banner__content">
        <div className="ny-welcome-banner__copy">
          <div className="ny-welcome-banner__micro-row" aria-hidden="true">
            <span>NY-CHAN ONLINE</span>
            <span>RESUME READY</span>
          </div>
          <h1>Return to where the story paused</h1>
          <p>Pick up the exact moment your night left off.</p>
          <div className="ny-welcome-banner__actions">
            <button
              type="button"
              className="ny-dashboard-btn ny-dashboard-btn--primary"
              onClick={canResume ? onResumeWatching : onRefreshLibrary}
              title={
                canResume
                  ? "Resume the most recent in-progress video."
                  : "Rescan sources, detect new files, and rebuild missing poster cache."
              }
            >
              {canResume ? <Play /> : <RefreshCw />}
              {primaryLabel}
            </button>
            <button
              type="button"
              className="ny-dashboard-btn"
              onClick={onRandomPlay}
              disabled={randomBusy}
            >
              <Shuffle />
              {randomBusy ? "Picking..." : "Random Pick"}
            </button>
          </div>
          {randomError && (
            <p className="ny-welcome-banner__error" role="status">
              {randomError}
            </p>
          )}
        </div>

        <div className="ny-welcome-banner__side">
          <button
            type="button"
            className="ny-welcome-banner__mascot-home"
            onClick={onRollMascotFace}
            aria-label="Change Ny-chan expression"
            title="Change Ny-chan expression"
          >
            <span className="ny-welcome-banner__mascot-name">Ny-chan</span>
            <img
              key={mascotFace}
              src={`/ny_chan/${mascotFace}.png`}
              alt=""
              loading="eager"
              decoding="async"
            />
          </button>
          <div className="ny-welcome-banner__status-card">
            <div className="ny-welcome-banner__status-grid">
              <div className="ny-welcome-banner__status-info-box">
                <span className="ny-welcome-banner__status-kicker">
                  Archive Status
                </span>
                <span className="ny-welcome-banner__status-label">
                  {empty
                    ? "Archive empty"
                    : driveStatus === "Ready"
                      ? "Archive ready"
                      : driveStatus}
                </span>
                <span className="ny-welcome-banner__status-root">
                  {rootName ?? "Nyrima"}
                </span>
              </div>
              <time
                className="ny-welcome-banner__datetime-box"
                dateTime={archiveClock.dateTime}
                aria-label={`${archiveClock.date} ${archiveClock.time} ${archiveClock.gmtOffset}`}
              >
                <span className="ny-welcome-banner__calendar-card">
                  <span className="ny-welcome-banner__calendar-day">
                    {archiveClock.day}
                    <sup>{archiveClock.daySuffix}</sup>
                  </span>
                  <span className="ny-welcome-banner__calendar-month">
                    {archiveClock.month}
                  </span>
                </span>
                <span className="ny-welcome-banner__status-clock">
                  <Clock3 aria-hidden="true" />
                  <span className="ny-welcome-banner__status-clock-main">
                    {archiveClock.time}
                  </span>
                </span>
                <span className="ny-welcome-banner__status-clock-zone">
                  {archiveClock.gmtOffset}
                </span>
              </time>
            </div>
            <div className="ny-welcome-banner__status-meta" aria-hidden="true">
              <span>Local session</span>
              <span>{archiveClock.timeZone}</span>
            </div>
          </div>
        </div>
      </div>

      <span className="ny-welcome-banner__engraving" aria-hidden="true">
        Tech Otakus Save the World
      </span>
    </section>
  );
}

// ---------------------------------------------------------------------------
// HomeLibraryShelf
//
// The Home lobby's library surface. By default it's a *curated* dashboard —
// three compact shelves (Favorites, Nyrima Pick, Recently Picked) rather than
// the full library browser. The header scrolls with the content (no sticky
// toolbar) and carries only Sort | Layout | Refresh — no in-box search, no
// total-count badge.
//
// The full browse experience isn't lost: when the *global* topbar search has a
// query, or a sidebar filter is active, the shelf flips to a flat results grid
// driven by the same filtered/sorted folder list. The plain Home view
// (no query, "all") stays light.
// ---------------------------------------------------------------------------

function HomeLibraryShelf({
  favorites,
  nyrimaPicks,
  recentlyPicked,
  browseFolders,
  mascotFace,
  positions,
  query,
  filter,
  sortKey,
  viewMode,
  rootLoading,
  hasLibraries,
  watchedAnything,
  continueFiles,
  postersByFolder,
  openPaths,
  onSortChange,
  onViewModeChange,
  onRefresh,
  onResetBrowse,
  onPickRoot,
}: {
  favorites: RecentFolder[];
  nyrimaPicks: RecentFolder[];
  recentlyPicked: RecentFolder[];
  browseFolders: RecentFolder[];
  mascotFace: string;
  positions: Record<string, PlaybackPosition>;
  query: string;
  filter: DashboardFilter;
  sortKey: LibrarySort;
  viewMode: LibraryViewMode;
  rootLoading: boolean;
  hasLibraries: boolean;
  watchedAnything: boolean;
  continueFiles: DriveFile[];
  postersByFolder: Record<string, string | undefined>;
  openPaths: Record<string, string>;
  onSortChange: (sort: LibrarySort) => void;
  onViewModeChange: (mode: LibraryViewMode) => void;
  onRefresh: () => void;
  onResetBrowse: () => void;
  onPickRoot: () => void;
}) {
  const browsing = query.trim() !== "" || filter !== "all";

  return (
    <>
      {/* Continue Watching lives above the shelf box so the curated box holds
          only its three sections. */}
      {watchedAnything && (
        <ContinueWatchingRow
          videos={continueFiles}
          positions={positions}
          postersByFolder={postersByFolder}
        />
      )}

      <section
        className="ny-library-area ny-library-area--home"
        aria-label={browsing ? "Library results" : "Library shelf"}
      >
        <div className="ny-library-area__chrome ny-library-area__chrome--home">
          <header className="ny-library-area__head">
            <div>
              <h2>{browsing ? filterTitle(filter, query) : "Library Shelf"}</h2>
              <span>
                {browsing
                  ? `${browseFolders.length} ${browseFolders.length === 1 ? "item" : "items"} shown`
                  : "Small worlds Ny-chan saved for tonight."}
              </span>
            </div>

            <div className="ny-library-area__actions">
              <SortControl sortKey={sortKey} onSortChange={onSortChange} />
              <span className="ny-library-area__separator" aria-hidden="true">
                |
              </span>
              <LayoutToggle
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
              />
              <span className="ny-library-area__separator" aria-hidden="true">
                |
              </span>
              <button
                type="button"
                className="ny-library-area__refresh"
                onClick={onRefresh}
                title="Rescan sources, detect new files, and rebuild missing poster cache."
              >
                <RefreshCw />
                <span>Refresh</span>
              </button>
            </div>
          </header>
        </div>

        {browsing ? (
          browseFolders.length === 0 ? (
            <EmptyShelf
              query={query}
              filter={filter}
              rootLoading={rootLoading}
              hasLibraries={hasLibraries}
              onPickRoot={onPickRoot}
              onReset={onResetBrowse}
            />
          ) : (
            <div
              className={cn("ny-library-grid", {
                "ny-library-grid--list": viewMode === "list",
              })}
            >
              {browseFolders.map((folder) => (
                <LibraryCard
                  key={folder.id}
                  folder={folder}
                  positions={positions}
                  openPath={openPaths[folder.id]}
                />
              ))}
            </div>
          )
        ) : (
          <div className="ny-home-shelves">
            <HomeSection
              title="Favorites"
              icon={<Heart />}
              className="ny-home-section--favorites"
            >
              {favorites.length === 0 ? (
                <HomeSectionEmpty>
                  No favorites yet. Mark a library to keep it close.
                </HomeSectionEmpty>
              ) : (
                <LibraryPreviewGrid
                  items={favorites}
                  maxItems={4}
                  viewMode={viewMode}
                  positions={positions}
                  openPaths={openPaths}
                />
              )}
            </HomeSection>

            <section className="ny-home-section ny-home-section--nyrima-pick">
              <div className="ny-home-pick">
                <div className="ny-home-pick__mascot">
                  <img
                    src={`/ny_chan/${mascotFace}.png`}
                    alt="Ny-chan"
                    loading="lazy"
                    decoding="async"
                  />
                  <p className="ny-home-pick__speech">
                    “Ny-chan found two worlds worth opening tonight.”
                  </p>
                </div>
                <div className="ny-home-pick__content">
                  <header className="ny-home-section__head">
                    <span className="ny-home-section__icon">
                      <Sparkles />
                    </span>
                    <div>
                      <h3>Nyrima Pick</h3>
                      <p>Ny-chan picked these for tonight.</p>
                    </div>
                  </header>
                  {nyrimaPicks.length === 0 ? (
                    <HomeSectionEmpty>
                      Ny-chan needs more folders to pick from.
                    </HomeSectionEmpty>
                  ) : (
                    <LibraryPreviewGrid
                      items={nyrimaPicks}
                      maxItems={2}
                      viewMode={viewMode}
                      positions={positions}
                      openPaths={openPaths}
                    />
                  )}
                </div>
              </div>
            </section>

            <HomeSection
              title="Recently Picked"
              icon={<History />}
              className="ny-home-section--recent"
            >
              {recentlyPicked.length === 0 ? (
                <HomeSectionEmpty>Nothing picked recently.</HomeSectionEmpty>
              ) : (
                <LibraryPreviewGrid
                  items={recentlyPicked}
                  maxItems={8}
                  viewMode={viewMode}
                  positions={positions}
                  openPaths={openPaths}
                />
              )}
            </HomeSection>
          </div>
        )}
      </section>
    </>
  );
}

function HomeSection({
  title,
  icon,
  className,
  children,
}: {
  title: string;
  icon: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("ny-home-section", className)}>
      <header className="ny-home-section__head">
        <span className="ny-home-section__icon">{icon}</span>
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}

function HomeSectionEmpty({ children }: { children: ReactNode }) {
  return <p className="ny-home-section__empty">{children}</p>;
}

function LibraryPreviewGrid({
  items,
  maxItems,
  viewMode,
  positions,
  openPaths,
}: {
  items: RecentFolder[];
  maxItems: number;
  viewMode: LibraryViewMode;
  positions: Record<string, PlaybackPosition>;
  openPaths: Record<string, string>;
}) {
  const shown = items.slice(0, maxItems);
  return (
    <div
      className={cn("ny-library-grid", {
        "ny-library-grid--list": viewMode === "list",
      })}
    >
      {shown.map((folder) => (
        <LibraryCard
          key={folder.id}
          folder={folder}
          positions={positions}
          openPath={openPaths[folder.id]}
        />
      ))}
    </div>
  );
}

function SortControl({
  sortKey,
  onSortChange,
}: {
  sortKey: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
}) {
  return (
    <label className="ny-library-toolbar__sort">
      <span>Sort</span>
      <select
        value={sortKey}
        onChange={(e) => onSortChange(e.target.value as LibrarySort)}
      >
        <option value="recent">Recently updated</option>
        <option value="name">Name</option>
        <option value="episodes">Episodes</option>
        <option value="runtime">Runtime</option>
      </select>
      <ChevronDown aria-hidden="true" />
    </label>
  );
}

function LayoutToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: LibraryViewMode;
  onViewModeChange: (mode: LibraryViewMode) => void;
}) {
  return (
    <div className="ny-library-toolbar__view" aria-label="Library view">
      <button
        type="button"
        className={cn({ "is-active": viewMode === "grid" })}
        onClick={() => onViewModeChange("grid")}
        aria-label="Grid view"
        title="Grid view"
      >
        <Grid2X2 />
      </button>
      <button
        type="button"
        className={cn({ "is-active": viewMode === "list" })}
        onClick={() => onViewModeChange("list")}
        aria-label="List view"
        title="List view"
      >
        <List />
      </button>
    </div>
  );
}

function HealthRail({
  folders,
  positions,
  apiKeyConfigured,
  rootName,
  isOnline,
  onPickRoot,
  onOpenSetup,
  onRefreshLibrary,
}: {
  folders: RecentFolder[];
  positions: Record<string, PlaybackPosition>;
  apiKeyConfigured: boolean | null;
  rootName: string | null;
  isOnline: boolean;
  onPickRoot: () => void;
  onOpenSetup: () => void;
  onRefreshLibrary: () => void;
}) {
  // All counts below are derived from real persisted state. `missingPosters`
  // is only meaningful for libraries we've already scanned (videoCount set);
  // un-scanned libraries are surfaced separately as `missingMetadata`.
  const stats = useMemo(() => {
    const allPositions = Object.values(positions);
    const inProgress = allPositions.filter(isInProgress).length;
    const watched = allPositions.filter(isWatched).length;
    let episodes = 0;
    let enriched = 0;
    let missingPosters = 0;
    let missingMetadata = 0;
    let lastOpened = 0;
    for (const f of folders) {
      if (f.videoCount != null) {
        episodes += f.videoCount;
        enriched += 1;
        if (!f.coverPosterUrl) missingPosters += 1;
      } else {
        missingMetadata += 1;
      }
      if ((f.lastOpenedAt ?? 0) > lastOpened) lastOpened = f.lastOpenedAt ?? 0;
    }
    return {
      inProgress,
      watched,
      episodes,
      enriched,
      missingPosters,
      missingMetadata,
      lastOpened,
    };
  }, [folders, positions]);

  const driveStatus = !isOnline
    ? "Offline"
    : apiKeyConfigured
      ? "Ready"
      : rootName
        ? "Needs Login"
        : "Not Connected";

  return (
    <aside className="ny-health-rail" aria-label="Health and quick actions">
      <HealthPanel title="Quick Actions" icon={<Database />} tone="tools">
        <div className="ny-quick-actions">
          <button
            type="button"
            className="ny-quick-actions__primary"
            onClick={onRefreshLibrary}
            title="Rescan sources, detect new files, and rebuild missing poster cache."
          >
            <RefreshCw />
            Refresh Library
          </button>
          <div className="ny-quick-actions__grid">
            <button
              type="button"
              onClick={onRefreshLibrary}
              title="Re-scan libraries and refresh stats"
            >
              <Database />
              Metadata
            </button>
            <button type="button" disabled title="Coming soon">
              <Download />
              Subtitles
            </button>
            <button type="button" disabled title="Coming soon">
              <Cloud />
              Backup
            </button>
          </div>
        </div>
        <p className="ny-health-panel__hint">Archive tools ready.</p>
      </HealthPanel>

      <HealthPanel title="Library Health" icon={<Gauge />} tone="stats">
        <div className="ny-health-rail__metrics">
          <MetricCard label="Libraries" value={folders.length.toString()} />
          <MetricCard
            label="Episodes"
            value={stats.episodes.toLocaleString()}
          />
          <MetricCard
            label="In Progress"
            value={stats.inProgress.toString()}
            accent
          />
          <MetricCard label="Watched" value={stats.watched.toString()} />
          <MetricCard
            label="Missing Posters"
            value={stats.enriched > 0 ? stats.missingPosters.toString() : "—"}
          />
          <MetricCard
            label="Missing Metadata"
            value={stats.missingMetadata.toString()}
          />
        </div>
      </HealthPanel>

      <HealthPanel title="Memory Health" icon={<HardDrive />} tone="gates">
        <SourceCard
          icon={<Cloud />}
          name="Google Drive"
          status={driveStatus}
          rows={[
            { label: "Folder", value: rootName ?? "Not available" },
            {
              label: "Last sync",
              value: stats.lastOpened
                ? formatRelative(stats.lastOpened)
                : "Not available",
            },
            { label: "Storage quota", value: "Not available" },
            { label: "Cache", value: "Ready" },
          ]}
        />
        <SourceCard
          icon={<FolderOpen />}
          name="Local Folder"
          status="Not Available"
          rows={[
            { label: "Folder", value: "Not available" },
            { label: "Last scan", value: "Not available" },
            { label: "Indexed files", value: "Not available" },
            { label: "Cache", value: "Not available" },
          ]}
        />
        <div className="ny-health-rail__actions">
          <button type="button" onClick={onOpenSetup}>
            Reconnect
          </button>
          <button type="button" onClick={onPickRoot}>
            Change Folder
          </button>
        </div>
        <p className="ny-health-panel__hint">Source gates synchronized.</p>
      </HealthPanel>

      <SystemHealthPanel />
    </aside>
  );
}

function SourceCard({
  icon,
  name,
  status,
  rows,
}: {
  icon: ReactNode;
  name: string;
  status: string;
  rows: Array<{ label: string; value: string }>;
}) {
  const tone =
    status === "Ready"
      ? "is-ready"
      : status === "Not Available" || status === "Not Connected"
        ? "is-muted"
        : "is-warning";
  // Memory Health reads as "source gates" in the brand voice: a connected,
  // ready source shows as "Gate Online" while the tone class still derives
  // from the real status string.
  const label = status === "Ready" ? "Gate Online" : status;
  return (
    <div className="ny-memory-source">
      <div className="ny-memory-source__head">
        <span className={cn("ny-source-dot", tone)} aria-hidden="true" />
        <span className="ny-memory-source__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="ny-memory-source__name">{name}</span>
        <span className={cn("ny-memory-source__status", tone)}>{label}</span>
      </div>
      <div className="ny-memory-source__rows">
        {rows.map((row) => (
          <div className="ny-health-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthPanel({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: ReactNode;
  tone?: "tools" | "stats" | "gates" | "system";
  children: ReactNode;
}) {
  return (
    <section
      className={cn("ny-health-panel", tone && `ny-health-panel--${tone}`)}
    >
      <header className="ny-health-panel__head">
        <span className="ny-health-panel__icon">{icon}</span>
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={cn("ny-health-metric", { "is-accent": accent })}>
      <span>{value}</span>
      <small>{label}</small>
    </div>
  );
}

function HealthRow({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: string;
}) {
  return (
    <div className="ny-health-row">
      <span>{label}</span>
      <strong
        className={cn({
          "is-ready": status === "Ready",
          "is-warning": status === "Needs Login",
          "is-offline": status === "Offline",
        })}
        title={value}
      >
        {value}
      </strong>
    </div>
  );
}

function SystemHealthPanel() {
  // Static device specs the browser is willing to expose. No live load —
  // there's no browser API for current CPU/GPU/RAM usage.
  const specs = useMemo(
    () => ({
      cpu: getCpuInfo(),
      gpu: getGpuInfo(),
      ram: getRamInfo(),
    }),
    [],
  );

  const [speedState, setSpeedState] = useState<
    | { status: "idle" }
    | { status: "testing" }
    | { status: "done"; result: string }
    | { status: "error" }
  >({ status: "idle" });

  const runSpeedTest = async () => {
    setSpeedState({ status: "testing" });
    try {
      const result = await measureDownloadSpeed();
      setSpeedState({ status: "done", result });
    } catch {
      setSpeedState({ status: "error" });
    }
  };

  const speedLabel =
    speedState.status === "idle"
      ? "Not tested"
      : speedState.status === "testing"
        ? "Testing…"
        : speedState.status === "done"
          ? speedState.result
          : "Test failed";

  return (
    <HealthPanel title="System Health" icon={<Activity />} tone="system">
      <HealthRow label="CPU" value={specs.cpu} />
      <HealthRow label="GPU" value={specs.gpu} />
      <HealthRow label="RAM" value={specs.ram} />
      <div className="ny-health-row ny-health-row--action">
        <span>Internet Speed</span>
        <div className="ny-health-row__trailing">
          <strong>{speedLabel}</strong>
          <button
            type="button"
            onClick={runSpeedTest}
            disabled={speedState.status === "testing"}
            title="Download a test file to measure throughput"
          >
            {speedState.status === "testing" ? "Testing…" : "Test"}
          </button>
        </div>
      </div>
    </HealthPanel>
  );
}

function ContinuePlayerDock({
  position,
  folder,
  file,
  fallbackPosterUrl,
  onPlayRandom,
}: {
  position: PlaybackPosition | null;
  folder?: RecentFolder;
  file?: DriveFile | null;
  fallbackPosterUrl?: string;
  onPlayRandom: () => void;
}) {
  const navigate = useNavigate();
  const defaultVolume = useSettingsStore((s) => s.settings.defaultVolume);
  const setDefaultVolume = useSettingsStore((s) => s.setDefaultVolume);
  const title = position?.name ?? file?.name ?? "Nyrima Player";
  const subtitle = position
    ? (folder?.name ?? "Continue watching")
    : "Nothing playing yet";
  const mediaUrl = file?.thumbnailLink ?? fallbackPosterUrl;
  const progressPct =
    position && position.durationSeconds > 0
      ? Math.min(
          100,
          (position.positionSeconds / position.durationSeconds) * 100,
        )
      : 0;
  const canPlay = !!position?.folderId && !!position.fileId;
  // Only surface a container chip we can actually prove from the filename or
  // MIME type — no faked SUB/AUD/ASS chips without real track metadata.
  const isMkv =
    /\.mkv$/i.test(title) ||
    (file?.mimeType ?? "").includes("matroska") ||
    (position?.mimeType ?? "").includes("matroska");

  const play = () => {
    if (!position?.folderId) return;
    navigate(
      `/play/${encodeURIComponent(position.folderId)}/${encodeURIComponent(position.fileId)}`,
    );
  };

  return (
    <footer className="continue-player-dock" aria-label="Continue media player">
      <div className="continue-player-dock__media">
        <div className="continue-player-dock__thumb">
          {mediaUrl ? (
            <img src={mediaUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            <NyrimaMark size="header" />
          )}
        </div>
        <div className="continue-player-dock__copy">
          <span className="continue-player-dock__eyebrow">
            {position ? "Now Playing" : "Standby"}
            {isMkv && <span className="continue-player-dock__badge">MKV</span>}
          </span>
          <span className="continue-player-dock__title" title={title}>
            {title}
          </span>
          <small title={subtitle}>{subtitle}</small>
        </div>
      </div>

      <div className="continue-player-dock__center">
        <div className="continue-player-dock__controls">
          <DockButton
            icon={<Shuffle />}
            label="Random Play"
            onClick={onPlayRandom}
          />
          <DockButton icon={<SkipBack />} label="Previous" disabled />
          <DockButton
            icon={canPlay ? <Play /> : <Pause />}
            label={canPlay ? "Play" : "No media loaded"}
            primary
            disabled={!canPlay}
            onClick={play}
          />
          <DockButton icon={<SkipForward />} label="Next" disabled />
          <DockButton icon={<Repeat />} label="Repeat" disabled />
        </div>
        <div className="continue-player-dock__timeline">
          <span>{formatTimecode(position?.positionSeconds ?? 0)}</span>
          <div className="continue-player-dock__track" aria-hidden="true">
            <span style={{ width: `${progressPct}%` }} />
          </div>
          <span>{formatTimecode(position?.durationSeconds ?? 0)}</span>
        </div>
      </div>

      <div className="continue-player-dock__right">
        <DockButton icon={<ListMusic />} label="Queue" disabled />
        <DockButton
          icon={<Captions />}
          label="Audio and subtitles"
          disabled={!canPlay}
        />
        <label className="continue-player-dock__volume">
          <Volume2 aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(defaultVolume * 100)}
            onChange={(e) =>
              void setDefaultVolume(Number(e.target.value) / 100)
            }
            aria-label="Default volume"
          />
        </label>
        <DockButton
          icon={<Maximize2 />}
          label="Fullscreen"
          disabled={!canPlay}
        />
      </div>

      <span className="continue-player-dock__engraving" aria-hidden="true">
        Every World, One Archive
      </span>
    </footer>
  );
}

function DockButton({
  icon,
  label,
  primary,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn("continue-player-dock__button", {
        "is-primary": primary,
      })}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

function EmptyShelf({
  query,
  filter,
  rootLoading,
  hasLibraries,
  onPickRoot,
  onReset,
}: {
  query: string;
  filter: DashboardFilter;
  rootLoading: boolean;
  hasLibraries: boolean;
  onPickRoot: () => void;
  onReset: () => void;
}) {
  const filtered = query.trim() !== "" || filter !== "all";
  if (rootLoading && !hasLibraries) {
    return (
      <div className="ny-landing__empty">
        <span className="dc-tracker">SCANNING NYRIMA</span>
        <p className="ny-landing__empty-title">Reading your folder…</p>
      </div>
    );
  }
  return (
    <div className="ny-landing__empty">
      <span className="dc-tracker">
        {filtered ? "NO MATCHES" : "EMPTY NYRIMA"}
      </span>
      <p className="ny-landing__empty-title">
        {filtered
          ? "Nothing matches this view."
          : "Your library is still empty."}
      </p>
      <p className="ny-landing__empty-sub">
        {filtered
          ? "Try clearing the search or switching back to All."
          : "Connect Google Drive or scan a local folder to begin."}
      </p>
      {filtered ? (
        <button
          type="button"
          className="ny-btn ny-btn--ghost"
          onClick={onReset}
        >
          Clear filter
        </button>
      ) : (
        <button
          type="button"
          className="ny-btn ny-btn--ghost"
          onClick={onPickRoot}
        >
          Add Source
        </button>
      )}
    </div>
  );
}

function RootErrorCard({
  message,
  onPick,
  onRetry,
}: {
  message: string;
  onPick: () => void;
  onRetry: () => void;
}) {
  return (
    <Column gap="12" padding="24" radius="l" background="surface">
      <Text variant="display-strong-s">Nyrima folder unreachable</Text>
      <Text variant="body-default-s" onBackground="neutral-weak">
        {message}
      </Text>
      <Row gap="8">
        <Button variant="primary" onClick={onPick}>
          Pick a different folder
        </Button>
        <Button variant="tertiary" onClick={onRetry}>
          Try again
        </Button>
      </Row>
    </Column>
  );
}

function DashboardDialogs({
  rootDialogOpen,
  setRootDialogOpen,
  setupOpen,
  handleCloseSetup,
  setKeyConfigured,
}: {
  rootDialogOpen: boolean;
  setRootDialogOpen: (v: boolean) => void;
  setupOpen: boolean;
  handleCloseSetup: () => void;
  setKeyConfigured: (v: boolean) => void;
}) {
  return (
    <>
      <SetupAccessDialog
        isOpen={setupOpen}
        onClose={handleCloseSetup}
        onSaved={() => setKeyConfigured(true)}
      />
      <NyrimaRootDialog
        isOpen={rootDialogOpen}
        onClose={() => setRootDialogOpen(false)}
      />
    </>
  );
}

function filterTitle(filter: DashboardFilter, query?: string): string {
  if (query && query.trim() !== "" && filter === "all") return "Search results";
  if (filter === "continue") return "Continue Watching";
  if (filter === "unwatched") return "Unwatched";
  if (filter === "favorites") return "Favorites";
  if (filter === "recent") return "Recently Added";
  return "All Libraries";
}

function isTypingTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  return online;
}

function formatRelative(epoch: number): string {
  const diff = Date.now() - epoch;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(epoch).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// LobbyStatsStrip
//
// A thin mono tape that summarizes the user's collection in aggregate. Reads
// from the persisted library stats (videoCount / runtimeMs / watchedCount on
// the RecentFolder entry), so values are only present after the user has
// actually opened those libraries. The strip is suppressed by the caller
// when nothing has been enriched yet, so a brand-new install doesn't see
// "0 episodes".
// ---------------------------------------------------------------------------

function LobbyStatsStrip({
  libraryCount,
  videos,
  runtimeMs,
  watched,
}: {
  libraryCount: number;
  videos: number;
  runtimeMs: number;
  watched: number;
}) {
  const cells: Array<{ label: string; value: string }> = [
    {
      label: "Libraries",
      value: String(libraryCount),
    },
  ];
  if (videos > 0) {
    cells.push({
      label: "Episodes",
      value: videos.toLocaleString(),
    });
  }
  if (runtimeMs > 0) {
    cells.push({
      label: "Total runtime",
      value: formatTotalRuntime(runtimeMs),
    });
  }
  if (watched > 0) {
    cells.push({
      label: "Watched",
      value: watched.toLocaleString(),
    });
  }
  return (
    <section
      className="ny-lobby-stats"
      role="region"
      aria-label="Library statistics"
    >
      <span className="ny-lobby-stats__kana">Your Collection</span>
      <ul className="ny-lobby-stats__cells">
        {cells.map((cell) => (
          <li key={cell.label} className="ny-lobby-stats__cell">
            <span className="ny-lobby-stats__value">{cell.value}</span>
            <span className="ny-lobby-stats__label">{cell.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatTotalRuntime(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const totalHr = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (totalHr < 24) return m === 0 ? `${totalHr}h` : `${totalHr}h ${m}m`;
  const d = Math.floor(totalHr / 24);
  const h = totalHr % 24;
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}
