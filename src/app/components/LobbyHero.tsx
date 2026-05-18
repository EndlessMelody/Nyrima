/**
 * LobbyHero — featured-video hero for the lobby.
 *
 * Backdrop image at 16:7, gradient overlay to navy on the left, content stack
 * with eyebrow, title, meta row, and a Play button. The whole hero is a
 * single semantic button so screen readers don't see a nested
 * button-inside-a-button pattern; the visible Play pill is just a styled
 * highlight inside the same click target.
 *
 * Title source: the caller passes the *folder name* (the show / library
 * name) — that's what the user wants to see for "what's featured", not the
 * filename of the random episode the rotator picked. The filename's
 * cleaned title is kept as a defensive fallback in case the folder name
 * hasn't loaded yet.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { DriveFile } from "@shared/types";
import { normalizeMovieTitle } from "@shared/title-parser";
import { formatRuntimeFromMillis } from "../services/formatters";
import { HeroSkeleton } from "./HeroSkeleton";
import "./LobbyHero.scss";

interface Props {
  file: DriveFile | null;
  /** Folder cover poster URL (the user-placed `Poster.*` in the folder).
   *  Used as the backdrop when the file has no Drive frame thumbnail. */
  posterUrl?: string;
  /** Display title — typically the folder / library name. */
  title?: string;
  folderId: string;
  loading?: boolean;
}

export function LobbyHero({
  file,
  posterUrl,
  title,
  folderId,
  loading,
}: Props) {
  const navigate = useNavigate();

  const cleaned = useMemo(
    () => (file ? normalizeMovieTitle(file.name) : null),
    [file],
  );

  if (loading || !file || !cleaned) {
    return <HeroSkeleton />;
  }

  const displayTitle = title || cleaned.title;
  // Backdrop preference: Drive's actual frame from the featured episode
  // (cinematic) > the folder's Poster.* (square but matched to the show).
  // The poster fallback ensures the hero never renders empty when Drive
  // has no thumbnailLink for the picked file.
  const backdrop = file.thumbnailLink || posterUrl;
  const quality = cleaned.quality;
  const resolution = file.videoMediaMetadata
    ? `${file.videoMediaMetadata.width ?? "?"}×${file.videoMediaMetadata.height ?? "?"}`
    : undefined;
  const runtime = formatRuntimeFromMillis(
    file.videoMediaMetadata?.durationMillis,
  );

  const handlePlay = () => {
    navigate(
      `/play/${encodeURIComponent(folderId)}/${encodeURIComponent(file.id)}`,
    );
  };

  return (
    <button
      type="button"
      className="ny-hero ny-focusable"
      onClick={handlePlay}
      aria-label={`Play ${displayTitle}`}
    >
      <div className="ny-hero__backdrop">
        {backdrop ? (
          <img
            src={backdrop}
            alt=""
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        ) : (
          <div className="ny-hero__fallback" />
        )}
        <div className="ny-hero__gradient" />
      </div>

      <div className="ny-hero__content">
        <span className="ny-hero__eyebrow">NYRIMA · FEATURED</span>
        <h2 className="ny-hero__title">{displayTitle}</h2>

        <div className="ny-hero__meta">
          {runtime && <span>{runtime}</span>}
          {quality && <span className="ny-hero__pill">{quality}</span>}
          {resolution && <span>{resolution}</span>}
        </div>

        <div className="ny-hero__actions">
          <span className="ny-hero__btn ny-hero__btn--primary" aria-hidden>
            <PlayIcon /> Play
          </span>
        </div>
      </div>
    </button>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="16" height="16">
      <path d="M4 2l10 6-10 6V2z" fill="currentColor" />
    </svg>
  );
}
