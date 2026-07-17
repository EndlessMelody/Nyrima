/**
 * Integration test: parse a real, shipping EPUB end-to-end.
 *
 * Runs the full pipeline (unzip → OPF → spine → TOC → per-chapter text →
 * renderChapter) against the Yen Press light novel in `example/`, the same
 * book the reader is expected to open. The parser needs a DOM, which the
 * `node` test environment lacks, so we graft jsdom's DOMParser + a Blob URL
 * stub onto the globals for this file only.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEpub } from "./epub-parser";
import type { EpubBook } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

let createdUrls = 0;

beforeAll(async () => {
  // @ts-expect-error -- jsdom ships no bundled types in this project
  const { JSDOM } = await import("jsdom");
  const { window } = new JSDOM("<!doctype html><html><body></body></html>");
  g.DOMParser = window.DOMParser;
  // Node's URL has no object-URL factory; stub it so renderChapter can rewire
  // images without a real browser.
  g.URL.createObjectURL = () => `blob:mock-${++createdUrls}`;
  g.URL.revokeObjectURL = () => {};
});

afterAll(() => {
  delete g.DOMParser;
});

async function loadExampleBook(): Promise<EpubBook> {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const path = `${dir}/../../../../example/Alya Sometimes Hides Her Feelings in Russian v04 [Yen Press] [Stick].epub`;
  const bytes = new Uint8Array(readFileSync(path));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return parseEpub(buffer as ArrayBuffer);
}

describe("parseEpub (real Yen Press EPUB)", () => {
  it("reads metadata and groups the spine into TOC chapters", async () => {
    const book = await loadExampleBook();
    expect(book.title).toBe("Alya Sometimes Hides Her Feelings in Russian, Vol. 04");
    expect(book.author).toBe("Sunsunsun and Momoco");
    expect(book.language?.toLowerCase()).toContain("en");
    // Chapters are grouped by TOC, so there are several but fewer than the raw
    // spine doc count (~40).
    expect(book.chapters.length).toBeGreaterThan(5);
    expect(book.chapters.length).toBeLessThan(40);
    expect(book.toc.length).toBeGreaterThan(5);
    // Every resolved TOC entry points at a real chapter group.
    const resolved = book.toc.filter((t) => t.chapterIndex >= 0);
    expect(resolved.length).toBeGreaterThan(5);
    for (const t of resolved) {
      expect(t.chapterIndex).toBeLessThan(book.chapters.length);
    }
    book.dispose();
  });

  it("extracts chapter text and word counts", async () => {
    const book = await loadExampleBook();
    const withText = book.chapters.filter((c) => c.wordCount > 50);
    expect(withText.length).toBeGreaterThan(5);
    const all = book.chapters.map((c) => c.text).join("\n");
    expect(all).toContain("stomach fetishes");
    expect(book.totalWordCount).toBeGreaterThan(10000);
    book.dispose();
  });

  it("renders a chapter as concatenated, sanitized documents", async () => {
    const book = await loadExampleBook();
    const chapterIdx = book.chapters.findIndex((c) => c.text.includes("stomach fetishes"));
    expect(chapterIdx).toBeGreaterThanOrEqual(0);
    const html = await book.renderChapter(chapterIdx);
    expect(html.length).toBeGreaterThan(100);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    // Chapter 1's prose spans several spine files; grouping folds them into one
    // chapter, so the render contains the per-document wrappers.
    expect(html).toContain("reader-doc");
    // The book's own "CHAPTER 1" heading duplicates the reader's header and is
    // stripped; the prose body itself never says "CHAPTER 1" in caps.
    expect(html).not.toContain("CHAPTER 1");
    // …but the prose is intact.
    expect(html).toContain("stomach fetishes");
    book.dispose();
  });

  it("renders illustration-only chapters inline with rewired images", async () => {
    const book = await loadExampleBook();
    // Cover / inserts have no text — they become image-only chapters whose
    // <img> is rewired to an in-memory blob URL (our test stub).
    const imageChapter = book.chapters.find((c) => c.wordCount === 0);
    expect(imageChapter).toBeTruthy();
    const html = await book.renderChapter(imageChapter!.index);
    expect(html).toContain("<img");
    expect(html).toMatch(/blob:mock-/);
    book.dispose();
  });
});
