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

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Column,
  Row,
  Text,
  Button,
} from "@once-ui-system/core/components";
import { useNyrimaRootStore } from "../stores/nyrima-root-store";
import { useRecentStore } from "../stores/recent-store";
import { usePlaybackPositions } from "../hooks/usePlaybackPositions";
import { LibraryCard } from "../components/LibraryCard";
import { LobbyHero } from "../components/LobbyHero";
import { ContinueHero } from "../components/ContinueHero";
import { ContinueWatchingRow } from "../components/ContinueWatchingRow";
import { SearchFilterBar, type LobbyFilter } from "../components/SearchFilterBar";
import { LibraryHealthCard } from "../components/LibraryHealthCard";
import { OnboardingStrip } from "../components/OnboardingStrip";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import { NyrimaRootDialog } from "../components/NyrimaRootDialog";
import { WelcomeBlock } from "../components/WelcomeBlock";
import { useNavigate } from "react-router-dom";
import { hasApiKey } from "../services/api-key";
import { isVideoFile } from "../services/drive-api";
import {
  getFileMetadata,
  listFolder as cachedListFolder,
} from "../services/drive/metadata-service";
import { resolvePoster } from "../services/poster-resolver";
import { getCached } from "../services/metadata-cache";
import { isInProgress, isWatched } from "../services/storage";
import { shuffle } from "../utils/shuffle";
import type {
  DriveFile,
  MovieMetadata,
  PlaybackPosition,
  RecentFolder,
} from "@shared/types";
import "./LandingPage.scss";

