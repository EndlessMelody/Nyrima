import type { Chapter } from "./landingSections";

/**
 * The chapter identity — the right anchor of the panel header line, on ONE line:
 *
 *   [icon] Chapter 03 · Trust & Privacy
 *
 * It is the visitor's "you are here". Kept short and readable (primary
 * navigation, not decorative HUD text); the current subsection is shown by the
 * active pink tab in the centre.
 */
export function ChapterTitleInline({ chapter }: { chapter: Chapter }) {
  const Icon = chapter.icon;
  return (
    <div className="lvn-ctitle">
      <span className="lvn-ctitle__icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="lvn-ctitle__num">
        CH.{String(chapter.chapterNumber).padStart(2, "0")} // SYS.{chapter.id.toUpperCase()}
      </span>
      <span className="lvn-ctitle__sep" aria-hidden="true">
        ·
      </span>
      <h2 className="lvn-ctitle__name">{chapter.title}</h2>
    </div>
  );
}
