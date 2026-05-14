/**
 * FolderCard — hairline tile for a recently-opened Drive folder.
 *
 * Design: a flat, hairline-bordered rectangle with a corner mark in the
 * top-left (gold pip when pinned), a small folder icon glyph, a Geist Sans
 * title line, a tiny mono short-id line, and a meta strip at the bottom that
 * reveals pin/remove actions on hover.
 *
 * The whole tile is clickable. Action buttons stopPropagation so they don't
 * navigate when toggled.
 */

import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { RecentFolder } from "@shared/types";
import { useRecentStore } from "../stores/recent-store";
import "./FolderCard.scss";

interface Props {
  folder: RecentFolder;
}

export function FolderCard({ folder }: Props) {
  const navigate = useNavigate();
  const { togglePin, remove } = useRecentStore();

  const onOpen = () => navigate(`/library/${encodeURIComponent(folder.id)}`);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };

  // Show the first 6 chars of the Drive ID as a technical short identifier.
  const shortId = folder.id.slice(0, 8).toUpperCase();

  return (
    <div
      className={`dc-folder ${folder.pinned ? "dc-folder--pinned" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      aria-label={`Open ${folder.name}`}
    >
      <span className="dc-folder__corner" aria-hidden />

      <div className="dc-folder__row-top">
        <span className="dc-folder__icon" aria-hidden>
          <FolderGlyph />
        </span>
        <div className="dc-folder__title-block">
          <span className="dc-folder__title" title={folder.name}>
            {folder.name}
          </span>
          <span className="dc-folder__id">ID · {shortId}</span>
        </div>
      </div>

      <div className="dc-folder__row-bottom">
        <span className="dc-folder__meta">
          <span>{formatRelative(folder.lastOpenedAt)}</span>
          <span className="dc-folder__sep" aria-hidden />
          <span>
            {folder.itemCount != null
              ? `${String(folder.itemCount).padStart(2, "0")} ITEMS`
              : "—"}
          </span>
        </span>

        <span
          className="dc-folder__actions"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={`dc-folder__action dc-folder__action--pin ${folder.pinned ? "is-pinned" : ""}`}
            onClick={() => togglePin(folder.id)}
            aria-label={folder.pinned ? "Unpin folder" : "Pin folder"}
            title={folder.pinned ? "Unpin" : "Pin"}
          >
            <PinIcon />
          </button>
          <button
            type="button"
            className="dc-folder__action dc-folder__action--danger"
            onClick={() => remove(folder.id)}
            aria-label="Remove folder"
            title="Remove"
          >
            <CrossIcon />
          </button>
        </span>
      </div>
    </div>
  );
}

function formatRelative(epoch: number): string {
  const diff = Date.now() - epoch;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "JUST NOW";
  if (diff < hr) return `${Math.floor(diff / min)}M AGO`;
  if (diff < day) return `${Math.floor(diff / hr)}H AGO`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}D AGO`;
  return new Date(epoch).toLocaleDateString();
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.4a1.5 1.5 0 0 1 1.06.44L8.2 4.3a1 1 0 0 0 .7.3H12.5A1.5 1.5 0 0 1 14 6.1V11.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5v6m-3 0h6l-1.2 2H6.2L5 7.5Zm0 0L8 13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="m4 4 8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
