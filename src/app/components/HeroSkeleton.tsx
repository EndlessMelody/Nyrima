/**
 * HeroSkeleton — shimmer placeholder for the lobby hero.
 *
 * Frame border + radius match LobbyHero exactly so the swap from skeleton
 * to real hero doesn't cause a 1px layout shift.
 */

import "./HeroSkeleton.scss";

export function HeroSkeleton() {
  return (
    <div className="ny-hero-skeleton">
      <div className="ny-hero-skeleton__backdrop ny-shimmer" />
      <div className="ny-hero-skeleton__content">
        <div className="ny-hero-skeleton__eyebrow ny-shimmer--ink" />
        <div className="ny-hero-skeleton__title ny-shimmer--ink" />
        <div className="ny-hero-skeleton__meta ny-shimmer--ink" />
        <div className="ny-hero-skeleton__actions ny-shimmer--ink" />
      </div>
    </div>
  );
}
