/**
 * ContinueWatchingRow — horizontal scroll of backdrop poster cards.
 *
 * Renders files whose stored playback position is in-progress (a few seconds
 * past the start but not yet at the watched threshold). Sorted by `updatedAt`
 * desc. Hidden when empty.
 */

import { useMemo } from "react";
import type { DriveFile, MovieMetadata, PlaybackPosition } from "@shared/types";
import { isInProgress } from "../services/storage";
import { PosterCard } from "./PosterCard";
import "./ContinueWatchingRow.scss";

interface Props {
  videos: DriveFile[];
  folderId?: string;
  positions: Record<string, PlaybackPosition>;
  /** Optional bulk-resolved metadata keyed by fileId. */
  metaByFileId?: Record<string, MovieMetadata>;
}

export function ContinueWatchingRow({
  videos,
  folderId,
  positions,
  metaByFileId,
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
        {items.map(({ file, pos }) => (
          <PosterCard
            key={file.id}
            file={file}
            folderId={folderId ?? pos.folderId}
            variant="backdrop"
            meta={metaByFileId?.[file.id]}
            playbackPosition={{
              positionSeconds: pos.positionSeconds,
              durationSeconds: pos.durationSeconds,
            }}
          />
        ))}
      </div>
    </section>
  );
}
