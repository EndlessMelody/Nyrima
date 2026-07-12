/**
 * The editor's BlockNote schema — deliberately a strict subset of
 * BlockNote's defaults, plus the `driveImage` custom block.
 *
 * This must stay in lockstep with `post-doc.ts`'s `BLOCK_SPECS` whitelist
 * (src/app/services/posts/post-doc.ts): any block type or prop the editor
 * can produce that the sanitizer doesn't recognise gets silently
 * downgraded to an `unsupported` stub on the very next save/reload. Two
 * built-ins needed extra configuration to line up exactly:
 *
 *   - `heading`: BlockNote's default allows levels 1–6 plus an
 *     `isToggleable` prop. The sanitizer only whitelists levels 1–3 and no
 *     toggle prop, so this schema constrains the block spec to match
 *     instead of letting the editor produce documents that lose data on
 *     reload.
 *   - `table`, `image`, `video`, `audio`, `file`, `divider`,
 *     `toggleListItem`: not in the sanitizer's whitelist at all (table's
 *     content shape doesn't fit the flat-props model yet; the media types
 *     are superseded by Drive-aware custom blocks) — simply omitted here.
 */

import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
} from "@blocknote/core";
import { driveImageBlockSpec } from "./blocks/DriveImageBlock";

export const postEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: createHeadingBlockSpec({
      levels: [1, 2, 3],
      allowToggleHeadings: false,
    }),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    driveImage: driveImageBlockSpec(),
  },
});

export type PostEditorSchema = typeof postEditorSchema;
