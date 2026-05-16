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

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import type { DriveFile, MovieMetadata } from "@shared/types";
import { resolvePoster } from "../services/poster-resolver";
import { normalizeMovieTitle } from "@shared/title-parser";
import { playbackProgressPct } from "../services/storage";
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
  playbackPosition,
  watched,
}: Props) {
  const navigate = useNavigate();
  const [fetchedMeta, setFetchedMeta] = useState<MovieMetadata | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  const meta = externalMeta ?? fetchedMeta;

  const cleaned = useMemo(
    () => normalizeMovieTitle(file.name),
    [file.name],
  );

  useEffect(() => {
    if (externalMeta) return;
    let mounted = true;
    void (async () => {
      const m = await resolvePoster(file, folderName);
      if (mounted) setFetchedMeta(m);
    })();
    return () => {
      mounted = false;
    };
  }, [file, folderName, externalMeta]);

  const thumbUrl =
    variant === "backdrop"
      ? meta?.backdropUrl || meta?.posterUrl || file.thumbnailLink
      : meta?.posterUrl || file.thumbnailLink;
  const displayTitle = meta?.title || cleaned.title;

  const progressPct = playbackProgressPct(playbackPosition);

  const handleClick = () => {
    if (folderId) {
      navigate(
        `/play/${encodeURIComponent(folderId)}/${encodeURIComponent(file.id)}`,
      );
    }
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
