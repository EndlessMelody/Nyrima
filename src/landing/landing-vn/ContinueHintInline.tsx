/**
 * The permanent VN helper hint, rendered inline in the dialogue box footer (its
 * right side). It is a steady interaction guideline — "you can move things
 * along" — and is ALWAYS visible: it never disappears when options are shown,
 * the dialogue ends, a chapter is open, or a subsection is active.
 *
 * Purely a guideline, so it never intercepts pointer events; a click on it falls
 * through to the dialogue box and advances the scene.
 */
export function ContinueHintInline() {
  return (
    <p className="lvn-continue" aria-hidden="true">
      click to continue <span>·</span> press enter
    </p>
  );
}
