import { useEffect, useRef } from "react";
import type { Chapter } from "./landingSections";

/**
 * The chapter index — the landing's main menu. Four large VN-style cards in a
 * 2×2 grid, each with its chapter number, title, one-line description, and icon.
 * These are intentionally the strongest navigation surface on the page: bigger
 * and louder than the subsection tabs inside a chapter.
 *
 * Real buttons (keyboard + screen-reader friendly); the first is focused when
 * the index appears and arrow keys rove between them.
 */
export function ChapterIndex({
  chapters,
  visited,
  onOpen,
  onHoverChapter,
}: {
  chapters: Chapter[];
  visited: ReadonlySet<string>;
  onOpen: (id: string) => void;
  /** Debounced hover remark hook-up; `null` on mouse-leave. */
  onHoverChapter?: (id: string | null) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const first = listRef.current?.querySelector<HTMLButtonElement>("button");
    first?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  };

  return (
    <ul className="lvn-index" ref={listRef} role="menu" aria-label="Chapters" onKeyDown={onKeyDown}>
      {chapters.map((ch) => {
        const Icon = ch.icon;
        const seen = visited.has(ch.id);
        return (
          <li key={ch.id} role="none">
            <button
              type="button"
              role="menuitem"
              className={`lvn-index__card${seen ? " is-seen" : ""}`}
              onClick={() => onOpen(ch.id)}
              onMouseEnter={() => onHoverChapter?.(ch.id)}
              onMouseLeave={() => onHoverChapter?.(null)}
            >
              <span className="lvn-index__watermark" aria-hidden="true">
                {String(ch.chapterNumber).padStart(2, "0")}
              </span>
              {seen && (
                <span className="lvn-index__seen" aria-hidden="true">
                  ✓ Seen
                </span>
              )}
              <span className="lvn-index__icon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <span className="lvn-index__num">
                CH.{String(ch.chapterNumber).padStart(2, "0")} // SYS.{ch.id.toUpperCase()}
              </span>
              <span className="lvn-index__title">{ch.title}</span>
              <span className="lvn-index__desc">{ch.subtitle}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
