/**
 * PlaylistSidebar — vertical list for the player page.
 *
 * Renders Up Next (videos after current), then a divider, then Random Picks.
 * Current item highlighted with pink left-bar; each row has thumb + cleaned
 * title + progress bar + duration.
 */

import { useMemo, useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import type { DriveFile, PlaybackPosition } from "@shared/types";
import { WATCHED_THRESHOLD_PCT } from "@shared/constants";
import { normalizeMovieTitle } from "../services/title-normalizer";
import { buildPublicStreamUrl } from "../services/drive-api";
import { formatRuntimeFromMillis } from "../services/formatters";
import { playbackProgressPct } from "../services/storage";
import { shuffle } from "../utils/shuffle";
import { NyrimaMark } from "./NyrimaMark";
import "./PlaylistSidebar.scss";

interface Props {
  videos: DriveFile[];
  currentFileId: string;
  folderId: string;
  positions?: Record<string, PlaybackPosition>;
}

export function PlaylistSidebar({
  videos,
  currentFileId,
  folderId,
  positions,
}: Props) {
  const navigate = useNavigate();

  const { upNext, randomPicks } = useMemo(() => {
    const currentIndex = videos.findIndex((v) => v.id === currentFileId);
    const upNext =
      currentIndex >= 0
        ? videos.slice(currentIndex + 1, currentIndex + 6)
        : videos.slice(0, 5);
    const upNextIds = new Set(upNext.map((v) => v.id));
    const randomPicks = shuffle(
      videos.filter(
        (v) => v.id !== currentFileId && !upNextIds.has(v.id),
      ),
    ).slice(0, 5);
    return { upNext, randomPicks };
  }, [videos, currentFileId]);

  return (
    <div className="ny-playlist">
      {upNext.length > 0 && (
        <section className="ny-playlist__section">
          <h3 className="ny-playlist__heading">Up Next</h3>
          <div className="ny-playlist__list">
            {upNext.map((v) => (
              <PlaylistItem
                key={v.id}
                file={v}
                isCurrent={false}
                position={positions?.[v.id]}
                onClick={() =>
                  navigate(
                    `/play/${encodeURIComponent(folderId)}/${encodeURIComponent(v.id)}`,
                  )
                }
              />
            ))}
          </div>
        </section>
      )}

      {randomPicks.length > 0 && (
        <section className="ny-playlist__section">
          <h3 className="ny-playlist__heading">Random Picks</h3>
          <div className="ny-playlist__list">
            {randomPicks.map((v) => (
              <PlaylistItem
                key={v.id}
                file={v}
                isCurrent={v.id === currentFileId}
                position={positions?.[v.id]}
                onClick={() =>
                  navigate(
                    `/play/${encodeURIComponent(folderId)}/${encodeURIComponent(v.id)}`,
                  )
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function VideoPreview({
  fileId,
  onLoaded,
}: {
  fileId: string;
  onLoaded: () => void;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    buildPublicStreamUrl(fileId)
      .then((url) => {
        if (mounted && url) {
          setVideoUrl(url);
        }
      })
      .catch((err) => {
        console.error(`Failed to load preview for ${fileId}`, err);
      });
    return () => {
      mounted = false;
    };
  }, [fileId]);

  if (!videoUrl) return null;

  return (
    <video
      className="ny-playlist__preview-video"
      src={videoUrl}
      autoPlay
      muted
      loop
      playsInline
      onLoadedData={onLoaded}
    />
  );
}

// Simple SVG Play Icon for the preview feature
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

function PlaylistItem({
  file,
  isCurrent,
  position,
  onClick,
}: {
  file: DriveFile;
  isCurrent: boolean;
  position?: PlaybackPosition;
  onClick: () => void;
}) {
  const [isHovering, setIsHovering] = useState(false);
  const [isPreviewLoaded, setIsPreviewLoaded] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleaned = useMemo(() => normalizeMovieTitle(file.name), [file.name]);
  const duration = formatRuntimeFromMillis(
    file.videoMediaMetadata?.durationMillis,
  );
  const thumb = file.thumbnailLink;
  const progressPct = playbackProgressPct(position);

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(true);
    }, 300); // 300ms delay before showing preview
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setIsHovering(false);
    setIsPreviewLoaded(false);
  };

  return (
    <div
      className={cn("ny-playlist__item", { "is-current": isCurrent })}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      aria-label={
        isCurrent ? `Now playing ${cleaned.title}` : `Play ${cleaned.title}`
      }
    >
      <div className="ny-playlist__thumb">
        {isHovering && (
          <VideoPreview
            fileId={file.id}
            onLoaded={() => setIsPreviewLoaded(true)}
          />
        )}
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn({ "is-preview-active": isPreviewLoaded })}
          />
        ) : (
          <NyrimaMark size="header" />
        )}
        <div
          className="ny-playlist__thumb-overlay"
          style={{ opacity: isPreviewLoaded ? 0 : undefined }}
        >
          <div className="ny-playlist__play-icon">
            <PlayIcon />
          </div>
        </div>
      </div>

      <div className="ny-playlist__body">
        <span className="ny-playlist__title" title={cleaned.title}>
          {cleaned.title}
        </span>
        <span className="ny-playlist__meta">
          {duration && <span>{duration}</span>}
          {position && progressPct < WATCHED_THRESHOLD_PCT && (
            <span className="ny-playlist__progress">{`${progressPct}%`}</span>
          )}
          {progressPct >= WATCHED_THRESHOLD_PCT && (
            <span className="ny-playlist__progress">Watched</span>
          )}
        </span>
        {progressPct > 0 && progressPct < WATCHED_THRESHOLD_PCT && (
          <div className="ny-playlist__progress-bar-container">
            <div
              className="ny-playlist__progress-bar"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
