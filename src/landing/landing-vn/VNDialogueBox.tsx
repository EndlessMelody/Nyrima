import { DialogueFooterRow } from "./DialogueFooterRow";

/**
 * The fixed dialogue box — the stable anchor of the scene. Its size and position
 * never change: a constant width/height across every chapter and subsection, so
 * the VN stage never jumps. Text is clamped to three lines (scene dialogue is
 * written short on purpose; long content lives in the information panel).
 *
 * Layout is a fixed-height column: the name plate overhangs the top, the reading
 * area centres the line, and the footer row (progress dots + the always-visible
 * continue hint) is pinned to the bottom.
 *
 * Presentational only: the stage runs the typewriter and feeds `shown`; the full
 * line is mirrored into a polite live region for screen readers, so the
 * typewriter is never the only path to the text.
 */
export function VNDialogueBox({
  shown,
  fullText,
  complete,
  lineIndex,
  lineCount,
}: {
  shown: string;
  fullText: string;
  complete: boolean;
  lineIndex: number;
  lineCount: number;
}) {
  return (
    <div className="lvn-dialogue">
      <div className="lvn-dialogue__scan" aria-hidden="true" />
      <div className="lvn-dialogue__plate">
        <span className="lvn-dialogue__star" aria-hidden="true">
          ✦
        </span>
        <span className="lvn-dialogue__role">Guide</span>
        <span className="lvn-dialogue__sep" aria-hidden="true" />
        <span className="lvn-dialogue__name">Ny-chan</span>
      </div>

      <div className="lvn-dialogue__body">
        <p className="lvn-dialogue__text">
          <span aria-hidden="true">
            {shown}
            {!complete ? <span className="lvn-dialogue__cursor" /> : null}
          </span>
          <span className="lvn-sr-only" aria-live="polite">
            {fullText}
          </span>
        </p>
      </div>

      <DialogueFooterRow lineIndex={lineIndex} lineCount={lineCount} />
    </div>
  );
}
