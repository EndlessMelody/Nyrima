import { Heart } from "lucide-react";
import { AFFECTION_CAP, AFFECTION_PIP_COUNT } from "./affection";

/**
 * A small heart-pip gauge next to Ny-chan's badge, showing how many points of
 * affection have built up from poking/choices/etc (out of `AFFECTION_CAP`).
 *
 * Purely decorative feedback (`role="img"`, `pointer-events: none`) — the
 * parent remounts it with `key={points}` on a gain so the CSS pulse
 * (`lvn-affection-pulse`) replays.
 */
export function AffectionMeter({ points }: { points: number }) {
  const pointsPerPip = AFFECTION_CAP / AFFECTION_PIP_COUNT;
  const filled = Math.min(AFFECTION_PIP_COUNT, Math.floor(points / pointsPerPip));

  return (
    <div
      className="lvn-affection"
      role="img"
      aria-label={`Affection: ${points} of ${AFFECTION_CAP}`}
    >
      {Array.from({ length: AFFECTION_PIP_COUNT }, (_, index) => (
        <Heart
          key={index}
          className={`lvn-affection__pip${index < filled ? " is-filled" : ""}`}
          size={11}
          fill={index < filled ? "currentColor" : "none"}
        />
      ))}
    </div>
  );
}
