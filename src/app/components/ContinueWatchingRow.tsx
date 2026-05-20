/**
 * ContinueWatchingRow — horizontal scroll of backdrop poster cards.
 *
 * Renders files whose stored playback position is in-progress (a few seconds
 * past the start but not yet at the watched threshold). Sorted by `updatedAt`
 * desc. Hidden when empty.
 */

import { useMemo } from "react";
import type { DriveFile, PlaybackPosition } from "@shared/types";
import { isInProgress } from "../services/storage";
import { PosterCard } from "./PosterCard";
import "./ContinueWatchingRow.scss";

interface Props {
  videos: DriveFile[];
  folderId?: string;
  positions: Record<string, PlaybackPosition>;
  /** Folder-level poster URL — used as fallback art when a file has no
   *  Drive frame thumbnail. Applies to every card when the row is scoped
   *  to a single library (LibraryPage). */
  seriesPosterUrl?: string;
  /** Per-folder poster URLs — used by the lobby row, which mixes items
   *  from many libraries. Each card looks up its own folder. */
  postersByFolder?: Record<string, string | undefined>;
}

export function ContinueWatchingRow({
  videos,
  folderId,
  positions,
  seriesPosterUrl,
  postersByFolder,
}: Props) {
  const items = useMemo(() => {
    return videos
      .map((v) => ({ file: v, pos: positions[v.id] }))
      .filter(
        (item): item is { file: DriveFile; pos: PlaybackPosition } =>
          isInProgress(item.pos),
      )
      .sort((a, b) => (b.pos.updatedAt ?? 0) - (a.pos.updatedAt ?? 0));
  }, [videos, positions]);

  if (items.length === 0) return null;

  return (
    <section className="ny-continue">
      <h3 className="ny-continue__heading">Continue Watching</h3>
      <div className="ny-continue__scroll">
        {items.map(({ file, pos }) => {
          const cardFolderId = folderId ?? pos.folderId;
          const poster =
            (cardFolderId ? postersByFolder?.[cardFolderId] : undefined) ??
            seriesPosterUrl;
          return (
            <PosterCard
              key={file.id}
              file={file}
              folderId={cardFolderId}
              variant="backdrop"
              seriesPosterUrl={poster}
              playbackPosition={{
                positionSeconds: pos.positionSeconds,
                durationSeconds: pos.durationSeconds,
              }}
            />
          );
        })}
      </div>
    </section>
  );
}
