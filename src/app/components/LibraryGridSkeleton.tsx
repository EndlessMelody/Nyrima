/**
 * LibraryGridSkeleton — shimmer placeholder grid for the library hub pages.
 *
 * Used both as the data-loading state for `AllLibraryPage` and as the
 * `<Suspense>` fallback for the lazy library routes in `App.tsx`, so a
 * chunk-load followed by a data-load reads as one continuous surface instead
 * of spinner -> blank -> grid. Deliberately lightweight (no library-hub
 * imports) so the eagerly-loaded route tree doesn't pull in the library-hub
 * bundle just to render a placeholder.
 */

import "./LibraryGridSkeleton.scss";

interface Props {
  count?: number;
}

export function LibraryGridSkeleton({ count = 10 }: Props) {
  return (
    <div className="ny-lib-skeleton" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ny-lib-skeleton__item">
          <div className="ny-lib-skeleton__cover ny-shimmer" />
          <div className="ny-lib-skeleton__title ny-shimmer" />
          <div className="ny-lib-skeleton__meta ny-shimmer" />
        </div>
      ))}
    </div>
  );
}
