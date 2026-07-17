/**
 * Renders a sanitized `PostBlock[]` tree to React. Zero BlockNote imports —
 * a reader must never pay the ~0.5 MB editor bundle just to open a post.
 *
 * Handles exactly the block types the editor schema can produce
 * (`post-editor-schema.ts`): paragraph, heading, quote, the three list
 * types, codeBlock, driveImage, callout, spoiler, rating, linkCard.
 * Anything else falls through to `UnsupportedBlock` — either genuinely
 * unknown (already downgraded by `sanitizePostDoc`) or a type the
 * sanitizer whitelists ahead of the editor/renderer supporting it.
 *
 * List rendering groups consecutive same-type list-item blocks into one
 * `<ul>`/`<ol>` — BlockNote's document represents each item as a sibling
 * block, not pre-nested under a list wrapper, so the grouping has to
 * happen here to get correct HTML list semantics (numbering, bullet
 * styling) instead of one `<ul>` per item.
 */

import type { PostBlock, PostBlockType } from "@shared/post-types";
import { InlineContentRenderer, plainTextOf } from "./InlineContentRenderer";
import { DriveImageView } from "./blocks/DriveImageView";
import { CalloutView } from "./blocks/CalloutView";
import { SpoilerView } from "./blocks/SpoilerView";
import { RatingView } from "./blocks/RatingView";
import { LinkCardView } from "./blocks/LinkCardView";
import { UnsupportedBlock } from "./blocks/UnsupportedBlock";
import { resolveColor } from "./colors";
import { fontStackFor, type PostBlockFont } from "../post-fonts";
import "./PostRenderer.scss";

const LIST_TYPES = new Set<PostBlockType>([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

type BlockFonts = Record<string, PostBlockFont> | undefined;

export function PostRenderer({
  blocks,
  blockFonts,
}: {
  blocks: PostBlock[];
  blockFonts?: Record<string, PostBlockFont>;
}) {
  return <div className="ny-post-renderer">{renderBlocks(blocks, blockFonts)}</div>;
}

function renderBlocks(blocks: PostBlock[], blockFonts: BlockFonts): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (LIST_TYPES.has(block.type)) {
      const groupType = block.type;
      const group: PostBlock[] = [];
      while (i < blocks.length && blocks[i].type === groupType) {
        group.push(blocks[i]);
        i += 1;
      }
      nodes.push(renderListGroup(groupType, group, blockFonts));
      continue;
    }
    nodes.push(<BlockNode key={block.id} block={block} blockFonts={blockFonts} />);
    i += 1;
  }
  return nodes;
}

function renderListGroup(
  type: PostBlockType,
  group: PostBlock[],
  blockFonts: BlockFonts,
): React.ReactNode {
  const items = group.map((block) => (
    <li key={block.id} style={textStyle(block, blockFonts)}>
      {type === "checkListItem" && (
        <input type="checkbox" checked={block.props.checked === true} readOnly />
      )}
      <InlineContentRenderer content={block.content} />
      {block.children && block.children.length > 0 && (
        <div className="ny-post-renderer__nested">{renderBlocks(block.children, blockFonts)}</div>
      )}
    </li>
  ));

  if (type === "numberedListItem") {
    const start = typeof group[0].props.start === "number" ? group[0].props.start : undefined;
    return (
      <ol key={group[0].id} start={start}>
        {items}
      </ol>
    );
  }
  return (
    <ul
      key={group[0].id}
      className={type === "checkListItem" ? "ny-post-renderer__checklist" : undefined}
    >
      {items}
    </ul>
  );
}

function BlockNode({ block, blockFonts }: { block: PostBlock; blockFonts: BlockFonts }) {
  const children =
    block.children && block.children.length > 0 ? renderBlocks(block.children, blockFonts) : null;

  switch (block.type) {
    case "paragraph":
      return (
        <>
          <p style={textStyle(block, blockFonts)}>
            <InlineContentRenderer content={block.content} />
          </p>
          {children}
        </>
      );
    case "heading": {
      const level = block.props.level === 2 || block.props.level === 3 ? block.props.level : 1;
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      return (
        <>
          <Tag id={block.id} style={textStyle(block, blockFonts)}>
            <InlineContentRenderer content={block.content} />
          </Tag>
          {children}
        </>
      );
    }
    case "quote":
      return (
        <>
          <blockquote style={textStyle(block, blockFonts)}>
            <InlineContentRenderer content={block.content} />
          </blockquote>
          {children}
        </>
      );
    case "codeBlock":
      return (
        <>
          <pre className="ny-post-renderer__code">
            <code>{plainTextOf(block.content)}</code>
          </pre>
          {children}
        </>
      );
    case "driveImage":
      return <DriveImageView block={block} />;
    case "callout":
      return <CalloutView block={block}>{children}</CalloutView>;
    case "spoiler":
      return <SpoilerView block={block}>{children}</SpoilerView>;
    case "rating":
      return (
        <>
          <RatingView block={block} />
          {children}
        </>
      );
    case "linkCard":
      return (
        <>
          <LinkCardView block={block} />
          {children}
        </>
      );
    default:
      return (
        <>
          <UnsupportedBlock />
          {children}
        </>
      );
  }
}

function textStyle(block: PostBlock, blockFonts: BlockFonts): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (typeof block.props.textAlignment === "string") {
    style.textAlign = block.props.textAlignment as React.CSSProperties["textAlign"];
  }
  if (typeof block.props.textColor === "string" && block.props.textColor !== "default") {
    style.color = resolveColor(block.props.textColor, "text");
  }
  if (
    typeof block.props.backgroundColor === "string" &&
    block.props.backgroundColor !== "default"
  ) {
    style.backgroundColor = resolveColor(block.props.backgroundColor, "background");
  }
  const font = blockFonts?.[block.id];
  if (font?.family) {
    style.fontFamily = fontStackFor(font.family);
  }
  if (font?.size) {
    style.fontSize = `${font.size}px`;
  }
  return style;
}
