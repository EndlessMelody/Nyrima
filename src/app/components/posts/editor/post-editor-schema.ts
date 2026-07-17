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
  type Block,
  type BlockNoteEditor,
} from "@blocknote/core";
import { driveImageBlockSpec } from "./blocks/DriveImageBlock";
import { linkCardBlockSpec } from "./blocks/LinkCardBlock";
import { calloutBlockSpec } from "./blocks/CalloutBlock";
import { spoilerBlockSpec } from "./blocks/SpoilerBlock";
import { ratingBlockSpec } from "./blocks/RatingBlock";

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
    linkCard: linkCardBlockSpec(),
    callout: calloutBlockSpec(),
    spoiler: spoilerBlockSpec(),
    rating: ratingBlockSpec(),
  },
});

export type PostEditorSchema = typeof postEditorSchema;

/** Concrete editor type for `postEditorSchema` — every workspace component
 *  that touches the editor instance (top bar, inspector, slash menu) shares
 *  this instead of re-deriving generics or falling back to `any`. */
export type PostEditor = PostEditorSchema extends BlockNoteSchema<infer B, infer I, infer S>
  ? BlockNoteEditor<B, I, S>
  : never;

/** Concrete block type for `postEditorSchema` — replaces `Block<any, any,
 *  any>` in the inspector/selection code below. */
export type PostEditorBlock = PostEditorSchema extends BlockNoteSchema<infer B, infer I, infer S>
  ? Block<B, I, S>
  : never;
