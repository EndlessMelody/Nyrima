/**
 * Lobby — Neon Drive Cinema dashboard.
 *
 * Layout strategy:
 *   - If the user has no Drive API key OR no libraries yet, lead with the
 *     full WelcomeBlock (onboarding-first).
 *   - Once the user has libraries, the lobby switches to a media dashboard:
 *       • Continue Hero (when there's an in-progress video) or compact
 *         featured-video LobbyHero (when there isn't).
 *       • SearchFilterBar for fast library/episode lookup.
 *       • Main column with shelves: Continue Watching, Pinned, All
 *         Libraries, Random Picks.
 *       • Right rail with the LibraryHealthCard.
 *       • Collapsed OnboardingStrip in the footer.
 *
 * All shelves and the right rail derive entirely from already-loaded
 * `recentStore.folders` + `usePlaybackPositions()` — no extra Drive
 * round-trips beyond the existing featured-video lookup.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Column,
  Row,
  Text,
  Button,
  Input,
  Dialog,
} from "@once-ui-system/core/components";
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
import { WelcomeBlock } from "../components/WelcomeBlock";
import { extractFolderId } from "@shared/parse-folder-url";
import { useNavigate } from "react-router-dom";
import { hasApiKey } from "../services/api-key";
import { isVideoFile } from "../services/drive-api";
import {
  getFileMetadata,
  listFolder as cachedListFolder,
} from "../services/drive/metadata-service";
import { resolvePoster } from "../services/poster-resolver";
import { isInProgress } from "../services/storage";
import { shuffle } from "../utils/shuffle";
import type {
  DriveFile,
  MovieMetadata,
  PlaybackPosition,
  RecentFolder,
} from "@shared/types";
import "./LandingPage.scss";

export function LandingPage() {
  const { folders, load } = useRecentStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("setup") === "1";
    }
    return false;
  });
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
    void load();
  }, [load]);

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

  // --- Continue / Featured -------------------------------------------------
  // Most-recent in-progress position drives the Continue hero. We
  // additionally fetch the file's Drive metadata so the hero can show a
  // real backdrop instead of a gradient.
  const mostRecentInProgress = useMemo<PlaybackPosition | null>(() => {
    const inProgress = Object.values(positions).filter(isInProgress);
    if (inProgress.length === 0) return null;
    return inProgress.reduce((best, p) =>
      (p.updatedAt ?? 0) > (best.updatedAt ?? 0) ? p : best,
    );
  }, [positions]);

  // Pull the matching RecentFolder for the hero panel + episode title.
  const continueFolder = useMemo<RecentFolder | undefined>(() => {
    if (!mostRecentInProgress?.folderId) return undefined;
    return folders.find((f) => f.id === mostRecentInProgress.folderId);
  }, [folders, mostRecentInProgress]);

  // Lazily load the Drive thumbnailLink for the continue hero. We only
  // need this for the backdrop image — text content comes from the
  // PlaybackPosition itself.
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

  // Featured fallback (random video from the most-recent folder) — only
  // computed when there's nothing in progress to resume.
  useEffect(() => {
    if (mostRecentInProgress) return;
    if (folders.length === 0) return;
    let cancelled = false;
    const ctrl = new AbortController();
    const mostRecent = folders[0];
    void (async () => {
      try {
        // Cached read: the lobby revisits this every time the user returns
        // here, so going through the SWR cache turns the random-pick into
        // a zero-request operation on warm cache.
        const result = await cachedListFolder(mostRecent.id, {
          signal: ctrl.signal,
          priority: "low",
        });
        const videos = result.files.filter(isVideoFile);
        if (videos.length === 0) return;
        const pick =
          videos[Math.floor(Math.random() * Math.min(videos.length, 30))];
        if (!cancelled) {
          setFeatured(pick);
          setFeaturedFolderId(mostRecent.id);
          const meta = await resolvePoster(pick);
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
  }, [folders, mostRecentInProgress]);

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
  // Build the set of folder ids that have in-progress positions so the
  // "Continue Watching" filter chip can resolve cheaply.
  const inProgressFolderIds = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const p of Object.values(positions)) {
      if (isInProgress(p) && p.folderId) set.add(p.folderId);
    }
    return set;
  }, [positions]);

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return folders.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q)) return false;
      if (filter === "continue" && !inProgressFolderIds.has(f.id)) return false;
      if (filter === "unwatched" && inProgressFolderIds.has(f.id)) return false;
      return true;
    });
  }, [folders, query, filter, inProgressFolderIds]);

  const pinned = filteredFolders.filter((f) => f.pinned);
  const others = filteredFolders.filter((f) => !f.pinned);

  // Random picks: pull from the non-pinned others, capped to a small set so
  // the shelf feels curated rather than dumping the whole library.
  const randomPicks = useMemo(() => {
    if (others.length <= 4) return [] as RecentFolder[];
    return shuffle(others).slice(0, 4);
  }, [others]);

  const hasLibraries = folders.length > 0;
  const showFullOnboarding = !keyConfigured || !hasLibraries;
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

  function onSubmit() {
    const id = extractFolderId(input.trim());
    if (!id) {
      setError("Could not find a folder id in that input.");
      return;
    }
    setOpen(false);
    setInput("");
    setError(null);
    navigate(`/library/${encodeURIComponent(id)}`);
  }

  // --- Render --------------------------------------------------------------
  // First-run / no-libraries view: full WelcomeBlock + dialogs only.
  if (showFullOnboarding) {
    return (
      <div className="ny-landing">
        <WelcomeBlock
          keyConfigured={keyConfigured}
          onOpenFolder={() => setOpen(true)}
          onOpenSetup={() => setSetupOpen(true)}
        />

        {hasLibraries && (
          <section className="ny-landing__section">
            <h3 className="ny-landing__section-heading">Libraries</h3>
            <div className="ny-library-grid">
              {folders.map((f) => (
                <LibraryCard key={f.id} folder={f} positions={positions} />
              ))}
            </div>
          </section>
        )}

        <DashboardDialogs
          open={open}
          setOpen={setOpen}
          input={input}
          setInput={setInput}
          error={error}
          setError={setError}
          onSubmit={onSubmit}
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
                onAdd={() => setOpen(true)}
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
            folders={folders}
            positions={positions}
            apiKeyConfigured={keyConfigured}
            onOpenFolder={() => setOpen(true)}
            onOpenSetup={() => setSetupOpen(true)}
          />
        </aside>
      </div>

      <OnboardingStrip
        keyConfigured={keyConfigured}
        onOpenFolder={() => setOpen(true)}
        onOpenSetup={() => setSetupOpen(true)}
      />

      <DashboardDialogs
        open={open}
        setOpen={setOpen}
        input={input}
        setInput={setInput}
        error={error}
        setError={setError}
        onSubmit={onSubmit}
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
  onAdd,
  onReset,
}: {
  query: string;
  filter: LobbyFilter;
  onAdd: () => void;
  onReset: () => void;
}) {
  const filtered = query.trim() !== "" || filter !== "all";
  return (
    <div className="ny-landing__empty">
      <span className="dc-tracker">{filtered ? "NO MATCHES" : "NO ENTRIES"}</span>
      <p className="ny-landing__empty-title">
        {filtered ? "Nothing matches your filter" : "No libraries yet"}
      </p>
      <p className="ny-landing__empty-sub">
        {filtered
          ? "Try clearing the search or switching back to All."
          : "Open any Drive folder to start your cinema archive."}
      </p>
      {filtered ? (
        <button type="button" className="ny-btn ny-btn--ghost" onClick={onReset}>
          Clear filter
        </button>
      ) : (
        <button
          type="button"
          className="ny-btn ny-btn--primary"
          onClick={onAdd}
        >
          Open a folder
        </button>
      )}
    </div>
  );
}

function DashboardDialogs({
  open,
  setOpen,
  input,
  setInput,
  error,
  setError,
  onSubmit,
  setupOpen,
  handleCloseSetup,
  setKeyConfigured,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  input: string;
  setInput: (v: string) => void;
  error: string | null;
  setError: (v: string | null) => void;
  onSubmit: () => void;
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
      <Dialog
        isOpen={open}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        title="Open a Drive folder"
        description="Paste a Google Drive folder URL or its ID."
        style={{
          backgroundColor: "var(--page-background)",
        }}
        footer={
          <Row gap="8">
            <Button variant="tertiary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onSubmit}>
              Open
            </Button>
          </Row>
        }
      >
        <Column gap="8" paddingY="8">
          <Input
            id="folder-url"
            label="Folder URL or ID"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
          />
          {error && (
            <Text variant="body-default-xs" onBackground="danger-medium">
              {error}
            </Text>
          )}
          <Text variant="body-default-xs" onBackground="neutral-weak">
            Tip: right-click any folder on drive.google.com and choose "Open
            with Nyrima".
          </Text>
        </Column>
      </Dialog>
    </>
  );
}
