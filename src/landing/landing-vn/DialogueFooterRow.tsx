import { ContinueHintInline } from "./ContinueHintInline";

/**
 * The dialogue box footer row, pinned to the bottom of the fixed-height box:
 *   left  — the progress dots (which scene page you're on)
 *   right — the always-visible continue hint
 *
 * It is part of the box itself, so the hint reads as a permanent part of the
 * dialogue, never floating outside it. The dots are decorative (the live text
 * lives in the box body); the hint is always rendered so it can never vanish.
 */
export function DialogueFooterRow({
  lineIndex,
  lineCount,
}: {
  lineIndex: number;
  lineCount: number;
}) {
  return (
    <div className="lvn-dialogue__footer">
      <div className="lvn-dialogue__dots" aria-hidden="true">
        {Array.from({ length: Math.max(lineCount, 1) }).map((_, i) => (
          <span key={i} className={i <= lineIndex ? "is-on" : undefined} />
        ))}
      </div>
      <ContinueHintInline />
    </div>
  );
}
