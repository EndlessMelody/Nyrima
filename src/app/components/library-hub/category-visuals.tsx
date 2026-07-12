/**
 * Per-category visual helpers — a glyph + badge label shared by every card so
 * Movies / Manga / Light Novel / Music read consistently. Accent colors are
 * driven from SCSS via a `data-cat` attribute on the card root, keeping color
 * logic in one place (see AllLibraryPage.scss `--cat-*`).
 */

import { Clapperboard, BookOpen, BookText, Music2 } from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { LibraryCategoryKey } from "./types";
import { CATEGORY_META } from "./types";

export function CategoryIcon({
  type,
  ...rest
}: { type: LibraryCategoryKey } & LucideProps) {
  switch (type) {
    case "movies":
    case "anime":
      return <Clapperboard aria-hidden="true" {...rest} />;
    case "manga":
      return <BookOpen aria-hidden="true" {...rest} />;
    case "light-novel":
      return <BookText aria-hidden="true" {...rest} />;
    case "music":
      return <Music2 aria-hidden="true" {...rest} />;
  }
}

export function categoryBadge(type: LibraryCategoryKey): string {
  return CATEGORY_META[type].badge;
}

export function categoryName(type: LibraryCategoryKey): string {
  return CATEGORY_META[type].name;
}
