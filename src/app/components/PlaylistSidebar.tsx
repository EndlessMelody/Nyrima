/**
 * PlaylistSidebar — vertical list for the player page.
 *
 * Renders Up Next (videos after current), then a divider, then Random Picks.
 * Current item highlighted with pink left-bar; each row has thumb + cleaned
 * title + progress bar + duration.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import type { DriveFile, PlaybackPosition } from "@shared/types";
import { WATCHED_THRESHOLD_PCT } from "@shared/constants";
import { normalizeMovieTitle } from "../services/title-normalizer";
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
    const randomPicks = shuffle(
      videos.filter((v) => v.id !== currentFileId),
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
  const cleaned = useMemo(
    () => normalizeMovieTitle(file.name),
    [file.name],
  );
  const duration = formatRuntimeFromMillis(
    file.videoMediaMetadata?.durationMillis,
  );
  const thumb = file.thumbnailLink;
  const progressPct = playbackProgressPct(position);

  return (
    <div
      className={cn("ny-playlist__item", "ny-focusable", {
        "is-current": isCurrent,
      })}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={
        isCurrent ? `Now playing ${cleaned.title}` : `Play ${cleaned.title}`
      }
    >
      <div className="ny-playlist__thumb">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" decoding="async" />
        ) : (
          <NyrimaMark size="header" />
        )}
      </div>

      <div className="ny-playlist__body">
        <span className="ny-playlist__title" title={cleaned.title}>
          {cleaned.title}
        </span>
        <span className="ny-playlist__meta">
          {duration && <span>{duration}</span>}
          {position && (
            <span className="ny-playlist__progress">
              {progressPct >= WATCHED_THRESHOLD_PCT
                ? "Watched"
                : `${progressPct}%`}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
