/**
 * Tests for the JSONL parser that backs `Shared/comments.jsonl`.
 *
 * Pure function — runs under the default vitest node env. The parser is
 * the integrity boundary between Drive bytes and the typed store: it
 * MUST skip malformed input without throwing so a single bad line
 * doesn't blank the whole comments feed.
 */

import { describe, expect, it } from "vitest";
import { parseCommentsJsonl } from "./comments-store";
import type { ShareComment } from "@shared/types";

function makeLine(overrides: Partial<ShareComment> = {}): string {
  const base: ShareComment = {
    v: 1,
    id: "c1",
    sharedFolderId: "owner-folder",
    shareId: "share-1",
    at: "2026-05-19T10:00:00.000Z",
    author: { handle: "alice" },
    text: "hello",
    ...overrides,
  };
  return JSON.stringify(base);
}

describe("parseCommentsJsonl", () => {
  it("returns [] for empty input", () => {
    expect(parseCommentsJsonl("")).toEqual([]);
    expect(parseCommentsJsonl("\n\n  \n")).toEqual([]);
  });

  it("parses a single line", () => {
    const out = parseCommentsJsonl(makeLine() + "\n");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("c1");
    expect(out[0].author.handle).toBe("alice");
  });

  it("parses multiple lines and preserves order", () => {
    const text = [
      makeLine({ id: "c1" }),
      makeLine({ id: "c2", text: "second" }),
      makeLine({ id: "c3", text: "third" }),
    ].join("\n");
    const out = parseCommentsJsonl(text);
    expect(out.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("tolerates CRLF line endings (Windows uploads)", () => {
    const text = [makeLine({ id: "a" }), makeLine({ id: "b" })].join("\r\n");
    const out = parseCommentsJsonl(text);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("skips malformed JSON lines without throwing", () => {
    const text = [makeLine({ id: "ok1" }), "{not json", makeLine({ id: "ok2" })].join(
      "\n",
    );
    const out = parseCommentsJsonl(text);
    expect(out.map((c) => c.id)).toEqual(["ok1", "ok2"]);
  });

  it("skips lines missing required fields", () => {
    const missingShareId = JSON.stringify({
      v: 1,
      id: "x",
      sharedFolderId: "f",
      at: "2026-05-19T10:00:00.000Z",
      author: { handle: "a" },
      text: "hi",
    });
    const missingAuthor = JSON.stringify({
      v: 1,
      id: "y",
      sharedFolderId: "f",
      shareId: "s",
      at: "2026-05-19T10:00:00.000Z",
      text: "hi",
    });
    const ok = makeLine({ id: "z" });
    const out = parseCommentsJsonl(
      [missingShareId, missingAuthor, ok].join("\n"),
    );
    expect(out.map((c) => c.id)).toEqual(["z"]);
  });

  it("rejects entries with v != 1 (future schema)", () => {
    const v2 = JSON.stringify({
      v: 2,
      id: "future",
      sharedFolderId: "f",
      shareId: "s",
      at: "2026-05-19T10:00:00.000Z",
      author: { handle: "a" },
      text: "hi",
    });
    const out = parseCommentsJsonl(v2 + "\n" + makeLine({ id: "now" }));
    expect(out.map((c) => c.id)).toEqual(["now"]);
  });

  it("tolerates a trailing newline", () => {
    expect(parseCommentsJsonl(makeLine() + "\n\n")).toHaveLength(1);
  });
});
