/**
 * Landing VN navigation + pacing.
 *
 * Three levels, in deliberate order:
 *   "intro"   — on load: Ny-chan speaks 2–3 short pages. NO chapter cards yet.
 *   "index"   — once the intro finishes (or on "All Chapters"): the four chapters
 *               are offered as large VN cards.
 *   "chapter" — a chapter is open; its subsections are tabs and the information
 *               panel shows one of them (the first by default).
 *
 * Opening a chapter shows its intro line over the default subsection's content
 * (and marks that subsection visited too, so completion is reachable without an
 * explicit tab click); picking a subsection swaps the dialogue + panel. "All
 * Chapters" jumps straight back to the index — it is not a Back button, never
 * replays the intro, and never resets the page.
 *
 * This is a landing page, NOT a personalized onboarding flow: no first-time /
 * returning branching. Reading progress (`visited`, the completion reward) is
 * persisted across visits via `completion.ts`; `hasIntroFinished` stays
 * session-only, so every arrival still plays the intro.
 */

import { useCallback, useMemo, useState } from "react";
import { REVISIT_GREETINGS, TIME_GREETINGS, getTimeOfDayBucket } from "./ambientLines";
import {
  computeCompletion,
  readStoredProgress,
  writeStoredProgress,
  type CompletionStatus,
  type VNProgress,
} from "./completion";
import type { NodeTarget } from "./dialogueFlow";
import {
  INDEX_DIALOGUE,
  INTRO_DIALOGUE,
  chapters,
  type Chapter,
  type DialogueChoice,
  type DialogueLine,
  type Subsection,
} from "./landingSections";
import type { Emotion } from "./mascotArt";

export type LandingLevel = "intro" | "index" | "chapter";

export interface LandingNav {
  level: LandingLevel;
  /** All four chapters (for the index cards). */
  chapters: Chapter[];
  /** The open chapter, or null at intro/index. */
  chapter: Chapter | null;
  /** The active subsection within the open chapter, or null otherwise. */
  subsection: Subsection | null;
  /** Whether the visitor has explicitly picked a subsection (vs. the chapter's
   *  default landing) — drives intro line vs. subsection line. */
  picked: boolean;
  /** Whether the opening intro sequence has completed. */
  hasIntroFinished: boolean;
  /** Dialogue + mascot expression for the current node. */
  dialogue: DialogueLine[];
  /** Optional VN choice offered once this node's dialogue finishes. */
  choice: DialogueChoice | undefined;
  emotion: Emotion;
  /** Monotonic key that changes on every node change, so the caller can restart
   *  the typewriter cleanly. */
  nodeKey: string;
  /** Chapters / subsections already opened (to dim seen choices, VN-style). */
  visited: ReadonlySet<string>;
  /** Reading-progress completion across all subsections (persisted). */
  completion: CompletionStatus;
  /** Whether the one-time completion reward has already been shown. */
  rewardSeen: boolean;

  /** Mark the opening intro complete → reveal the chapter index. */
  finishIntro: () => void;
  /** Open a chapter at its first subsection (chapter intro is spoken). */
  openChapter: (id: string) => void;
  /** Switch the active subsection (its line is spoken). */
  openSubsection: (id: string) => void;
  /** Jump back to the chapter index (intro is not replayed). */
  toIndex: () => void;
  /** Jump to a node from a dialogue-log entry (e.g. its "Jump" button). */
  jumpTo: (target: NodeTarget) => void;
  /** Mark the completion reward as shown (persisted, fires at most once). */
  markRewardSeen: () => void;
}

