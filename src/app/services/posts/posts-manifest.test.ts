/**
 * Tests for the pure manifest helpers that back `Shared/posts.json`. Drive
 * reads/writes are covered by manual smoke tests; these checks keep the
 * local protocol rules stable before bytes ever touch Drive.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import type { PostAnnouncement, PostsManifest } from "@shared/post-types";
import {
  prependAnnouncement,
  removeAnnouncement,
  sanitizePostsManifest,
} from "./posts-manifest";

const NOW = new Date("2026-07-11T05:00:00.000Z");
const FOLDER_ID = "2AbCdEfGhIjKlMnOpQrStUvWxYz_02";

function makeAnnouncement(id: string, title = id): PostAnnouncement {
  return {
    v: 1,
    id,
    folderId: FOLDER_ID,
    title,
    visibility: "public",
    publishedAt: "2026-07-10T04:00:00.000Z",
    updatedAt: "2026-07-10T04:00:00.000Z",
  };
}

function makeManifest(posts: PostAnnouncement[]): PostsManifest {
  return {
    v: 1,
    owner: { handle: "khoa", name: "Đăng Khoa" },
    updatedAt: "2026-07-10T04:00:00.000Z",
    posts,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("sanitizePostsManifest", () => {
  it("round-trips a well-formed manifest", () => {
    const manifest = makeManifest([makeAnnouncement("a"), makeAnnouncement("b")]);
    const result = sanitizePostsManifest(manifest);
    expect(result?.posts.map((p) => p.id)).toEqual(["a", "b"]);
    expect(result?.owner.handle).toBe("khoa");
  });

  it("rejects the wrong schema version", () => {
    const manifest = { ...makeManifest([]), v: 2 };
    expect(sanitizePostsManifest(manifest)).toBeNull();
  });

  it("rejects a manifest with an invalid owner handle", () => {
    const manifest = { ...makeManifest([]), owner: { handle: "AB" } };
    expect(sanitizePostsManifest(manifest)).toBeNull();
  });

  it("drops individual malformed announcements without rejecting the manifest", () => {
    const manifest = makeManifest([
      makeAnnouncement("a"),
      { id: "bad", title: "missing everything else" } as unknown as PostAnnouncement,
      makeAnnouncement("c"),
    ]);
    const result = sanitizePostsManifest(manifest);
    expect(result?.posts.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("rejects an announcement with a non-drive folderId", () => {
    const manifest = makeManifest([
      { ...makeAnnouncement("a"), folderId: "javascript:alert(1)" },
    ]);
    const result = sanitizePostsManifest(manifest);
    expect(result?.posts).toEqual([]);
  });

  it("drops a non-https posterUrl but keeps the announcement", () => {
    const manifest = makeManifest([
      { ...makeAnnouncement("a"), posterUrl: "javascript:alert(1)" },
    ]);
    const result = sanitizePostsManifest(manifest);
    expect(result?.posts[0].posterUrl).toBeUndefined();
  });

  it("dedupes announcements by id, keeping the first occurrence", () => {
    const manifest = makeManifest([
      makeAnnouncement("a", "first"),
      makeAnnouncement("a", "second"),
    ]);
    const result = sanitizePostsManifest(manifest);
    expect(result?.posts).toHaveLength(1);
    expect(result?.posts[0].title).toBe("first");
  });

  it("returns null for non-object input", () => {
    expect(sanitizePostsManifest(null)).toBeNull();
    expect(sanitizePostsManifest("hello")).toBeNull();
  });
});

describe("prependAnnouncement", () => {
  it("puts the newest announcement first and refreshes updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const manifest = makeManifest([makeAnnouncement("a"), makeAnnouncement("b")]);
    const next = prependAnnouncement(manifest, makeAnnouncement("c"));

    expect(next.posts.map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(next.updatedAt).toBe(NOW.toISOString());
    expect(manifest.posts.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("dedupes by id and keeps the replacement payload", () => {
    const manifest = makeManifest([makeAnnouncement("a", "old"), makeAnnouncement("b")]);
    const next = prependAnnouncement(manifest, makeAnnouncement("a", "new"));

    expect(next.posts.map((p) => p.id)).toEqual(["a", "b"]);
    expect(next.posts[0].title).toBe("new");
  });
});

describe("removeAnnouncement", () => {
  it("removes an announcement without mutating the original manifest", () => {
    const manifest = makeManifest([
      makeAnnouncement("a"),
      makeAnnouncement("b"),
      makeAnnouncement("c"),
    ]);
    const next = removeAnnouncement(manifest, "b");

    expect(next.posts.map((p) => p.id)).toEqual(["a", "c"]);
    expect(manifest.posts.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});
