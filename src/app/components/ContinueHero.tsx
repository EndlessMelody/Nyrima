/**
 * ContinueHero — cinematic "resume watching" hero for the lobby.
 *
 * Renders when the user has at least one in-progress playback position.
 * Pulls the most-recent in-progress entry, builds a clean episode title
 * from its parent folder + filename, and offers Resume / Restart /
 * Open folder actions.
 *
 * The backdrop tries (in order):
 *   1. Drive thumbnailLink if we have a DriveFile pulled in by the page
 *   2. A neon gradient fallback so the hero never renders empty.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type {
  DriveFile,
  PlaybackPosition,
  RecentFolder,
} from "@shared/types";
import { parseTitle } from "@shared/title-parser";
import { formatTimecode, formatRuntime } from "../services/formatters";
import { NyrimaMark } from "./NyrimaMark";
import "./ContinueHero.scss";

interface Props {
  position: PlaybackPosition;
  folder?: RecentFolder;
  /** Optional file lookup (gives us a real thumbnailLink). */
  file?: DriveFile | null;
}

export function ContinueHero({ position, folder, file }: Props) {
  const navigate = useNavigate();

  const folderId = position.folderId ?? folder?.id ?? "";
  const fileId = position.fileId;
  const rawName = position.name ?? file?.name ?? "Unknown";
  const folderName = folder?.name ?? "";

  const parsed = useMemo(
    () => parseTitle({ filename: rawName, parentFolder: folderName }),
    [folderName, rawName],
  );

  const progressPct =
    position.durationSeconds > 0
      ? Math.min(
          100,
          (position.positionSeconds / position.durationSeconds) * 100,
        )
      : 0;

  const remainingSec = Math.max(
    0,
    position.durationSeconds - position.positionSeconds,
  );

  const backdrop = file?.thumbnailLink;

  const goPlay = (restart = false) => {
    const url = `/play/${encodeURIComponent(folderId)}/${encodeURIComponent(fileId)}${
      restart ? "?restart=1" : ""
    }`;
    navigate(url);
  };

  const goFolder = () => {
    if (folderId) navigate(`/library/${encodeURIComponent(folderId)}`);
  };

  return (
    <section className="ny-continue-hero" aria-label="Continue watching">
      <div className="ny-continue-hero__backdrop">
        {backdrop ? (
          <img
            src={backdrop}
            alt=""
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        ) : (
          <div className="ny-continue-hero__backdrop-fallback">
            <NyrimaMark size="hero" />
          </div>
        )}
        <div className="ny-continue-hero__scrim" />
        <div className="ny-continue-hero__neon" aria-hidden />
      </div>

      <div className="ny-continue-hero__panel">
        <span className="ny-continue-hero__eyebrow">
          続きから · CONTINUE WATCHING
        </span>

        <h2 className="ny-continue-hero__title" title={parsed.fullTitle}>
          {parsed.fullTitle}
        </h2>

        {folderName && (
          <span
            className="ny-continue-hero__filename"
            title={`${rawName}`}
          >
            {folderName} · {rawName}
          </span>
        )}

        <div className="ny-continue-hero__progress" aria-hidden>
          <div className="ny-continue-hero__progress-track">
            <div
              className="ny-continue-hero__progress-bar"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="ny-continue-hero__progress-meta">
            <span>{formatTimecode(position.positionSeconds)}</span>
            <span className="ny-continue-hero__progress-sep">/</span>
            <span>{formatTimecode(position.durationSeconds)}</span>
            {remainingSec > 0 && (
              <span className="ny-continue-hero__remaining">
                · {formatRuntime(remainingSec)} left
              </span>
            )}
          </div>
        </div>

        <div className="ny-continue-hero__actions">
          <button
            type="button"
            className="ny-btn ny-btn--primary ny-continue-hero__resume"
            onClick={() => goPlay(false)}
          >
            <PlayIcon />
            Resume
          </button>
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={() => goPlay(true)}
            title="Start from the beginning"
          >
            <RestartIcon />
            Restart
          </button>
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={goFolder}
            title="Open the library this episode lives in"
          >
            <FolderIcon />
            Open folder
          </button>
        </div>
      </div>
    </section>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <path d="M4 2l10 6-10 6V2z" fill="currentColor" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <path
        d="M3 8a5 5 0 1 0 1.6-3.7M3 2v3.4h3.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.4a1.5 1.5 0 0 1 1.06.44L8.2 4.3a1 1 0 0 0 .7.3H12.5A1.5 1.5 0 0 1 14 6.1V11.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
