/**
 * SuggestionList — "You might like" row of PosterCards.
 *
 * Random sample, excluding the current/featured one. Re-shuffles only when
 * the pool itself or the exclusion changes.
 */

import { useMemo } from "react";
import type { DriveFile } from "@shared/types";
import { shuffle } from "../utils/shuffle";
import { PosterCard } from "./PosterCard";
import "./SuggestionList.scss";

interface Props {
  videos: DriveFile[];
  excludeFileId?: string;
  folderId?: string;
}

export function SuggestionList({ videos, excludeFileId, folderId }: Props) {
  const picks = useMemo(() => {
    const pool = videos.filter((v) => v.id !== excludeFileId);
    return shuffle(pool).slice(0, 6);
  }, [videos, excludeFileId]);

  if (picks.length === 0) return null;

  return (
    <section className="ny-suggestions">
      <h3 className="ny-suggestions__heading">You might like</h3>
      <div className="ny-suggestions__grid ny-poster-grid">
        {picks.map((v) => (
          <PosterCard key={v.id} file={v} folderId={folderId} />
        ))}
      </div>
    </section>
  );
}