export function LandingPage() {
  const root = useNyrimaRootStore((s) => s.root);
  const libraries = useNyrimaRootStore((s) => s.libraries);
  const rootLoading = useNyrimaRootStore((s) => s.loading);
  const rootError = useNyrimaRootStore((s) => s.rootError);
  const loadRoot = useNyrimaRootStore((s) => s.load);
  const refreshRoot = useNyrimaRootStore((s) => s.refresh);

  const { folders: recentFolders, load: loadRecents, upsert: upsertRecent } =
    useRecentStore();
  const [setupOpen, setSetupOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("setup") === "1";
    }
    return false;
  });
  const [rootDialogOpen, setRootDialogOpen] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [positions] = usePlaybackPositions();
  const [featured, setFeatured] = useState<DriveFile | null>(null);
  const [featuredMeta, setFeaturedMeta] = useState<MovieMetadata | null>(null);
  const [featuredFolderId, setFeaturedFolderId] = useState<string>("");
  const [continueFile, setContinueFile] = useState<DriveFile | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LobbyFilter>("all");
  const navigate = useNavigate();

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

  // Adapt Drive folder list → RecentFolder shape so the existing
  // LibraryCard / LibraryHealthCard / SearchFilterBar UI keeps working.
  // `lastOpenedAt` is enriched from the recents store when available so
  // "5m ago" stays accurate; otherwise we use the root's verifiedAt.
  const adaptedFolders = useMemo<RecentFolder[]>(() => {
    const recentMap = new Map(recentFolders.map((f) => [f.id, f]));
    const fallback = root?.verifiedAt ?? 0;
    return libraries.map((lib) => {
      const recent = recentMap.get(lib.id);
      return {
        id: lib.id,
        name: lib.name,
        lastOpenedAt: recent?.lastOpenedAt ?? fallback,
        pinned: recent?.pinned,
        itemCount: recent?.itemCount,
      };
    });
  }, [libraries, recentFolders, root]);

  // --- Background bulk-enrichment ------------------------------------------
  //
  // The library-card stats (videoCount / runtimeMs / watchedCount / cover)
  // are normally written by `LibraryPage` when the user opens a folder. On a
  // fresh install or a never-visited library, the card falls back to
  // "N items" and the lobby stats strip stays hidden. We close that gap by
  // walking unenriched libraries in the background and writing the stats
  // ourselves: one `cachedListFolder` per library + an optional Jikan lookup
  // for the cover. Throttled by the existing request queue + Jikan's 1 req/s
  // gap so a large root doesn't burst.
  //
  // `enrichingRef` keeps a per-session set of folder ids that are in-flight
  // or done so a positions update (which re-renders adaptedFolders identity)
  // doesn't re-fire the work.
  const enrichingRef = useRef(new Set<string>());
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  useEffect(() => {
    const todo = adaptedFolders.filter(
      (f) => f.videoCount == null && !enrichingRef.current.has(f.id),
    );
    if (todo.length === 0) return;
    let cancelled = false;
    const ctrl = new AbortController();
    void (async () => {
      for (const folder of todo) {
        if (cancelled) return;
        enrichingRef.current.add(folder.id);
        try {
          const result = await cachedListFolder(folder.id, {
            signal: ctrl.signal,
            priority: "low",
          });
          if (cancelled) return;
          const videos = result.files.filter(isVideoFile);
          const livePositions = positionsRef.current;
          let runtimeMs = 0;
          let watchedCount = 0;
          for (const v of videos) {
            const durStr = v.videoMediaMetadata?.durationMillis;
            const dur = durStr ? Number(durStr) : 0;
            if (Number.isFinite(dur) && dur > 0) runtimeMs += dur;
            if (isWatched(livePositions[v.id])) watchedCount++;
          }
          // Cover lookup. Prefer the cache to avoid spamming Jikan; only fall
          // through to a fresh resolve when we have a probe video and no hit.
          let coverPosterUrl: string | undefined;
          if (videos.length > 0) {
            const cached = await getCached(videos[0].id);
            if (cached?.status === "ok" && cached.posterUrl) {
              coverPosterUrl = cached.posterUrl;
            } else {
              try {
                const meta = await resolvePoster(videos[0], folder.name);
                if (meta.status === "ok") coverPosterUrl = meta.posterUrl;
              } catch {
                // ignore — leave coverPosterUrl undefined
              }
            }
          }
          if (cancelled) return;
          await upsertRecent({
            id: folder.id,
            name: folder.name,
            lastOpenedAt: folder.lastOpenedAt,
            itemCount: result.files.length,
            videoCount: videos.length,
            runtimeMs: runtimeMs > 0 ? runtimeMs : undefined,
            watchedCount,
            coverPosterUrl,
            pinned: folder.pinned,
          });
        } catch {
          // Network blip or abort — release the slot so a later session retries.
          enrichingRef.current.delete(folder.id);
        }
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // `positions` deliberately omitted — read via ref to avoid re-enriching on
    // every timeupdate. `upsertRecent` is store-bound and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adaptedFolders, upsertRecent]);

  // --- Continue / Featured -------------------------------------------------
  const mostRecentInProgress = useMemo<PlaybackPosition | null>(() => {
    const inProgress = Object.values(positions).filter(isInProgress);
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

  useEffect(() => {
    if (mostRecentInProgress) return;
    if (adaptedFolders.length === 0) return;
    let cancelled = false;
    const ctrl = new AbortController();
    const target = adaptedFolders[0];
    void (async () => {
      try {
        const result = await cachedListFolder(target.id, {
          signal: ctrl.signal,
          priority: "low",
        });
        const videos = result.files.filter(isVideoFile);
        if (videos.length === 0) return;
        const pick =
          videos[Math.floor(Math.random() * Math.min(videos.length, 30))];
        if (!cancelled) {
          setFeatured(pick);
          setFeaturedFolderId(target.id);
          const meta = await resolvePoster(pick, target.name);
          if (!cancelled) setFeaturedMeta(meta);
        }
      } catch {
        // ignore — hero just won't render
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [adaptedFolders, mostRecentInProgress]);

  // --- Continue Watching stubs (for the horizontal row) --------------------
  const continueFiles = useMemo<DriveFile[]>(
    () =>
      Object.values(positions)
        .filter((p) => p.name && p.folderId)
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
    [positions],
  );

  // --- Folder filtering ----------------------------------------------------
  const inProgressFolderIds = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const p of Object.values(positions)) {
      if (isInProgress(p) && p.folderId) set.add(p.folderId);
    }
    return set;
  }, [positions]);

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return adaptedFolders.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q)) return false;
      if (filter === "continue" && !inProgressFolderIds.has(f.id)) return false;
      if (filter === "unwatched" && inProgressFolderIds.has(f.id)) return false;
      return true;
    });
  }, [adaptedFolders, query, filter, inProgressFolderIds]);

  const pinned = filteredFolders.filter((f) => f.pinned);
  const others = filteredFolders.filter((f) => !f.pinned);

  // Aggregate stats for the lobby tape. Only counted from libraries that the
  // user has actually visited at least once (since the stats are persisted
  // by LibraryPage on visit). `enrichedCount` is the gate — when zero, we
  // suppress the strip entirely so the user doesn't see "0 episodes" on a
  // brand-new install.
  const lobbyStats = useMemo(() => {
    let videos = 0;
    let runtimeMs = 0;
    let watched = 0;
    let enrichedCount = 0;
    for (const f of adaptedFolders) {
      if (f.videoCount != null) {
        videos += f.videoCount;
        enrichedCount++;
      }
      if (f.runtimeMs) runtimeMs += f.runtimeMs;
      if (f.watchedCount) watched += f.watchedCount;
    }
    return {
      libraryCount: adaptedFolders.length,
      videos,
      runtimeMs,
      watched,
      enrichedCount,
    };
  }, [adaptedFolders]);

  const randomPicks = useMemo(() => {
    if (others.length <= 4) return [] as RecentFolder[];
    return shuffle(others).slice(0, 4);
  }, [others]);

  const hasRoot = !!root;
  const hasLibraries = libraries.length > 0;
  const showFullOnboarding = !keyConfigured || !hasRoot;
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

  // --- Render --------------------------------------------------------------
  // No API key OR no Nyrima root → welcome surface + dialogs.
  if (showFullOnboarding) {
    return (
      <div className="ny-landing">
        <WelcomeBlock
          keyConfigured={keyConfigured}
          rootPaired={hasRoot}
          rootName={root?.name ?? null}
          onPickRoot={() => setRootDialogOpen(true)}
          onOpenSetup={() => setSetupOpen(true)}
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

  // Dashboard view (default for returning users).
  return (
    <div className="ny-landing ny-dashboard">
      {mostRecentInProgress ? (
        <ContinueHero
          position={mostRecentInProgress}
          folder={continueFolder}
          file={continueFile}
        />
      ) : featured ? (
        <LobbyHero
          file={featured}
          meta={featuredMeta}
          folderId={featuredFolderId}
        />
      ) : null}

      {lobbyStats.enrichedCount > 0 && (
        <LobbyStatsStrip
          libraryCount={lobbyStats.libraryCount}
          videos={lobbyStats.videos}
          runtimeMs={lobbyStats.runtimeMs}
          watched={lobbyStats.watched}
        />
      )}

      <SearchFilterBar
        query={query}
        onQueryChange={setQuery}
        filter={filter}
        onFilterChange={setFilter}
        libraryCount={filteredFolders.length}
      />

      <div className="ny-dashboard__grid">
        <div className="ny-dashboard__main">
          {watchedAnything && (
            <ContinueWatchingRow videos={continueFiles} positions={positions} />
          )}

          {pinned.length > 0 && (
            <section className="ny-landing__section ny-shelf">
              <header className="ny-shelf__head">
                <h3 className="ny-shelf__title">Pinned</h3>
                <span className="ny-shelf__count">
                  {pinned.length} {pinned.length === 1 ? "library" : "libraries"}
                </span>
              </header>
              <div className="ny-library-grid">
                {pinned.map((f) => (
                  <LibraryCard key={f.id} folder={f} positions={positions} />
                ))}
              </div>
            </section>
          )}

          <section className="ny-landing__section ny-shelf">
            <header className="ny-shelf__head">
              <h3 className="ny-shelf__title">All Libraries</h3>
              <span className="ny-shelf__count">
                {others.length} {others.length === 1 ? "library" : "libraries"}
              </span>
            </header>
            {others.length === 0 ? (
              <EmptyShelf
                query={query}
                filter={filter}
                rootLoading={rootLoading}
                hasLibraries={hasLibraries}
                onPickRoot={() => setRootDialogOpen(true)}
                onReset={() => {
                  setQuery("");
                  setFilter("all");
                }}
              />
            ) : (
              <div className="ny-library-grid">
                {others.map((f) => (
                  <LibraryCard key={f.id} folder={f} positions={positions} />
                ))}
              </div>
            )}
          </section>

          {randomPicks.length > 0 && (
            <section className="ny-landing__section ny-shelf ny-shelf--quiet">
              <header className="ny-shelf__head">
                <h3 className="ny-shelf__title">Random Picks</h3>
                <span className="ny-shelf__count">Tonight's roll of the dice</span>
              </header>
              <div className="ny-library-grid ny-library-grid--quiet">
                {randomPicks.map((f) => (
                  <LibraryCard key={f.id} folder={f} positions={positions} />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="ny-dashboard__rail">
          <LibraryHealthCard
            folders={adaptedFolders}
            positions={positions}
            apiKeyConfigured={keyConfigured}
            rootName={root?.name ?? null}
            onPickRoot={() => setRootDialogOpen(true)}
            onOpenSetup={() => setSetupOpen(true)}
          />
        </aside>
      </div>

      <OnboardingStrip
        keyConfigured={keyConfigured}
        rootPaired={hasRoot}
        onPickRoot={() => setRootDialogOpen(true)}
        onOpenSetup={() => setSetupOpen(true)}
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function EmptyShelf({
  query,
  filter,
  rootLoading,
  hasLibraries,
  onPickRoot,
  onReset,
}: {
  query: string;
  filter: LobbyFilter;
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
      <span className="dc-tracker">{filtered ? "NO MATCHES" : "EMPTY NYRIMA"}</span>
      <p className="ny-landing__empty-title">
        {filtered
          ? "Nothing matches your filter"
          : "No subfolders inside Nyrima yet"}
      </p>
      <p className="ny-landing__empty-sub">
        {filtered
          ? "Try clearing the search or switching back to All."
          : "Create a folder per show (e.g. \"Gimai Seikatsu\") inside your Nyrima folder on Drive — it'll appear here automatically."}
      </p>
      {filtered ? (
        <button type="button" className="ny-btn ny-btn--ghost" onClick={onReset}>
          Clear filter
        </button>
      ) : (
        <button
          type="button"
          className="ny-btn ny-btn--ghost"
          onClick={onPickRoot}
        >
          Change Nyrima folder
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
      <span className="ny-lobby-stats__kana">あなたのコレクション · COLLECTION</span>
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