export function useLandingSections(): LandingNav {
  const [hasIntroFinished, setHasIntroFinished] = useState(false);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [subsectionId, setSubsectionId] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const [progress, setProgress] = useState<VNProgress>(() => readStoredProgress());
  const visited = useMemo(() => new Set(progress.visitedKeys), [progress.visitedKeys]);
  // Chosen once per visit so the intro's first line is time-of-day aware
  // without re-rolling on every render.
  const [introGreeting] = useState<DialogueLine>(() => TIME_GREETINGS[getTimeOfDayBucket()]);

  const chapter = useMemo(
    () => chapters.find((c) => c.id === chapterId) ?? null,
    [chapterId],
  );
  const subsection = useMemo(
    () => chapter?.subsections.find((s) => s.id === subsectionId) ?? null,
    [chapter, subsectionId],
  );

  const markVisited = useCallback((key: string) => {
    setProgress((prev) => {
      if (prev.visitedKeys.includes(key)) return prev;
      const next: VNProgress = { ...prev, visitedKeys: [...prev.visitedKeys, key] };
      writeStoredProgress(next);
      return next;
    });
  }, []);

  const markRewardSeen = useCallback(() => {
    setProgress((prev) => {
      if (prev.rewardSeen) return prev;
      const next: VNProgress = { ...prev, rewardSeen: true };
      writeStoredProgress(next);
      return next;
    });
  }, []);

  const finishIntro = useCallback(() => setHasIntroFinished(true), []);

  const openChapter = useCallback(
    (id: string) => {
      const next = chapters.find((c) => c.id === id);
      if (!next) return;
      setHasIntroFinished(true);
      setChapterId(id);
      setSubsectionId(next.subsections[0]?.id ?? null);
      setPicked(false);
      markVisited(id);
      const first = next.subsections[0];
      if (first) markVisited(`${id}/${first.id}`);
    },
    [markVisited],
  );

  const openSubsection = useCallback(
    (id: string) => {
      setSubsectionId(id);
      setPicked(true);
      if (chapterId) markVisited(`${chapterId}/${id}`);
    },
    [chapterId, markVisited],
  );

  const toIndex = useCallback(() => {
    setHasIntroFinished(true);
    setChapterId(null);
    setSubsectionId(null);
    setPicked(false);
  }, []);

  // "intro" log entries jump to the index rather than replaying the opening
  // greeting — re-showing it mid-session would cover the chapter cards again
  // for little benefit, and the index is the natural "back to the start" spot.
  const jumpTo = useCallback((target: NodeTarget) => {
    switch (target.kind) {
      case "intro":
      case "index":
        setHasIntroFinished(true);
        setChapterId(null);
        setSubsectionId(null);
        setPicked(false);
        return;
      case "chapterIntro": {
        const next = chapters.find((c) => c.id === target.chapterId);
        if (!next) return;
        setHasIntroFinished(true);
        setChapterId(target.chapterId);
        setSubsectionId(next.subsections[0]?.id ?? null);
        setPicked(false);
        return;
      }
      case "subsection": {
        const next = chapters.find((c) => c.id === target.chapterId);
        if (!next?.subsections.some((s) => s.id === target.subsectionId)) return;
        setHasIntroFinished(true);
        setChapterId(target.chapterId);
        setSubsectionId(target.subsectionId);
        setPicked(true);
        return;
      }
    }
  }, []);

  const level: LandingLevel = chapter
    ? "chapter"
    : hasIntroFinished
      ? "index"
      : "intro";

  // Once the visitor has opened at least one chapter, the index greets them
  // with a revisit line instead of the first-arrival INDEX_DIALOGUE — picked
  // deterministically so it only changes as `visited` grows.
  const revisitGreeting =
    level === "index" && visited.size > 0
      ? REVISIT_GREETINGS[visited.size % REVISIT_GREETINGS.length]
      : null;

  const dialogue =
    chapter && picked && subsection
      ? subsection.dialogue
      : chapter
        ? chapter.introDialogue
        : level === "index"
          ? revisitGreeting
            ? revisitGreeting.lines
            : INDEX_DIALOGUE.lines
          : [introGreeting, ...INTRO_DIALOGUE.lines];

  const emotion =
    chapter && picked && subsection
      ? subsection.emotion
      : chapter
        ? chapter.mascotExpression
        : level === "index"
          ? revisitGreeting
            ? revisitGreeting.emotion
            : INDEX_DIALOGUE.emotion
          : INTRO_DIALOGUE.emotion;

  const nodeKey =
    chapter && picked && subsection
      ? `${chapterId}/${subsection.id}`
      : chapter
        ? `${chapterId}/intro`
        : revisitGreeting
          ? `index:revisit-${visited.size % REVISIT_GREETINGS.length}`
          : level;

  const choice: DialogueChoice | undefined =
    chapter && picked && subsection
      ? subsection.choice
      : chapter
        ? chapter.introChoice
        : level === "index"
          ? revisitGreeting
            ? undefined
            : INDEX_DIALOGUE.choice
          : INTRO_DIALOGUE.choice;

  const completion = computeCompletion(visited, chapters);

  return {
    level,
    chapters,
    chapter,
    subsection,
    picked,
    hasIntroFinished,
    dialogue,
    choice,
    emotion,
    nodeKey,
    visited,
    completion,
    rewardSeen: progress.rewardSeen,
    finishIntro,
    openChapter,
    openSubsection,
    toIndex,
    jumpTo,
    markRewardSeen,
  };
}
