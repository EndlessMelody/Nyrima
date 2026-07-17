import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Subsection } from "./landingSections";

/** How far one chevron press scrolls the rail, in px. */
const SCROLL_STEP = 160;
/** Slack (px) before we call the rail "at the edge" — avoids flicker from
 * sub-pixel scroll positions. */
const EDGE_SLACK = 4;

/**
 * The subsection switcher — the centre zone of the panel header line. Compact
 * pill tabs that ALWAYS stay on a single horizontal row: when a chapter has more
 * tabs than fit, the rail scrolls horizontally (with subtle edge fades from the
 * CSS) rather than wrapping or growing the header. The active subsection is
 * highlighted; arrow keys rove between tabs.
 *
 * The outer scroller is the centre flex zone; the inner rail is `max-content` and
 * auto-centred, so the tabs sit optically centred when they fit and scroll when
 * they don't. When the rail actually overflows, a pair of chevron buttons
 * appears over the edge fades — the CSS mask alone was too subtle a cue that
 * more chapters/topics exist off-screen, so the affordance is now explicit.
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
  // `.lvn-tabs` is the max-content rail (holds the tab buttons, used for
  // keyboard roving); `.lvn-header__tabs` is the actual `overflow-x: auto`
  // scroller the rail sits inside — scroll measurement/scrollBy must target
  // that outer element, not the rail itself.
  const listRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const updateEdges = () => {
      setCanScrollLeft(scroller.scrollLeft > EDGE_SLACK);
      setCanScrollRight(
        scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth - EDGE_SLACK,
      );
    };

    updateEdges();
    scroller.addEventListener("scroll", updateEdges, { passive: true });
    const resizeObserver = new ResizeObserver(updateEdges);
    resizeObserver.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", updateEdges);
      resizeObserver.disconnect();
    };
  }, [subsections, chapterId]);

  const scrollBy = (direction: 1 | -1) => {
    scrollerRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: "smooth" });
  };

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
      <button
        type="button"
        className="lvn-tabs__nav lvn-tabs__nav--left"
        aria-label="Scroll topics left"
        aria-hidden={!canScrollLeft}
        tabIndex={-1}
        disabled={!canScrollLeft}
        onClick={() => scrollBy(-1)}
      >
        <ChevronLeft size={13} />
      </button>

      {/* The masked, `overflow-x: auto` scroller — kept separate from the nav
       * buttons above/below so the edge-fade mask never dims the chevrons
       * themselves. */}
      <div className="lvn-tabs__scroll" ref={scrollerRef}>
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

      <button
        type="button"
        className="lvn-tabs__nav lvn-tabs__nav--right"
        aria-label="Scroll topics right"
        aria-hidden={!canScrollRight}
        tabIndex={-1}
        disabled={!canScrollRight}
        onClick={() => scrollBy(1)}
      >
        <ChevronRight size={13} />
      </button>
    </div>
  );
}
