/**
 * MetadataStrip — slim title header under the video. The full spec grid now
 * lives in the left "Signal" rail, so this is just the title anchor: episode
 * kicker, title, filename, and the watched-progress bar.
 */

import { Film, Layers, Tv } from "lucide-react";

interface Props {
  title: string;
  episodeLabel?: string;
  fileName: string;
  isSeries: boolean;
  progressPct: number;
  watched: boolean;
}

export function MetadataStrip({
  title,
  episodeLabel,
  fileName,
  isSeries,
  progressPct,
  watched,
}: Props) {
  return (
    <section className="watch-meta" aria-label="Now playing">
      <div className="watch-meta__head">
        <span className="watch-meta__icon" aria-hidden="true">
          {isSeries ? <Tv /> : <Film />}
        </span>
        <div className="watch-meta__headings">
          <span className="watch-meta__kicker">
            {episodeLabel ?? (isSeries ? "Episode" : "Feature")}
          </span>
          <h2 className="watch-meta__title" title={title}>
            {title || "Untitled"}
          </h2>
          <p className="watch-meta__filename" title={fileName}>
            <Layers aria-hidden="true" />
            {fileName}
          </p>
        </div>
        <div className="watch-meta__progress-block">
          <span className="watch-meta__progress-label">
            {watched
              ? "Watched"
              : progressPct > 0
                ? `${progressPct}% watched`
                : "Not started"}
          </span>
          <div className="watch-meta__progress" aria-hidden="true">
            <div
              className="watch-meta__progress-bar"
              style={{ width: `${watched ? 100 : Math.min(100, progressPct)}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
