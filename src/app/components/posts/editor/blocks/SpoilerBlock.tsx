/**
 * The `spoiler` custom block. `content: "none"` — the collapsible body is
 * carried by `children` (BlockNote's native Tab-indent nesting), matching
 * `post-doc.ts`'s sanitizer and `derivePostExcerpt`'s "skip spoiler
 * children" rule exactly.
 */

import { createReactBlockSpec, type ReactCustomBlockRenderProps } from "@blocknote/react";

export const spoilerBlockConfig = {
  type: "spoiler",
  propSchema: {
    label: { default: "" },
  },
  content: "none",
} as const;

type RenderProps = ReactCustomBlockRenderProps<typeof spoilerBlockConfig>;

function SpoilerBlockRender({ block, editor }: RenderProps) {
  function setLabel(label: string) {
    editor.updateBlock(block, { props: { ...block.props, label } });
  }

  return (
    <div className="ny-spoiler-block" contentEditable={false}>
      <input
        type="text"
        className="ny-spoiler-block__label"
        value={block.props.label}
        placeholder="Spoiler"
        onChange={(e) => setLabel(e.target.value)}
      />
      <span className="ny-spoiler-block__hint">
        Tab-indent the blocks below to hide them behind this spoiler.
      </span>
    </div>
  );
}

export const spoilerBlockSpec = createReactBlockSpec(spoilerBlockConfig, {
  render: SpoilerBlockRender,
});
