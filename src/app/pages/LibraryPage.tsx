/**
 * Library page — Cinematic folder lobby.
 *
 * Sections:
 *   - LobbyHero (featured video)
 *   - ContinueWatchingRow (partial watches in this folder)
 *   - PosterCard grid (all videos)
 *   - SuggestionList (random picks)
 *   - Compact folders row (subfolders)
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useLibraryStore } from "../stores/library-store";
import { useRecentStore } from "../stores/recent-store";
import { usePlaybackPositions } from "../hooks/usePlaybackPositions";
import { LobbyHero } from "../components/LobbyHero";
import { ContinueWatchingRow } from "../components/ContinueWatchingRow";
import { PosterCard } from "../components/PosterCard";
import { PosterSkeleton } from "../components/PosterSkeleton";
import { SuggestionList } from "../components/SuggestionList";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import { NyrimaMark } from "../components/NyrimaMark";
import { resolvePoster } from "../services/poster-resolver";
import { getManyCached } from "../services/metadata-cache";
import { isWatched } from "../services/storage";
import { driveFolderUrl } from "@shared/drive-urls";
import type { DriveAccessReason } from "../services/errors";
import type { DriveFile, MovieMetadata } from "@shared/types";
import "./LibraryPage.scss";

export function LibraryPage() {
  const { folderId = "" } = useParams();
  const navigate = useNavigate();
  const { loading, error, errorReason, videos, subfolders, loadFolder } =
    useLibraryStore();
  const upsertRecent = useRecentStore((s) => s.upsert);
  const [setupOpen, setSetupOpen] = useState(false);
  const [positions] = usePlaybackPositions(folderId);
  const [bulkMeta, setBulkMeta] = useState<Record<string, MovieMetadata>>({});
  const [featuredMeta, setFeaturedMeta] = useState<MovieMetadata | null>(null);

  useEffect(() => {
    if (folderId) void loadFolder(folderId);
  }, [folderId, loadFolder]);

  useEffect(() => {
    if (!folderId || (videos.length === 0 && subfolders.length === 0)) return;
    void upsertRecent({
      id: folderId,
      name:
        deriveFolderName(videos[0]?.video.name, subfolders[0]?.name) ??
        "Drive folder",
      lastOpenedAt: Date.now(),
      itemCount: videos.length + subfolders.length,
    });
  }, [folderId, videos, subfolders, upsertRecent]);

  // Seed by folderId so revisiting the same library doesn't pick a new
  // featured every time (which would also trigger a poster-resolver call).
  const featured = useMemo(() => {
    if (videos.length === 0) return null;
    const seed = hashString(folderId);
    const idx = seed % Math.min(videos.length, 30);
    return videos[idx]?.video ?? null;
  }, [videos, folderId]);

  useEffect(() => {
    if (!featured) return;
    let cancelled = false;
    void (async () => {
      const meta = await resolvePoster(featured);
      if (!cancelled) setFeaturedMeta(meta);
    })();
    return () => {
      cancelled = true;
    };
  }, [featured]);

  // Bulk-load cached metadata in one chrome.storage read so every PosterCard
  // doesn't pay its own round-trip; misses still fall back to the per-card
  // resolvePoster fetch.
  useEffect(() => {
    if (videos.length === 0) return;
    let cancelled = false;
    void (async () => {
      const ids = videos.map((v) => v.video.id);
      const map = await getManyCached(ids);
      if (!cancelled) setBulkMeta(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [videos]);

  const shortFolderId = (folderId || "").slice(0, 10).toUpperCase();

  if (loading) {
    return (
      <div className="ny-library">
        <LibraryHeader
          title="Loading library…"
          shortFolderId={shortFolderId}
          onBack={() => navigate("/")}
        />
        <PosterSkeleton count={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="ny-library">
        <LibraryHeader
          title="Access denied"
          shortFolderId={shortFolderId}
          onBack={() => navigate("/")}
        />
        <AccessErrorCard
          reason={errorReason}
          message={error}
          folderId={folderId}
          onRetry={() => void loadFolder(folderId)}
          onOpenSetup={() => setSetupOpen(true)}
        />
        <SetupAccessDialog
          isOpen={setupOpen}
          onClose={() => setSetupOpen(false)}
          onSaved={() => {
            setSetupOpen(false);
            void loadFolder(folderId);
          }}
        />
      </div>
    );
  }

  const empty = videos.length === 0 && subfolders.length === 0;
  const videoFiles = videos.map((v) => v.video);

  return (
    <div className="ny-library">
      <LibraryHeader
        title={
          deriveFolderName(videoFiles[0]?.name, subfolders[0]?.name) ??
          "Library"
        }
        shortFolderId={shortFolderId}
        onBack={() => navigate("/")}
      />

      {featured && (
        <LobbyHero file={featured} meta={featuredMeta} folderId={folderId} />
      )}

      {!empty && (
        <ContinueWatchingRow
          videos={videoFiles}
          folderId={folderId}
          positions={positions}
          metaByFileId={bulkMeta}
        />
      )}

      {videoFiles.length > 0 && (
        <section className="ny-library__section">
          <h3 className="ny-library__section-heading">All Videos</h3>
          <div className="ny-poster-grid">
            {videoFiles.map((v) => (
              <PosterCard
                key={v.id}
                file={v}
                folderId={folderId}
                meta={bulkMeta[v.id]}
                playbackPosition={
                  positions[v.id]
                    ? {
                        positionSeconds: positions[v.id].positionSeconds,
                        durationSeconds: positions[v.id].durationSeconds,
                      }
                    : undefined
                }
                watched={isWatched(positions[v.id])}
              />
            ))}
          </div>
        </section>
      )}

      <SuggestionList
        videos={videoFiles}
        excludeFileId={featured?.id}
        folderId={folderId}
      />

      {subfolders.length > 0 && (
        <section className="ny-library__section">
          <h3 className="ny-library__section-heading">Folders</h3>
          <div className="ny-folder-row">
            {subfolders.map((sf) => (
              <div
                key={sf.id}
                className="ny-folder-chip ny-focusable"
                role="button"
                tabIndex={0}
                onClick={() =>
                  navigate(`/library/${encodeURIComponent(sf.id)}`)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/library/${encodeURIComponent(sf.id)}`);
                  }
                }}
                aria-label={`Open subfolder ${sf.name}`}
              >
                <SubfolderIcon />
                <span>{sf.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {empty && (
        <div className="ny-library__empty">
          <NyrimaMark size="splash" />
          <span className="dc-tracker">EMPTY LIBRARY</span>
          <p className="ny-library__empty-title">No videos here yet</p>
          <p className="ny-library__empty-sub">
            This folder doesn't contain any recognized video files. Drop an MP4,
            WebM, or MKV onto Google Drive and it'll appear here.
          </p>
        </div>
      )}

      <SetupAccessDialog
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onSaved={() => setSetupOpen(false)}
      />
    </div>
  );
}

function LibraryHeader({
  title,
  shortFolderId,
  onBack,
}: {
  title: string;
  shortFolderId: string;
  onBack: () => void;
}) {
  return (
    <header className="ny-library__head">
      <div className="ny-library__head-left">
        <span className="ny-library__crumb">
          LIBRARY
          <span className="ny-library__crumb-sep" />
          {shortFolderId}
        </span>
        <h1 className="ny-library__title">{title}</h1>
      </div>
      <button type="button" className="ny-btn ny-btn--ghost" onClick={onBack}>
        <ChevronLeftIcon /> Back
      </button>
    </header>
  );
}

function deriveFolderName(
  ...candidates: (string | undefined)[]
): string | undefined {
  return candidates.find(Boolean);
}

/** Deterministic string → unsigned int hash; used to seed featured pick. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// AccessErrorCard
// ---------------------------------------------------------------------------

function AccessErrorCard({
  reason,
  message,
  folderId,
  onRetry,
  onOpenSetup,
}: {
  reason: DriveAccessReason | null;
  message: string;
  folderId: string;
  onRetry: () => void;
  onOpenSetup: () => void;
}) {
  const folderUrl = driveFolderUrl(folderId);
  const isPrivate = reason === "private-folder" || reason === "not-found";
  const needsKey = reason === "no-api-key" || reason === "auth-required";

  const title = needsKey
    ? "Drive access isn't set up yet"
    : isPrivate
      ? "This folder isn't shared publicly"
      : reason === "rate-limited"
        ? "Drive is rate-limiting us"
        : "Couldn't load this folder";

  return (
    <div className="dc-error">
      <div className="dc-error__head">
        <span className="dc-error__icon" aria-hidden>
          <LockIcon />
        </span>
        <div className="dc-error__body">
          <span className="dc-tracker dc-tracker--accent">
            ACCESS ERROR
            {reason && <span className="dc-error__reason">{reason}</span>}
          </span>
          <span className="dc-error__title">{title}</span>
          <span className="dc-error__sub">{message}</span>
        </div>
      </div>

      {isPrivate && (
        <div className="dc-error__steps">
          <span className="dc-error__steps-title">How to share the folder</span>
          <div>
            1.{" "}
            <a href={folderUrl} target="_blank" rel="noreferrer">
              Open the folder on drive.google.com
            </a>
            <br />
            2. Right-click the folder → <em>Share</em> → <em>Share</em>.
            <br />
            3. Under "General access" pick <em>Anyone with the link</em> →{" "}
            <em>Viewer</em>.
            <br />
            4. Click <em>Done</em>, then come back here and hit{" "}
            <em>Try again</em>.
          </div>
        </div>
      )}

      <div className="dc-error__actions">
        {needsKey && (
          <button
            type="button"
            className="ny-btn ny-btn--primary"
            onClick={onOpenSetup}
          >
            Setup access
          </button>
        )}
        <button type="button" className="ny-btn ny-btn--ghost" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
      <path
        d="m10 3-4 5 4 5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SubfolderIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden width="16" height="16">
      <path
        d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3.2a1.5 1.5 0 0 1 1.06.44L9.2 5.3a1 1 0 0 0 .7.3H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 15.6H4A1.5 1.5 0 0 1 2.5 14.1v-8.6Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="3"
        y="7"
        width="10"
        height="6.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
