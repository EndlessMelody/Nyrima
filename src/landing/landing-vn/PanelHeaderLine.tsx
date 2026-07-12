import type { Chapter, Subsection } from "./landingSections";
import { BackToGuideMapAction } from "./BackToGuideMapAction";
import { SubsectionTabsInline } from "./SubsectionTabsInline";
import { ChapterTitleInline } from "./ChapterTitleInline";

/**
 * The information panel's header, compressed onto a single line that never wraps
 * and never grows in height:
 *
 *   | ← Guide Map | sub tab · sub tab · sub tab · … | Chapter 0X · Title |
 *
 *   left   — back to the chapter index (Guide Map)
 *   centre — the subsection tabs (flexible, optically centred, scroll on overflow)
 *   right  — the chapter identity
 *
 * Keeping all three on one row hands the rest of the panel's vertical space to
 * the content body below.
 */
export function PanelHeaderLine({
  chapter,
  subsection,
  visited,
  onBack,
  onChoose,
}: {
  chapter: Chapter;
  subsection: Subsection;
  visited: ReadonlySet<string>;
  onBack: () => void;
  onChoose: (id: string) => void;
}) {
  return (
    <div className="lvn-header">
      <BackToGuideMapAction onClick={onBack} />
      <SubsectionTabsInline
        subsections={chapter.subsections}
        activeId={subsection.id}
        visited={visited}
        chapterId={chapter.id}
        onChoose={onChoose}
      />
      <ChapterTitleInline chapter={chapter} />
    </div>
  );
}
