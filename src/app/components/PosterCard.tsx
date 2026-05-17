/**
 * PosterCard — clickable card for a Drive video.
 *
 * Two visual variants:
 *   - "poster"   → 2:3 portrait (library grid, suggestions).
 *   - "backdrop" → 16:9 landscape (continue-watching scroll row).
 *
 * Lazy-loads MAL/Jikan poster via poster-resolver; falls back to Drive's
 * thumbnailLink; final fallback is a gradient tile with the Nyrima mark.
 * Parent can short-circuit the per-card fetch by passing `meta` from a
 * page-level bulk resolve.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import type { DriveFile, MovieMetadata } from "@shared/types";
import { resolvePoster } from "../services/poster-resolver";
import { normalizeMovieTitle, parseTitle } from "@shared/title-parser";
import {
  playbackProgressPct,
  savePlaybackPosition,
  clearPlaybackPosition,
} from "../services/storage";
import { WATCHED_THRESHOLD_PCT } from "@shared/constants";
import { NyrimaMark } from "./NyrimaMark";
import "./PosterCard.scss";

export type PosterCardVariant = "poster" | "backdrop";

interface Props {
  file: DriveFile;
  folderId?: string;
  /** Parent-folder name. Forwarded to the resolver so episodic filenames like
   *  `[GS]01.mkv` resolve via the series name instead of the bare episode
   *  number. */
  folderName?: string;
  variant?: PosterCardVariant;
  /** When provided, skips the per-card Jikan fetch. */
  meta?: MovieMetadata | null;
  /** Series-level poster URL (resolved once per library by the parent).
   *  When present, the per-card Jikan fetch is skipped — the card relies
   *  on Drive's frame thumbnail with this as the fallback, which is the
   *  user-facing rule "use the file's thumbnail if it has one, otherwise
   *  use the series poster". */
  seriesPosterUrl?: string;
  playbackPosition?: {
    positionSeconds: number;
    durationSeconds: number;
  };
  watched?: boolean;
}

