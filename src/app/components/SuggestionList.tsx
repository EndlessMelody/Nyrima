/**
 * SuggestionList — "You might like" row of PosterCards.
 *
 * Random sample, excluding the current/featured one. Re-shuffles only when
 * the pool itself or the exclusion changes.
 */

import { useMemo } from "react";
import type { DriveFile } from "@shared/types";
import { pickSeeded } from "../utils/shuffle";
import { PosterCard } from "./PosterCard";
import "./SuggestionList.scss";

interface Props {
  videos: DriveFile[];
  excludeFileId?: string;
  folderId?: string;
  /** Parent-folder display name. Required so each card's title resolves to
   *  "Series - EpNN" via the parser instead of MAL guessing at the bare
   *  episode number — without this, `[GS]07.mkv` shows up as "07-Ghost". */
  folderName?: string;
  /** Series poster — same series as all suggestions, so feeding it through
   *  saves a Jikan call per card. */
  seriesPosterUrl?: string;
}

export function SuggestionList({
  videos,
  excludeFileId,
  folderId,
  folderName,
  seriesPosterUrl,
}: Props) {
  // Deterministic top-6: same folderId + same video set always picks the
  // same 6 episodes. Without a seeded pick the row re-shuffled on every
  // library refresh, which is jarring after the user has visually anchored
  // on a thumbnail.
  const picks = useMemo(() => {
    const pool = videos.filter((v) => v.id !== excludeFileId);
    return pickSeeded(pool, 6, folderId ?? "suggestions", (v) => v.id);
  }, [videos, excludeFileId, folderId]);

  if (picks.length === 0) return null;

  return (
    <section className="ny-suggestions">
      <h3 className="ny-suggestions__heading">You might like</h3>
      <div className="ny-suggestions__grid ny-poster-grid">
        {picks.map((v) => (
          <PosterCard
            key={v.id}
            file={v}
            folderId={folderId}
            folderName={folderName}
            seriesPosterUrl={seriesPosterUrl}
          />
        ))}
      </div>
    </section>
  );
}
