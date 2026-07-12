/**
 * Tests for the character-offset highlighter. Runs under the `node` env, so we
 * graft jsdom's document onto the globals (same approach as the EPUB parser
 * test) to get a real DOM + TreeWalker.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyHighlights, clearHighlights } from "./highlight-dom";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
let makeRoot: (html: string) => HTMLElement;

beforeAll(async () => {
  // @ts-expect-error -- jsdom ships no bundled types in this project
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  g.document = dom.window.document;
  g.NodeFilter = dom.window.NodeFilter;
  makeRoot = (html: string) => {
    const el = dom.window.document.createElement("div");
    el.innerHTML = html;
    return el as unknown as HTMLElement;
  };
});

afterAll(() => {
  delete g.document;
  delete g.NodeFilter;
});

describe("applyHighlights / clearHighlights", () => {
  it("wraps a simple offset range and round-trips on clear", () => {
    const root = makeRoot("<p>Hello brave new world</p>");
    // "brave" begins at offset 6.
    applyHighlights(root, [{ id: "a", start: 6, end: 11, color: "yellow" }]);
    const mark = root.querySelector("mark.reader-hl");
    expect(mark).toBeTruthy();
    expect(mark!.textContent).toBe("brave");
    expect(mark!.getAttribute("data-hl-id")).toBe("a");
    expect(mark!.getAttribute("data-hl-color")).toBe("yellow");
    // Text is otherwise intact.
    expect(root.textContent).toBe("Hello brave new world");

    clearHighlights(root);
    expect(root.querySelector("mark.reader-hl")).toBeNull();
    expect(root.textContent).toBe("Hello brave new world");
    expect(root.innerHTML).toBe("<p>Hello brave new world</p>");
  });

  it("spans across inline elements as multiple marks with one id", () => {
    const root = makeRoot("<p>one <em>two</em> three</p>");
    // textContent = "one two three"; highlight "two three" → offsets 4..13.
    applyHighlights(root, [{ id: "x", start: 4, end: 13, color: "green" }]);
    const marks = root.querySelectorAll('mark.reader-hl[data-hl-id="x"]');
    expect(marks.length).toBe(2); // one inside <em>, one in the trailing text
    expect(Array.from(marks).map((m) => m.textContent).join("")).toBe("two three");
    expect(root.textContent).toBe("one two three");
  });

  it("applies multiple non-overlapping highlights", () => {
    const root = makeRoot("<p>alpha beta gamma</p>");
    applyHighlights(root, [
      { id: "1", start: 0, end: 5, color: "yellow" }, // alpha
      { id: "2", start: 11, end: 16, color: "pink" }, // gamma
    ]);
    expect(root.querySelector('[data-hl-id="1"]')!.textContent).toBe("alpha");
    expect(root.querySelector('[data-hl-id="2"]')!.textContent).toBe("gamma");
    expect(root.textContent).toBe("alpha beta gamma");
    clearHighlights(root);
    expect(root.querySelectorAll("mark.reader-hl").length).toBe(0);
  });
});
