/**
 * Renders sanitized `PostInline[]` runs to React elements — the only place
 * inline text formatting turns into DOM. Never uses
 * `dangerouslySetInnerHTML`; every run is a typed, whitelisted shape
 * already validated by `post-doc.ts`'s sanitizer, so this is plain
 * component composition, not HTML parsing.
 */

import type { PostInline, PostStyledText } from "@shared/post-types";
import { resolveColor } from "./colors";

export function InlineContentRenderer({ content }: { content?: PostInline[] }) {
  if (!content || content.length === 0) return null;
  return (
    <>
      {content.map((run, i) => (
        <InlineRun key={i} run={run} />
      ))}
    </>
  );
}

function InlineRun({ run }: { run: PostInline }) {
  if (run.type === "link") {
    return (
      <a href={run.href} target="_blank" rel="noopener noreferrer">
        {run.content.map((t, i) => (
          <StyledText key={i} run={t} />
        ))}
      </a>
    );
  }
  return <StyledText run={run} />;
}

function StyledText({ run }: { run: PostStyledText }) {
  let node: React.ReactNode = run.text;
  if (run.styles.code) node = <code>{node}</code>;
  if (run.styles.bold) node = <strong>{node}</strong>;
  if (run.styles.italic) node = <em>{node}</em>;
  if (run.styles.underline) node = <u>{node}</u>;
  if (run.styles.strike) node = <s>{node}</s>;

  const style: React.CSSProperties = {};
  if (run.styles.textColor) style.color = resolveColor(run.styles.textColor, "text");
  if (run.styles.backgroundColor) {
    style.backgroundColor = resolveColor(run.styles.backgroundColor, "background");
  }
  if (Object.keys(style).length > 0) node = <span style={style}>{node}</span>;

  return <>{node}</>;
}

/** Plain-text projection of inline content, for contexts that can't render
 *  styled runs (code blocks, `<img alt>`, etc). */
export function plainTextOf(content: PostInline[] | undefined): string {
  if (!content) return "";
  return content
    .map((run) =>
      run.type === "text" ? run.text : run.content.map((t) => t.text).join(""),
    )
    .join("");
}
