/**
 * Maps BlockNote's theme object to Nyrima's CSS custom properties.
 *
 * BlockNote (via `@blocknote/mantine`) themes itself through a `Theme`
 * object rather than CSS variable overrides in a stylesheet — passing one
 * `<BlockNoteView theme={...}>` writes each value onto the editor's DOM
 * node as a `--bn-*` custom property (see
 * `@blocknote/mantine/src/BlockNoteTheme.ts`). Values below are `var(...)`
 * references into Nyrima's own tokens, so the editor re-themes for free
 * whenever `anime-theme.scss` flips light/dark — one static object covers
 * both, no separate light/dark `Theme` needed.
 */

import type { Theme } from "@blocknote/mantine";

export const nyrimaBlockNoteTheme: Theme = {
  colors: {
    editor: {
      text: "var(--neutral-on-background-strong)",
      background: "var(--page-background)",
    },
    menu: {
      text: "var(--neutral-on-background-strong)",
      background: "var(--page-background)",
    },
    tooltip: {
      text: "var(--neutral-on-background-strong)",
      background: "var(--neutral-alpha-weak)",
    },
    hovered: {
      text: "var(--neutral-on-background-strong)",
      background: "var(--neutral-alpha-weak)",
    },
    selected: {
      text: "var(--page-background)",
      background: "var(--neutral-on-background-strong)",
    },
    disabled: {
      text: "var(--neutral-on-background-weak)",
      background: "var(--neutral-alpha-weak)",
    },
    shadow: "var(--neutral-alpha-weak)",
    border: "var(--neutral-alpha-weak)",
    sideMenu: "var(--neutral-on-background-weak)",
  },
  borderRadius: 8,
  fontFamily: "var(--dc-font-body)",
};
