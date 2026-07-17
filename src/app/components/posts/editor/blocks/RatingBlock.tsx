/**
 * The `rating` custom block — a 0-10 half-step score for review posts.
 * The UI clamps to half-steps so `post-doc.ts`'s sanitizer round
 * (`Math.round(value*2)/2`) is always a no-op.
 */

import { createReactBlockSpec, type ReactCustomBlockRenderProps } from "@blocknote/react";

export const ratingBlockConfig = {
  type: "rating",
  propSchema: {
    value: { default: 0 },
    style: { default: "stars", values: ["stars", "bar"] as const },
    label: { default: "" },
  },
  content: "none",
} as const;

type StyleValue = (typeof ratingBlockConfig.propSchema.style.values)[number];

type RenderProps = ReactCustomBlockRenderProps<typeof ratingBlockConfig>;

function RatingBlockRender({ block, editor }: RenderProps) {
  function setProps(patch: Partial<typeof block.props>) {
    editor.updateBlock(block, { props: { ...block.props, ...patch } });
  }

  const value = typeof block.props.value === "number" ? block.props.value : 0;

  return (
    <div className="ny-rating-block" contentEditable={false}>
      <input
        type="text"
        className="ny-rating-block__label"
        value={block.props.label}
        placeholder="Rating label (optional)"
        onChange={(e) => setProps({ label: e.target.value })}
      />
      <div className="ny-rating-block__stars">
        {Array.from({ length: 10 }, (_, i) => {
          const starIndex = i + 1;
          return (
            <button
              key={i}
              type="button"
              className="ny-rating-block__star"
              aria-label={`${starIndex} of 10`}
              onClick={(e) => {
                const half = e.altKey || e.shiftKey;
                setProps({ value: half ? starIndex - 0.5 : starIndex });
              }}
            >
              {value >= starIndex ? "★" : value >= starIndex - 0.5 ? "⯨" : "☆"}
            </button>
          );
        })}
      </div>
      <input
        type="number"
        className="ny-rating-block__number"
        min={0}
        max={10}
        step={0.5}
        value={value}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) setProps({ value: Math.max(0, Math.min(10, parsed)) });
        }}
      />
      <select
        className="ny-rating-block__style"
        value={block.props.style}
        onChange={(e) => setProps({ style: e.target.value as StyleValue })}
      >
        <option value="stars">Stars</option>
        <option value="bar">Bar</option>
      </select>
    </div>
  );
}

export const ratingBlockSpec = createReactBlockSpec(ratingBlockConfig, {
  render: RatingBlockRender,
});
