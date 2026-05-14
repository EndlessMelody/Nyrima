/**
 * VideoTile — hairline 16:9 card for a Drive video.
 *
 * Layout: a poster with 4 corner brackets + a mono runtime badge in the
 * bottom-right; a hover-only gold play disc centered on the poster; a body
 * with the title in Geist Sans and a mono metadata strip (resolution pill,
 * file size, optional "CC ×N" accent pill for subtitles).
 */

import type { KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { DriveFile } from "@shared/types";
import "./VideoTile.scss";

interface Props {
  video: DriveFile;
  subtitleCount: number;
}

export function VideoTile({ video, subtitleCount }: Props) {
  const navigate = useNavigate();
  const { folderId = "" } = useParams();
  const onOpen = () =>
    navigate(
      `/play/${encodeURIComponent(folderId)}/${encodeURIComponent(video.id)}`,
    );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };

  const w = video.videoMediaMetadata?.width;
  const h = video.videoMediaMetadata?.height;
  const duration = video.videoMediaMetadata?.durationMillis
    ? formatDuration(Number(video.videoMediaMetadata.durationMillis) / 1000)
    : null;

  return (
    <div
      className="dc-video"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      aria-label={`Play ${video.name}`}
    >
      <div className="dc-video__poster">
        {video.thumbnailLink ? (
          <img
            src={video.thumbnailLink}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <svg
            className="dc-video__poster-fallback"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M9 7v10l8-5-8-5Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <div className="dc-video__corners" aria-hidden>
          <span />
        </div>
        {duration && <span className="dc-video__runtime">{duration}</span>}
        <div className="dc-video__overlay" aria-hidden>
          <span className="dc-video__play">
            <PlayIcon />
          </span>
        </div>
      </div>

      <div className="dc-video__body">
        <span className="dc-video__title" title={video.name}>
          {video.name}
        </span>
        <div className="dc-video__meta">
          {w && h && (
            <span className="dc-video__pill">
              {w}×{h}
            </span>
          )}
          {video.size && (
            <>
              <span className="dc-video__sep" aria-hidden />
              <span className="dc-video__size">
                {formatBytes(Number(video.size))}
              </span>
            </>
          )}
          {subtitleCount > 0 && (
            <>
              <span className="dc-video__sep" aria-hidden />
              <span className="dc-video__pill dc-video__pill--accent">
                CC ×{subtitleCount}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M5 3.5v9l8-4.5-8-4.5Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
