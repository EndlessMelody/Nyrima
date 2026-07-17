import type { PostBlock } from "@shared/post-types";
import { InlineContentRenderer } from "../InlineContentRenderer";

const TONE_LABEL: Record<string, string> = {
  info: "Note",
  warning: "Warning",
  fave: "Favorite",
};

export function CalloutView({
  block,
  children,
}: {
  block: PostBlock;
  children?: React.ReactNode;
}) {
  const tone = typeof block.props.tone === "string" ? block.props.tone : "info";
  return (
    <aside className={`ny-post-callout ny-post-callout--${tone}`}>
      <span className="ny-post-callout__label">{TONE_LABEL[tone] ?? "Note"}</span>
      <div className="ny-post-callout__body">
        <InlineContentRenderer content={block.content} />
        {children}
      </div>
    </aside>
  );
}
