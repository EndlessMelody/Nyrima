import { ChevronLeft } from "lucide-react";

/**
 * "← Guide Map" — the left anchor of the panel header line. A lightweight
 * typographic action (not a bulky button) that returns to the chapter index.
 * It is not a Back/undo control: it never replays the intro and never resets the
 * page, it simply reopens the chapter map. Keyboard accessible (a real button).
 */
export function BackToGuideMapAction({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="lvn-guidemap" onClick={onClick}>
      <ChevronLeft size={14} aria-hidden="true" />
      <span>Guide Map</span>
    </button>
  );
}
