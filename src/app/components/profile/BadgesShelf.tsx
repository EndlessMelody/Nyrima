/**
 * BadgesShelf — earned-badge grid from the static `badge_defs` catalog +
 * the user's `user_badges` rows. Locked badges render dimmed, not hidden,
 * so a visitor can see what's achievable.
 */

import type { BadgeDef, UserBadge } from "../../services/social/social-api";
import "./BadgesShelf.scss";

interface Props {
  defs: BadgeDef[];
  earned: UserBadge[];
}

export function BadgesShelf({ defs, earned }: Props) {
  if (defs.length === 0) return null;
  const earnedIds = new Set(earned.map((b) => b.badgeId));

  return (
    <section className="ny-badges" aria-label="Badges">
      <span className="ny-badges__title">Badges</span>
      <div className="ny-badges__grid">
        {defs.map((def) => {
          const hasEarned = earnedIds.has(def.id);
          return (
            <div
              key={def.id}
              className={`ny-badges__badge${hasEarned ? " is-earned" : " is-locked"}`}
              title={def.description}
            >
              <span className={`ny-badges__tier ny-badges__tier--${def.tier ?? "bronze"}`} />
              <span className="ny-badges__label">{def.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
