import { useRef } from "react";
import type { Subsection } from "./landingSections";

/**
 * The subsection switcher — the centre zone of the panel header line. Compact
 * pill tabs that ALWAYS stay on a single horizontal row: when a chapter has more
 * tabs than fit, the rail scrolls horizontally (with subtle edge fades from the
 * CSS) rather than wrapping or growing the header. The active subsection is
 * highlighted; arrow keys rove between tabs.
 *
 * The outer scroller is the centre flex zone; the inner rail is `max-content` and
 * auto-centred, so the tabs sit optically centred when they fit and scroll when
 * they don't.
 */
export function SubsectionTabsInline({
  subsections,
  activeId,
  visited,
  chapterId,
  onChoose,
}: {
  subsections: Subsection[];
  activeId: string | null;
  visited: ReadonlySet<string>;
  chapterId: string;
  onChoose: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = buttons[(index + delta + buttons.length) % buttons.length];
    next?.focus();
    // Keep the focused tab in view when the rail is scrolling.
    next?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <div className="lvn-header__tabs">
      <div
        className="lvn-tabs"
        role="tablist"
        aria-label="Topics in this chapter"
        ref={listRef}
        onKeyDown={onKeyDown}
      >
        {subsections.map((sub) => {
          const active = sub.id === activeId;
          const seen = visited.has(`${chapterId}/${sub.id}`);
          return (
            <button
              key={sub.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`lvn-tab${active ? " is-active" : ""}${
                seen && !active ? " is-seen" : ""
              }`}
              onClick={() => onChoose(sub.id)}
            >
              <span className="lvn-tab__mark" aria-hidden="true">
                ◇
              </span>
              {sub.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
