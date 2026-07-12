/**
 * LibraryHeroHeader — premium, compact 2-row header.
 *
 *   Row 1 →  [icon] All Library  ·  «Nyrima Library» pink pill
 *   Row 2 →  subtitle slogan      ·  «N items» cyan pill
 *
 * The title carries a slow pastel pink → cyan → lavender gradient pan with a
 * soft text glow (no large blur blob). Pills add the hierarchy that plain
 * right-aligned labels used to carry, and everything wraps gracefully on narrow
 * widths (title row first, subtitle row below, pills wrap).
 */

import { type ReactNode } from "react";
import { LibraryBig } from "lucide-react";

export function LibraryHeroHeader({
  totalLabel,
  title = "All Library",
  brandLabel = "Nyrima Library",
  subtitle = "Your unified collection across anime, manga, light novels, and music.",
  icon = <LibraryBig />,
}: {
  /** Real "N items" string, or a state label when nothing is indexed. */
  totalLabel: string;
  title?: string;
  brandLabel?: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  return (
    <header className="lib-hero">
      <div className="lib-hero__row lib-hero__row--title">
        <span className="lib-hero__icon" aria-hidden="true">
          {icon}
        </span>
        <h1 className="lib-hero__title">{title}</h1>
        <span className="lib-pill lib-pill--brand">{brandLabel}</span>
      </div>
      <div className="lib-hero__row lib-hero__row--sub">
        <p className="lib-hero__subtitle">{subtitle}</p>
        <span className="lib-pill lib-pill--accent">{totalLabel}</span>
      </div>
    </header>
  );
}
