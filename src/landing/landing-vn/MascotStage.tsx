import { Heart } from "lucide-react";
import { AffectionMeter } from "./AffectionMeter";
import { EMOTION_EFFECTS } from "./emotionEffects";
import { EMOTION_ART, type Emotion } from "./mascotArt";

/**
 * Ny-chan, the landing's host — large, lower-left, and present. Her art is a
 * bright studio portrait (the cyan/pink tech accents happen to match the
 * palette), so she stands inside a tall neon glass frame rather than as a raw
 * cut-out: a soft inner scrim melts the portrait's edges into the night scene,
 * an aura glows behind her, and corner accents bracket the frame.
 *
 * Idle motion: a gentle breathing float on the whole frame, a slow sway, and a
 * pulsing aura. The expression crossfades whenever the active section/subsection
 * changes; `speaking` lifts the glow a touch while a line is typing. Each
 * emotion also gets a short presentation `motion` (bounce, shake, …) on the
 * portrait and an optional `fx` overlay (sparkles, blush, tears, …) — see
 * `emotionEffects.ts` and `.lvn-mascot[data-motion]` / `.lvn-mascot__fx` in
 * landing-vn.scss.
 *
 * The frame itself is decorative (each visual layer is `aria-hidden`), but a
 * transparent `.lvn-mascot__hit` button covers it so visitors can poke her —
 * `pointer-events: auto` opts back in over the otherwise click-through
 * `.lvn-mascot`. The affection meter renders alongside the name badge.
 */
export function MascotStage({
  emotion = "neutral",
  speaking = false,
  affectionPoints,
  onPoke,
}: {
  emotion?: Emotion;
  speaking?: boolean;
  affectionPoints: number;
  onPoke: () => void;
}) {
  const effect = EMOTION_EFFECTS[emotion];
  return (
    <div
      className={`lvn-mascot${speaking ? " is-speaking" : ""}`}
      data-emotion={emotion}
      data-motion={effect.motion}
    >
      <div className="lvn-mascot__aura" aria-hidden="true" />
      <div className="lvn-mascot__frame" aria-hidden="true">
        <img
          key={emotion}
          className="lvn-mascot__art"
          src={EMOTION_ART[emotion]}
          alt=""
          draggable={false}
        />
        <span className="lvn-mascot__scrim" />
        <span className="lvn-mascot__corner lvn-mascot__corner--tl" />
        <span className="lvn-mascot__corner lvn-mascot__corner--tr" />
        <span className="lvn-mascot__corner lvn-mascot__corner--bl" />
        <span className="lvn-mascot__corner lvn-mascot__corner--br" />
      </div>
      <div className="lvn-mascot__fx" data-fx={effect.fx} aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <button
        type="button"
        className="lvn-mascot__hit"
        aria-label="Poke Ny-chan"
        onClick={(event) => {
          event.stopPropagation();
          onPoke();
        }}
      />
      <span className="lvn-mascot__badge" aria-hidden="true">
        <Heart size={13} fill="currentColor" />
        <span>Ny-chan</span>
      </span>
      <AffectionMeter key={affectionPoints} points={affectionPoints} />
    </div>
  );
}
