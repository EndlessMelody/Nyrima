import type { IconItem } from "./landingSections";

/**
 * A grid of icon cards. Reused for the feature list ("Show me the features") and
 * for the numbered "How do I use it?" mini-guide — the latter passes
 * `numbered`, which prints a step index in the corner of each card.
 */
export function FeatureCardGrid({
  items,
  numbered = false,
}: {
  items: IconItem[];
  numbered?: boolean;
}) {
  return (
    <ul className={`lvn-cards${numbered ? " lvn-cards--steps" : ""}`}>
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <li key={item.title} className="lvn-card" style={{ "--d": `${i * 55}ms` } as React.CSSProperties}>
            {numbered ? <span className="lvn-card__step">{i + 1}</span> : null}
            <span className="lvn-card__icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className="lvn-card__title">{item.title}</span>
            <span className="lvn-card__body">{item.body}</span>
          </li>
        );
      })}
    </ul>
  );
}
