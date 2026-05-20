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
import { LoginScreen } from "../components/LoginScreen";
import { useNavigate } from "react-router-dom";
import { hasApiKey } from "../services/api-key";
import { isVideoFile } from "../services/drive-api";
import {
  getFileMetadata,
  listFolder as cachedListFolder,
} from "../services/drive/metadata-service";
import { findPosterFile } from "../services/folder-poster";
import { isInProgress, isWatched } from "../services/storage";
import { shuffle } from "../utils/shuffle";
import type {
  DriveFile,
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
  const [featuredPosterUrl, setFeaturedPosterUrl] = useState<string | undefined>(
    undefined,
  );
  const [featuredFolderId, setFeaturedFolderId] = useState<string>("");
  const [featuredFolderName, setFeaturedFolderName] = useState<string>("");
  const [continueFile, setContinueFile] = useState<DriveFile | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LobbyFilter>("all");
  const [randomPicksOpen, setRandomPicksOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // `/` is owned globally by the TopbarSearch — typing slash anywhere
  // focuses the topbar pill, which performs the same library-name match
  // (plus people + shares) and is reachable from any route. We still keep
  // `Esc` here so blurring the lobby filter clears it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
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

  // Adapt Drive folder list → RecentFolder shape so the existing
  // LibraryCard / LibraryHealthCard / SearchFilterBar UI keeps working.
  // `lastOpenedAt` is enriched from the recents store when available so
  // "5m ago" stays accurate; otherwise we use the root's verifiedAt. We
  // forward the full enriched payload (videoCount, runtimeMs, lastSeenAt,
  // pendingNewCount, …) so the LibraryCard renders stats + the "N new" pill
  // and the background-enrichment effect can read prior state without a
  // second storage round-trip.
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
        videoCount: recent?.videoCount,
        runtimeMs: recent?.runtimeMs,
        watchedCount: recent?.watchedCount,
        coverPosterUrl: recent?.coverPosterUrl,
        newestModifiedAt: recent?.newestModifiedAt,
        lastSeenAt: recent?.lastSeenAt,
        pendingNewCount: recent?.pendingNewCount,
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
  // ourselves: one `cachedListFolder` per library — the same listing also
  // surfaces the user-placed `Poster.{jpg,png,…}` file when present, so we
  // get the cover for free without an extra request.
  //
  // `enrichingRef` keeps a per-session set of folder ids that are in-flight
  // or done so a positions update (which re-renders adaptedFolders identity)
  // doesn't re-fire the work.
  //
  // 2026-05-17: this pass now also computes `newestModifiedAt` +
  // `pendingNewCount` per library so the LibraryCard can show a "N new"
  // pill when Drive received new files since the user last opened the
  // library. First-ever enrichment seeds `lastSeenAt = newestModifiedAt` so
  // a brand-new install doesn't flag every existing file as "new".
  const enrichingRef = useRef(new Set<string>());
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  useEffect(() => {
    // Re-enrich whenever the persisted stats are missing OR potentially
    // stale (no recent enrichment). Without this, the "N new" pill never
    // appears for already-enriched libraries.
    const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
    const now = Date.now();
    const todo = adaptedFolders.filter((f) => {
      if (enrichingRef.current.has(f.id)) return false;
      if (f.videoCount == null) return true;
      // Missing poster → re-list the folder. Folder listings are cache-
      // fronted, so a library whose user genuinely hasn't placed a
      // `Poster.*` file pays one cheap listing per stale window rather
      // than per render. The fallback `LibraryCard` art shows in the
      // meantime; no external network is involved.
      if (f.coverPosterUrl == null && f.coverFileId == null) return true;
      // Re-check stale folders so newly added Drive files surface eventually.
      const lastTouched = f.lastOpenedAt ?? 0;
      return now - lastTouched > STALE_MS;
    });
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
          let newestModifiedAt = 0;
          for (const v of videos) {
            const durStr = v.videoMediaMetadata?.durationMillis;
            const dur = durStr ? Number(durStr) : 0;
            if (Number.isFinite(dur) && dur > 0) runtimeMs += dur;
            if (isWatched(livePositions[v.id])) watchedCount++;
            const mod = v.modifiedTime ? Date.parse(v.modifiedTime) : 0;
            if (Number.isFinite(mod) && mod > newestModifiedAt) {
              newestModifiedAt = mod;
            }
          }
          // First enrichment: seed lastSeenAt so the user doesn't see "N new"
          // on a library they've never opened. Subsequent passes only update
          // newestModifiedAt + pendingNewCount, leaving lastSeenAt alone
          // (LibraryPage handles the reset).
          const isFirstEnrichment = folder.lastSeenAt == null;
          const effectiveLastSeen = folder.lastSeenAt ?? newestModifiedAt;
          let pendingNewCount = 0;
          if (!isFirstEnrichment) {
            for (const v of videos) {
              const mod = v.modifiedTime ? Date.parse(v.modifiedTime) : 0;
              if (Number.isFinite(mod) && mod > effectiveLastSeen) {
                pendingNewCount++;
              }
            }
          }
          // Cover lookup — read the user-placed `Poster.{jpg,png,…}` straight
          // from the listing we just performed. No second request, no
          // external service. A library without a Poster file falls through
          // to the initials tile in LibraryCard.
          const posterFile = findPosterFile(result.files);
          const coverPosterUrl = posterFile?.thumbnailLink;
          const coverFileId = posterFile?.id;
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
            coverFileId,
            pinned: folder.pinned,
            newestModifiedAt: newestModifiedAt > 0 ? newestModifiedAt : undefined,
            lastSeenAt: isFirstEnrichment ? newestModifiedAt : folder.lastSeenAt,
            pendingNewCount,
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

  // Seed by `firstFolderId` (not full `adaptedFolders` identity) so the
  // background bulk-enrichment effect — which mutates adaptedFolders 20+
  // times on a fresh install — doesn't re-pick the hero on every tick. And
  // seed the episode index by the folder id so the same lobby visit picks
  // the same episode on every re-render until the user switches root.
  const firstFolderId = adaptedFolders[0]?.id ?? "";
  const firstFolderName = adaptedFolders[0]?.name ?? "";
  useEffect(() => {
    if (mostRecentInProgress) return;
    if (!firstFolderId) return;
    let cancelled = false;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const result = await cachedListFolder(firstFolderId, {
          signal: ctrl.signal,
          priority: "low",
        });
        const videos = result.files.filter(isVideoFile);
        if (videos.length === 0) return;
        const seed = hashString(firstFolderId);
        const idx = seed % Math.min(videos.length, 30);
        const pick = videos[idx];
        // Hero poster = the same Poster.* the lobby card uses (series-level
        // image), pulled from the listing we just performed. The backdrop
        // <img> in LobbyHero still prefers the file's Drive frame thumbnail
        // (more cinematic) and only falls back to the poster when absent.
        const posterFile = findPosterFile(result.files);
        if (!cancelled) {
          setFeatured(pick);
          setFeaturedFolderId(firstFolderId);
          setFeaturedFolderName(firstFolderName);
          setFeaturedPosterUrl(posterFile?.thumbnailLink);
        }
      } catch {
        // ignore — hero just won't render
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [firstFolderId, firstFolderName, mostRecentInProgress]);

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

  // folderId → user-placed poster URL, for the Continue Watching row. The
  // lobby's row mixes items from many libraries; each card looks up its own
  // folder so a missing Drive frame thumbnail falls back to that library's
  // cover art instead of the empty NyrimaMark tile.
  const postersByFolder = useMemo<Record<string, string | undefined>>(() => {
    const map: Record<string, string | undefined> = {};
    for (const f of adaptedFolders) {
      if (f.coverPosterUrl) map[f.id] = f.coverPosterUrl;
    }
    return map;
  }, [adaptedFolders]);

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
  // No API key OR no Nyrima root → unified LoginScreen. Replaces the prior
  // WelcomeBlock + SetupAccessDialog + NyrimaRootDialog handoff: every step
  // lives on one surface so the user never wonders which button maps to
  // which side of "Drive access".
  if (showFullOnboarding) {
    return (
      <div className="ny-landing">
        <LoginScreen
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
          posterUrl={featuredPosterUrl}
          title={featuredFolderName}
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
        inputRef={searchInputRef}
      />

      <div className="ny-dashboard__grid">
        <div className="ny-dashboard__main">
          {watchedAnything && (
            <ContinueWatchingRow
              videos={continueFiles}
              positions={positions}
              postersByFolder={postersByFolder}
            />
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
            // Random Picks is now opt-in via the Surprise me button — it used
            // to render unconditionally and added a fourth shelf to the lobby
            // even on returning visits where the user already knew what to
            // watch. Now it's a single CTA that reveals when the user
            // actively wants serendipity.
            <section className="ny-landing__section ny-shelf ny-shelf--quiet">
              <header className="ny-shelf__head">
                <h3 className="ny-shelf__title">Random Picks</h3>
                <button
                  type="button"
                  className="ny-btn ny-btn--ghost"
                  onClick={() => setRandomPicksOpen((v) => !v)}
                >
                  {randomPicksOpen ? "Hide" : "Surprise me"}
                </button>
              </header>
              {randomPicksOpen && (
                <div className="ny-library-grid ny-library-grid--quiet">
                  {randomPicks.map((f) => (
                    <LibraryCard key={f.id} folder={f} positions={positions} />
                  ))}
                </div>
              )}
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

      {/* OnboardingStrip is suppressed once both onboarding gates are green.
          The same actions (change folder, manage access) live in the
          LibraryHealthCard rail, so the strip was a duplicate row stealing
          vertical space on returning visits. It re-appears the moment
          either gate breaks (key cleared, root unreachable). */}
      {(!keyConfigured || !hasRoot) && (
        <OnboardingStrip
          keyConfigured={keyConfigured}
          rootPaired={hasRoot}
          onPickRoot={() => setRootDialogOpen(true)}
          onOpenSetup={() => setSetupOpen(true)}
        />
      )}

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

/** FNV-1a 32-bit, used to seed the featured pick deterministically. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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
