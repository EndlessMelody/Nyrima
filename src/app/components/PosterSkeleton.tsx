/**
 * PosterSkeleton — shimmer placeholder for poster cards.
 *
 * Composes the global `.ny-poster-grid` ladder so the skeleton tile count
 * always matches the live PosterCard grid below it.
 */

import "./PosterSkeleton.scss";

interface Props {
  count?: number;
}

export function PosterSkeleton({ count = 5 }: Props) {
  return (
    <div className="ny-poster-skeleton ny-poster-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ny-poster-skeleton__item">
          <div className="ny-poster-skeleton__frame ny-shimmer" />
          <div className="ny-poster-skeleton__text ny-shimmer" />
        </div>
      ))}
    </div>
  );
}
