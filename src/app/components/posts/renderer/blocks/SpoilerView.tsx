import type { PostBlock } from "@shared/post-types";

export function SpoilerView({
  block,
  children,
}: {
  block: PostBlock;
  children?: React.ReactNode;
}) {
  const label = typeof block.props.label === "string" && block.props.label ? block.props.label : "Spoiler";
  return (
    <details className="ny-post-spoiler">
      <summary>{label}</summary>
      <div className="ny-post-spoiler__body">{children}</div>
    </details>
  );
}
