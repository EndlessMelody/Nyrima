import type { PostBlock } from "@shared/post-types";

export function RatingView({ block }: { block: PostBlock }) {
  const value = typeof block.props.value === "number" ? block.props.value : 0;
  const style = block.props.style === "bar" ? "bar" : "stars";
  const label = typeof block.props.label === "string" ? block.props.label : "";

  return (
    <div className="ny-post-rating">
      {label && <span className="ny-post-rating__label">{label}</span>}
      {style === "stars" ? (
        <span className="ny-post-rating__stars" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <Star key={i} id={`ny-star-${block.id}-${i}`} fill={clamp01(value - i)} />
          ))}
        </span>
      ) : (
        <span className="ny-post-rating__bar">
          <span className="ny-post-rating__bar-fill" style={{ width: `${(value / 10) * 100}%` }} />
        </span>
      )}
      <span className="ny-post-rating__value">{value.toFixed(1)} / 10</span>
    </div>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function Star({ id, fill }: { id: string; fill: number }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24">
      <defs>
        <linearGradient id={id}>
          <stop offset={`${fill * 100}%`} stopColor="currentColor" />
          <stop offset={`${fill * 100}%`} stopColor="transparent" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.5l2.9 6.4 6.9.7-5.2 4.7 1.5 6.9L12 17.6l-6.1 3.6 1.5-6.9-5.2-4.7 6.9-.7z"
        fill={`url(#${id})`}
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.4"
      />
    </svg>
  );
}
