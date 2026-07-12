/**
 * Pure dialogue-flow helpers shared by LandingVNPage and useLandingSections.
 *
 * A node's dialogue is its base `DialogueLine[]` plus, once a choice option has
 * been picked, that option's reply lines appended to the end. `isAtChoicePoint`
 * tells the page when the choice menu should own input instead of advance().
 * `parseNodeKey` decodes a `nodeKey` back into a navigable target for the
 * dialogue-log "jump" feature.
 */

import type { Chapter, DialogueChoice, DialogueChoiceOption, DialogueLine } from "./landingSections";
import type { Emotion } from "./mascotArt";

export interface NormalizedLine {
  text: string;
  emotion?: Emotion;
}

/**
 * A short dialogue aside (poke reaction, idle remark, hover comment, …) that
 * temporarily takes over the dialogue box. The underlying node's line resumes
 * — re-typed from scratch — once the interjection is dismissed.
 *
 * `id` seeds synthetic dialogue-log entry ids (e.g. `poke:3`, `idle:sleepy-1`)
 * so the log can dedupe them without colliding with real `nodeKey`s; these
 * entries get no "Jump" action since they don't correspond to a node.
 */
export interface Interjection {
  id: string;
  lines: NormalizedLine[];
  emotion?: Emotion;
}

export function normalizeLines(lines: DialogueLine[]): NormalizedLine[] {
  return lines.map((line) =>
    typeof line === "string" ? { text: line } : { text: line.text, emotion: line.emotion },
  );
}

export function getChoiceOption(
  choice: DialogueChoice | undefined,
  optionId: string | null,
): DialogueChoiceOption | null {
  if (!choice || !optionId) return null;
  return choice.options.find((option) => option.id === optionId) ?? null;
}

/**
 * The effective dialogue sequence for a node: its base lines, followed by the
 * picked option's reply lines (if any option has been picked).
 */
export function effectiveLines(
  base: DialogueLine[],
  choice: DialogueChoice | undefined,
  pickedOptionId: string | null,
): NormalizedLine[] {
  const baseLines = normalizeLines(base);
  const option = getChoiceOption(choice, pickedOptionId);
  if (!option) return baseLines;
  return [...baseLines, ...normalizeLines(option.reply)];
}

/**
 * True once the base lines have finished typing, a choice exists for this
 * node, and no option has been picked yet — the choice menu should be shown
 * and own input instead of advance().
 */
export function isAtChoicePoint(
  lineIndex: number,
  baseCount: number,
  choice: DialogueChoice | undefined,
  pickedOptionId: string | null,
  complete: boolean,
): boolean {
  if (!choice || pickedOptionId || choice.options.length === 0) return false;
  return complete && lineIndex >= baseCount - 1;
}

/** Precedence: per-line emotion override > picked option's emotion > node fallback. */
export function resolveEmotion(
  line: NormalizedLine | undefined,
  pickedOption: DialogueChoiceOption | null,
  fallback: Emotion,
): Emotion {
  return line?.emotion ?? pickedOption?.emotion ?? fallback;
}

export type NodeTarget =
  | { kind: "intro" }
  | { kind: "index" }
  | { kind: "chapterIntro"; chapterId: string }
  | { kind: "subsection"; chapterId: string; subsectionId: string };

/**
 * Decode a `nodeKey` (as produced by useLandingSections) back into a navigable
 * target, validating chapter/subsection ids against `chapters`. Returns null
 * for keys that don't map to a real node (used to hide "Jump" for synthetic
 * poke/idle log entries).
 */
export function parseNodeKey(key: string, chapters: Chapter[]): NodeTarget | null {
  if (key === "intro" || key.startsWith("intro#")) return { kind: "intro" };
  if (key === "index" || key.startsWith("index:revisit-")) return { kind: "index" };

  const slash = key.indexOf("/");
  if (slash === -1) return null;
  const chapterId = key.slice(0, slash);
  const rest = key.slice(slash + 1);
  const chapter = chapters.find((c) => c.id === chapterId);
  if (!chapter) return null;

  if (rest === "intro") return { kind: "chapterIntro", chapterId };
  const subsection = chapter.subsections.find((s) => s.id === rest);
  if (!subsection) return null;
  return { kind: "subsection", chapterId, subsectionId: rest };
}
