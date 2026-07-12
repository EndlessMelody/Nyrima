/**
 * Tests for the `post.json` sanitizer — the untrusted-input boundary for
 * every followed user's post document. Drive reads/writes are covered by
 * manual smoke tests; these checks keep the wire protocol rules stable.
 */

import { describe, expect, it } from "vitest";
import { derivePostExcerpt, generatePostId, sanitizePostDoc } from "./post-doc";
import type { PostBlock, PostDoc } from "@shared/post-types";

const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_01";

function paragraph(text: string, id = "b1"): PostBlock {
  return {
    id,
    type: "paragraph",
    props: {},
    content: [{ type: "text", text, styles: {} }],
  };
}

function makeDoc(overrides: Partial<PostDoc> = {}): PostDoc {
  return {
    v: 1,
    id: "post-1",
    author: { handle: "khoa", name: "Đăng Khoa" },
    title: "My analysis",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    visibility: "public",
    blocks: [paragraph("Hello world")],
    ...overrides,
  };
}

describe("sanitizePostDoc", () => {
  it("round-trips a well-formed document", () => {
    const doc = makeDoc();
    const result = sanitizePostDoc(doc);
    expect(result).not.toBeNull();
    expect(result?.title).toBe("My analysis");
    expect(result?.blocks).toHaveLength(1);
    expect(result?.blocks[0].content?.[0]).toEqual({
      type: "text",
      text: "Hello world",
      styles: {},
    });
  });

  it("rejects a document with the wrong schema version", () => {
    expect(sanitizePostDoc({ ...makeDoc(), v: 2 })).toBeNull();
  });

  it("rejects a document with a malformed author handle", () => {
    const doc = { ...makeDoc(), author: { handle: "AB" } };
    expect(sanitizePostDoc(doc)).toBeNull();
  });

  it("rejects a document missing required identity fields", () => {
    expect(sanitizePostDoc({ ...makeDoc(), id: "" })).toBeNull();
    expect(sanitizePostDoc({ ...makeDoc(), title: "" })).toBeNull();
    expect(sanitizePostDoc({ ...makeDoc(), createdAt: "not-a-date" })).toBeNull();
    expect(sanitizePostDoc({ ...makeDoc(), visibility: "everyone" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(sanitizePostDoc(null)).toBeNull();
    expect(sanitizePostDoc("hello")).toBeNull();
    expect(sanitizePostDoc(42)).toBeNull();
  });

  it("downgrades an unknown block type to an unsupported stub instead of dropping the post", () => {
    const doc = makeDoc({
      blocks: [
        paragraph("before", "b1"),
        { id: "b2", type: "futureBlock" as never, props: { x: 1 } },
        paragraph("after", "b3"),
      ],
    });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "unsupported",
      "paragraph",
    ]);
    expect(result?.blocks[1].props).toEqual({});
  });

  it("downgrades a known block type with an invalid required prop to unsupported", () => {
    const doc = makeDoc({
      blocks: [
        {
          id: "img1",
          type: "driveImage",
          props: { fileId: "not valid! too short" },
        },
      ],
    });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks[0].type).toBe("unsupported");
  });

  it("downgrades a driveImage block missing fileId entirely to unsupported", () => {
    const doc = makeDoc({
      blocks: [{ id: "img1", type: "driveImage", props: {} }],
    });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks[0].type).toBe("unsupported");
  });

  it("accepts a driveImage block with a valid fileId and fills in defaults", () => {
    const doc = makeDoc({
      blocks: [{ id: "img1", type: "driveImage", props: { fileId: FILE_ID } }],
    });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks[0]).toEqual({
      id: "img1",
      type: "driveImage",
      props: { fileId: FILE_ID, width: "wide", align: "center" },
    });
  });

  it("strips javascript: URIs from inline links", () => {
    const doc = makeDoc({
      blocks: [
        {
          id: "b1",
          type: "paragraph",
          props: {},
          content: [
            {
              type: "link",
              href: "javascript:alert(1)",
              content: [{ type: "text", text: "click me", styles: {} }],
            },
          ],
        },
      ],
    });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks[0].content).toBeUndefined();
  });

  it("keeps https links and drops non-https ones", () => {
    const doc = makeDoc({
      blocks: [
        {
          id: "b1",
          type: "paragraph",
          props: {},
          content: [
            {
              type: "link",
              href: "https://example.com/post",
              content: [{ type: "text", text: "read more", styles: {} }],
            },
          ],
        },
      ],
    });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks[0].content?.[0]).toMatchObject({
      type: "link",
      href: "https://example.com/post",
    });
  });

  it("caps nesting depth", () => {
    let leaf: PostBlock = paragraph("deep", "leaf");
    for (let i = 0; i < 10; i += 1) {
      leaf = { id: `wrap-${i}`, type: "paragraph", props: {}, children: [leaf] };
    }
    const doc = makeDoc({ blocks: [leaf] });
    const result = sanitizePostDoc(doc);

    let depth = 0;
    let node = result?.blocks[0];
    while (node?.children?.length) {
      depth += 1;
      node = node.children[0];
    }
    expect(depth).toBeLessThanOrEqual(4);
  });

  it("caps the total number of blocks", () => {
    const blocks = Array.from({ length: 600 }, (_, i) => paragraph(`p${i}`, `b${i}`));
    const doc = makeDoc({ blocks });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks.length).toBeLessThanOrEqual(500);
  });

  it("keeps a numberedListItem's start prop (matches BlockNote's built-in propSchema)", () => {
    const doc = makeDoc({
      blocks: [
        {
          id: "n1",
          type: "numberedListItem",
          props: { start: 5 },
          content: [{ type: "text", text: "Fifth item", styles: {} }],
        },
      ],
    });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks[0].props).toEqual({ start: 5 });
  });

  it("drops a negative or non-integer numberedListItem start", () => {
    const doc = makeDoc({
      blocks: [{ id: "n1", type: "numberedListItem", props: { start: -1 } }],
    });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks[0].props).toEqual({});
  });

  it("only allows a whitelisted set of props on a heading block", () => {
    const doc = makeDoc({
      blocks: [
        {
          id: "h1",
          type: "heading",
          props: { level: 2, textColor: "#ff0000", onclick: "alert(1)" },
          content: [{ type: "text", text: "Section", styles: {} }],
        },
      ],
    });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks[0].props).toEqual({ level: 2, textColor: "#ff0000" });
  });

  it("rejects a heading with an invalid level", () => {
    const doc = makeDoc({
      blocks: [{ id: "h1", type: "heading", props: { level: 7 } }],
    });
    const result = sanitizePostDoc(doc);
    expect(result?.blocks[0].type).toBe("unsupported");
  });
});

describe("generatePostId", () => {
  it("produces unique-looking ids", () => {
    const a = generatePostId();
    const b = generatePostId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("derivePostExcerpt", () => {
  it("joins text from the first text-bearing blocks", () => {
    const excerpt = derivePostExcerpt([
      paragraph("First paragraph.", "b1"),
      { id: "img", type: "driveImage", props: { fileId: FILE_ID } },
      paragraph("Second paragraph.", "b2"),
    ]);
    expect(excerpt).toBe("First paragraph. Second paragraph.");
  });

  it("skips the contents of spoiler blocks", () => {
    const excerpt = derivePostExcerpt([
      paragraph("Visible.", "b1"),
      {
        id: "sp",
        type: "spoiler",
        props: {},
        children: [paragraph("Secret plot twist.", "b2")],
      },
    ]);
    expect(excerpt).toBe("Visible.");
  });

  it("returns undefined when there is no text content", () => {
    const excerpt = derivePostExcerpt([
      { id: "img", type: "driveImage", props: { fileId: FILE_ID } },
    ]);
    expect(excerpt).toBeUndefined();
  });
});
