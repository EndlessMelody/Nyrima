import { describe, expect, it } from "vitest";
import { chapters, type DialogueChoice } from "./landingSections";
import {
  effectiveLines,
  getChoiceOption,
  isAtChoicePoint,
  normalizeLines,
  parseNodeKey,
  resolveEmotion,
} from "./dialogueFlow";

const CHOICE: DialogueChoice = {
  prompt: "Pick one",
  options: [
    { id: "a", label: "Option A", reply: ["Reply A"], emotion: "happy" },
    { id: "b", label: "Option B", reply: ["Reply B 1", "Reply B 2"] },
  ],
};

describe("normalizeLines", () => {
  it("normalizes plain strings to lines without an emotion", () => {
    expect(normalizeLines(["hello", "world"])).toEqual([
      { text: "hello", emotion: undefined },
      { text: "world", emotion: undefined },
    ]);
  });

  it("preserves per-line emotion overrides on object lines", () => {
    expect(normalizeLines(["plain", { text: "shifted", emotion: "teary" }])).toEqual([
      { text: "plain", emotion: undefined },
      { text: "shifted", emotion: "teary" },
    ]);
  });
});

describe("getChoiceOption", () => {
  it("returns null when there is no choice or no pick", () => {
    expect(getChoiceOption(undefined, "a")).toBeNull();
    expect(getChoiceOption(CHOICE, null)).toBeNull();
  });

  it("returns the matching option", () => {
    expect(getChoiceOption(CHOICE, "b")?.label).toBe("Option B");
  });

  it("returns null for an unknown option id", () => {
    expect(getChoiceOption(CHOICE, "nope")).toBeNull();
  });
});

describe("effectiveLines", () => {
  const base = ["Base line 1", "Base line 2"];

  it("returns just the base lines before any pick", () => {
    expect(effectiveLines(base, CHOICE, null)).toEqual(normalizeLines(base));
  });

  it("returns just the base lines when there is no choice", () => {
    expect(effectiveLines(base, undefined, null)).toEqual(normalizeLines(base));
  });

  it("appends the picked option's reply lines", () => {
    expect(effectiveLines(base, CHOICE, "b")).toEqual([
      ...normalizeLines(base),
      { text: "Reply B 1", emotion: undefined },
      { text: "Reply B 2", emotion: undefined },
    ]);
  });

  it("falls back to base lines for an unknown picked option id", () => {
    expect(effectiveLines(base, CHOICE, "missing")).toEqual(normalizeLines(base));
  });
});

describe("isAtChoicePoint", () => {
  const baseCount = 2;

  it("is false when there is no choice", () => {
    expect(isAtChoicePoint(1, baseCount, undefined, null, true)).toBe(false);
  });

  it("is false when a choice has no options", () => {
    expect(isAtChoicePoint(1, baseCount, { options: [] }, null, true)).toBe(false);
  });

  it("is false while the last base line is still typing", () => {
    expect(isAtChoicePoint(1, baseCount, CHOICE, null, false)).toBe(false);
  });

  it("is false before the last base line", () => {
    expect(isAtChoicePoint(0, baseCount, CHOICE, null, true)).toBe(false);
  });

  it("is true once the last base line is complete and nothing is picked", () => {
    expect(isAtChoicePoint(1, baseCount, CHOICE, null, true)).toBe(true);
  });

  it("is false once an option has been picked", () => {
    expect(isAtChoicePoint(1, baseCount, CHOICE, "a", true)).toBe(false);
  });
});

describe("resolveEmotion", () => {
  it("prefers the line's own emotion override", () => {
    expect(
      resolveEmotion(
        { text: "x", emotion: "teary" },
        { id: "a", label: "A", reply: [], emotion: "happy" },
        "neutral",
      ),
    ).toBe("teary");
  });

  it("falls back to the picked option's emotion", () => {
    expect(
      resolveEmotion(
        { text: "x" },
        { id: "a", label: "A", reply: [], emotion: "happy" },
        "neutral",
      ),
    ).toBe("happy");
  });

  it("falls back to the node fallback when neither is set", () => {
    expect(resolveEmotion({ text: "x" }, null, "neutral")).toBe("neutral");
    expect(resolveEmotion(undefined, null, "neutral")).toBe("neutral");
  });
});

describe("parseNodeKey", () => {
  it("parses the intro key and replayed intro keys", () => {
    expect(parseNodeKey("intro", chapters)).toEqual({ kind: "intro" });
    expect(parseNodeKey("intro#2", chapters)).toEqual({ kind: "intro" });
  });

  it("parses the index key and revisit-suffixed index keys", () => {
    expect(parseNodeKey("index", chapters)).toEqual({ kind: "index" });
    expect(parseNodeKey("index:revisit-3", chapters)).toEqual({ kind: "index" });
  });

  it("parses a chapter-intro key", () => {
    expect(parseNodeKey("welcome/intro", chapters)).toEqual({
      kind: "chapterIntro",
      chapterId: "welcome",
    });
  });

  it("parses a subsection key", () => {
    expect(parseNodeKey("welcome/problems", chapters)).toEqual({
      kind: "subsection",
      chapterId: "welcome",
      subsectionId: "problems",
    });
  });

  it("round-trips every real chapter and subsection", () => {
    for (const chapter of chapters) {
      expect(parseNodeKey(`${chapter.id}/intro`, chapters)).toEqual({
        kind: "chapterIntro",
        chapterId: chapter.id,
      });
      for (const sub of chapter.subsections) {
        expect(parseNodeKey(`${chapter.id}/${sub.id}`, chapters)).toEqual({
          kind: "subsection",
          chapterId: chapter.id,
          subsectionId: sub.id,
        });
      }
    }
  });

  it("returns null for unknown chapters, subsections, or malformed keys", () => {
    expect(parseNodeKey("nope/intro", chapters)).toBeNull();
    expect(parseNodeKey("welcome/nope", chapters)).toBeNull();
    expect(parseNodeKey("no-slash-here", chapters)).toBeNull();
  });
});
