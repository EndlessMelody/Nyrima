/**
 * Slash-menu items for Nyrima's custom blocks. BlockNote's default slash
 * menu only covers schema built-ins — `driveImage`, `linkCard`, `callout`,
 * `spoiler`, and `rating` have no default entry, so authors would have no
 * way to insert them without this. Combined with the schema's default
 * items (`getDefaultReactSlashMenuItems`) so `/` still finds
 * paragraph/heading/lists/etc.
 */

import { Image, Link2, MessageSquareText, EyeOff, Star } from "lucide-react";
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import type { BlockNoteEditor, BlockSchema, InlineContentSchema, StyleSchema } from "@blocknote/core";

export function getCustomSlashMenuItems<
  B extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
>(editor: BlockNoteEditor<B, I, S>): DefaultReactSuggestionItem[] {
  return [
    ...getDefaultReactSlashMenuItems(editor),
    {
      title: "Image",
      subtext: "Upload or pick from Drive",
      aliases: ["image", "picture", "photo", "drive"],
      group: "Nyrima",
      icon: <Image size={18} />,
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, { type: "driveImage" } as never),
    },
    {
      title: "Link card",
      subtext: "Paste a URL with an auto-fetched preview",
      aliases: ["link", "url", "bookmark"],
      group: "Nyrima",
      icon: <Link2 size={18} />,
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, { type: "linkCard" } as never),
    },
    {
      title: "Callout",
      subtext: "Highlighted note, warning, or favorite",
      aliases: ["callout", "note", "warning", "tip"],
      group: "Nyrima",
      icon: <MessageSquareText size={18} />,
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, { type: "callout" } as never),
    },
    {
      title: "Spoiler",
      subtext: "Click-to-reveal block",
      aliases: ["spoiler", "hide", "collapse", "reveal"],
      group: "Nyrima",
      icon: <EyeOff size={18} />,
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, { type: "spoiler" } as never),
    },
    {
      title: "Rating",
      subtext: "0-10 score for reviews",
      aliases: ["rating", "score", "stars", "review"],
      group: "Nyrima",
      icon: <Star size={18} />,
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, { type: "rating" } as never),
    },
  ];
}
