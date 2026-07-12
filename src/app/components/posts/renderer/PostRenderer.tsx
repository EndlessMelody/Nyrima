/**
 * Renders a sanitized `PostBlock[]` tree to React. Zero BlockNote imports —
 * a reader must never pay the ~0.5 MB editor bundle just to open a post.
 *
 * Handles exactly the block types v1's editor schema can produce
 * (`post-editor-schema.ts`): paragraph, heading, quote, the three list
 * types, codeBlock, driveImage. Anything else falls through to
 * `UnsupportedBlock` — either genuinely unknown (already downgraded by
 * `sanitizePostDoc`) or a type the sanitizer whitelists ahead of the
 * editor/renderer supporting it (v2 blocks).
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
import { UnsupportedBlock } from "./blocks/UnsupportedBlock";
import { resolveColor } from "./colors";
import "./PostRenderer.scss";

const LIST_TYPES = new Set<PostBlockType>([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

export function PostRenderer({ blocks }: { blocks: PostBlock[] }) {
  return <div className="ny-post-renderer">{renderBlocks(blocks)}</div>;
}

function renderBlocks(blocks: PostBlock[]): React.ReactNode {
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
      nodes.push(renderListGroup(groupType, group));
      continue;
    }
    nodes.push(<BlockNode key={block.id} block={block} />);
    i += 1;
  }
  return nodes;
}

function renderListGroup(type: PostBlockType, group: PostBlock[]): React.ReactNode {
  const items = group.map((block) => (
    <li key={block.id} style={textStyle(block)}>
      {type === "checkListItem" && (
        <input type="checkbox" checked={block.props.checked === true} readOnly />
      )}
      <InlineContentRenderer content={block.content} />
      {block.children && block.children.length > 0 && (
        <div className="ny-post-renderer__nested">{renderBlocks(block.children)}</div>
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

function BlockNode({ block }: { block: PostBlock }) {
  const children =
    block.children && block.children.length > 0 ? renderBlocks(block.children) : null;

  switch (block.type) {
    case "paragraph":
      return (
        <>
          <p style={textStyle(block)}>
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
          <Tag style={textStyle(block)}>
            <InlineContentRenderer content={block.content} />
          </Tag>
          {children}
        </>
      );
    }
    case "quote":
      return (
        <>
          <blockquote style={textStyle(block)}>
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
    default:
      return (
        <>
          <UnsupportedBlock />
          {children}
        </>
      );
  }
}

function textStyle(block: PostBlock): React.CSSProperties {
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
  return style;
}
