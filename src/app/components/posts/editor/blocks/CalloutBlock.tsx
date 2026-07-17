/**
 * The `callout` custom block. Props mirror `post-doc.ts`'s sanitizer
 * whitelist for this type exactly — `tone` only. No alignment/color props
 * here: the sanitizer would strip them on the next save/reload, so the
 * editor must not offer controls that produce them.
 */

import { createReactBlockSpec, type ReactCustomBlockRenderProps } from "@blocknote/react";

export const calloutBlockConfig = {
  type: "callout",
  propSchema: {
    tone: { default: "info", values: ["info", "warning", "fave"] as const },
  },
  content: "inline",
} as const;

type ToneValue = (typeof calloutBlockConfig.propSchema.tone.values)[number];

const TONE_LABEL: Record<ToneValue, string> = {
  info: "Note",
  warning: "Warning",
  fave: "Favorite",
};

type RenderProps = ReactCustomBlockRenderProps<typeof calloutBlockConfig>;

function CalloutBlockRender({ block, editor, contentRef }: RenderProps) {
  function setTone(tone: ToneValue) {
    editor.updateBlock(block, { props: { ...block.props, tone } });
  }

  return (
    <div className={`ny-callout-block ny-callout-block--${block.props.tone}`}>
      <select
        className="ny-callout-block__tone"
        contentEditable={false}
        value={block.props.tone}
        onChange={(e) => setTone(e.target.value as ToneValue)}
      >
        {Object.entries(TONE_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <div className="ny-callout-block__content" ref={contentRef} />
    </div>
  );
}

export const calloutBlockSpec = createReactBlockSpec(calloutBlockConfig, {
  render: CalloutBlockRender,
});