export function PosterCard({
  file,
  folderId,
  folderName,
  variant = "poster",
  meta: externalMeta,
  seriesPosterUrl,
  playbackPosition,
  watched,
}: Props) {
  const navigate = useNavigate();
  const [fetchedMeta, setFetchedMeta] = useState<MovieMetadata | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  // Right-click context menu — { x, y } in viewport space when open.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const meta = externalMeta ?? fetchedMeta;

  const cleaned = useMemo(
    () => normalizeMovieTitle(file.name),
    [file.name],
  );

  useEffect(() => {
    // Skip the per-card Jikan fetch when:
    //   - the parent supplied an explicit meta (page-level bulk resolve), or
    //   - the parent supplied a series poster (whole library resolved once), or
    //   - we have a folder context at all (the per-file resolve would query
    //     a bare "01" / "02" filename, which Jikan matches to whatever random
    //     anime contains those digits — Digimon Adventure 02, Kikaider 01,
    //     07-Ghost. Without folder context the result is noise, so refuse
    //     to fire it and let the cleaned filename serve as the title).
    if (externalMeta || seriesPosterUrl || folderName) {
      // Clear any stale per-file fetched meta so a previous render's title
      // ("Digimon Adventure 02") doesn't survive when the parent later
      // upgrades us with seriesPosterUrl.
      if (fetchedMeta) setFetchedMeta(null);
      return;
    }
    let mounted = true;
    void (async () => {
      const m = await resolvePoster(file, folderName);
      if (mounted) setFetchedMeta(m);
    })();
    return () => {
      mounted = false;
    };
    // fetchedMeta intentionally omitted from deps — including it would
    // re-fire this effect after setFetchedMeta(null) and loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, folderName, externalMeta, seriesPosterUrl]);

  // Image priority differs by aspect ratio:
  //   - "backdrop" (16:9 rows like ContinueWatching, list view) prefers
  //     Drive's frame thumbnail so the user sees the *actual scene* rather
  //     than the same series cover twelve times. Falls back to the series
  //     poster, then the per-card MAL hit.
  //   - "poster" (2:3 grid tiles) keeps the series poster first — Drive's
  //     16:9 thumbnail looks wrong cropped to portrait.
  const thumbUrl =
    variant === "backdrop"
      ? file.thumbnailLink ||
        seriesPosterUrl ||
        meta?.backdropUrl ||
        meta?.posterUrl
      : seriesPosterUrl || meta?.posterUrl || file.thumbnailLink;

  // Display title — episodes inside a known series should NEVER use the MAL
  // title field. `meta.title` is the *series* name ("Gimai Seikatsu"), which
  // would repeat across every episode card and provides no information.
  // With folder context we build "Gimai Seikatsu - Ep01" via the parser.
  // Without folder context (rare: cards rendered outside a library page) we
  // fall back to MAL → cleaned filename.
  const displayTitle = useMemo(() => {
    if (folderName) {
      try {
        const parsed = parseTitle({
          filename: file.name,
          parentFolder: folderName,
        });
        return parsed.fullTitle || parsed.cleanedFileName || cleaned.title;
      } catch {
        // ignore — fall through to MAL/cleaned
      }
    }
    return meta?.title || cleaned.title;
  }, [folderName, file.name, meta?.title, cleaned.title]);

  const progressPct = playbackProgressPct(playbackPosition);

  const handleClick = () => {
    if (folderId) {
      navigate(
        `/play/${encodeURIComponent(folderId)}/${encodeURIComponent(file.id)}`,
      );
    }
  };

  // Right-click → small menu with watch-state actions. Falls back to the
  // file's reported duration when there's no live playbackPosition; if both
  // are missing we pick a sentinel duration so the position/duration ratio
  // still trips the WATCHED_THRESHOLD_PCT gate.
  const openContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!menu) return;
    function onAway(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    window.addEventListener("mousedown", onAway);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onAway);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const fileDurationSec = (() => {
    const ms = file.videoMediaMetadata?.durationMillis;
    const n = ms ? Number(ms) : 0;
    return Number.isFinite(n) && n > 0 ? n / 1000 : 0;
  })();
  const knownDuration =
    playbackPosition?.durationSeconds || fileDurationSec || 100;

  const markWatched = async () => {
    setMenu(null);
    await savePlaybackPosition({
      fileId: file.id,
      positionSeconds: knownDuration,
      durationSeconds: knownDuration,
      updatedAt: Date.now(),
      name: file.name,
      folderId,
      mimeType: file.mimeType,
    });
  };

  const clearProgress = async () => {
    setMenu(null);
    await clearPlaybackPosition(file.id);
  };

  return (
    <div
      className={cn(
        "ny-poster-card",
        `ny-poster-card--${variant}`,
        "ny-focusable",
      )}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onContextMenu={openContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={`Play ${displayTitle}`}
    >
      <div className="ny-poster-card__frame">
        {thumbUrl ? (
          <>
            <img
              src={thumbUrl}
              alt=""
              className={cn("ny-poster-card__img", { "is-loaded": imgLoaded })}
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
            />
            {!imgLoaded && (
              <div className="ny-poster-card__skeleton ny-shimmer" />
            )}
          </>
        ) : (
          <div className="ny-poster-card__fallback">
            <NyrimaMark size="hero" />
            {variant === "poster" && (
              <span className="ny-poster-card__fallback-title">
                {displayTitle}
              </span>
            )}
          </div>
        )}

        {watched && (
          <span className="ny-poster-card__pill ny-poster-card__pill--watched">
            Watched
          </span>
        )}

        <div className="ny-poster-card__overlay" aria-hidden>
          <div className="ny-poster-card__play">
            <PlayIcon />
          </div>
        </div>

        {progressPct > 0 && progressPct < WATCHED_THRESHOLD_PCT && (
          <div className="ny-poster-card__progress">
            <div
              className="ny-poster-card__progress-bar"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>

      <div className="ny-poster-card__title" title={displayTitle}>
        {displayTitle}
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="ny-poster-card__menu"
          // Position with viewport coordinates so the menu lands under the
          // click rather than relative to the card. Using fixed lets it
          // escape the card's overflow:hidden frame.
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {!watched && (
            <button
              type="button"
              role="menuitem"
              className="ny-poster-card__menu-item"
              onClick={() => void markWatched()}
            >
              Mark as watched
            </button>
          )}
          {(watched || progressPct > 0) && (
            <button
              type="button"
              role="menuitem"
              className="ny-poster-card__menu-item"
              onClick={() => void clearProgress()}
            >
              {watched ? "Mark as unwatched" : "Clear progress"}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="ny-poster-card__menu-item ny-poster-card__menu-item--quiet"
            onClick={() => setMenu(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
    </svg>
  );
}
