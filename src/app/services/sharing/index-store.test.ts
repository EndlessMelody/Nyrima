/**
 * Tests for the pure manifest helpers that back `Shared/index.json`.
 * Drive reads/writes are covered by manual smoke tests; these checks keep
 * the local protocol rules stable before bytes ever touch Drive.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import type { ShareEntry, ShareIndex } from "@shared/types";
import {
  generateShareId,
  prependIndexEntry,
  removeIndexEntry,
  sanitizeShareIndex,
} from "./index-store";

const NOW = new Date("2026-05-20T05:00:00.000Z");
const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_01";
const FOLDER_ID = "2AbCdEfGhIjKlMnOpQrStUvWxYz_02";

function makeEntry(id: string, title = id): ShareEntry {
  return {
    id,
    v: 2,
    sharedAt: `2026-05-20T04:0${id.length}:00.000Z`,
    updatedAt: `2026-05-20T04:0${id.length}:00.000Z`,
    target: { kind: "video", fileId: `file-${id}`, folderId: "folder-1" },
    title,
  };
}

function makeIndex(entries: ShareEntry[]): ShareIndex {
  return {
    v: 2,
    owner: { handle: "alice", name: "Alice" },
    updatedAt: "2026-05-20T04:00:00.000Z",
    entries,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("prependIndexEntry", () => {
  it("puts the newest entry first and refreshes updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const index = makeIndex([makeEntry("a"), makeEntry("b")]);
    const next = prependIndexEntry(index, makeEntry("c"));

    expect(next.entries.map((e) => e.id)).toEqual(["c", "a", "b"]);
    expect(next.updatedAt).toBe(NOW.toISOString());
    expect(index.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("dedupes by id and keeps the replacement payload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const index = makeIndex([makeEntry("a", "old"), makeEntry("b")]);
    const next = prependIndexEntry(index, makeEntry("a", "new"));

    expect(next.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(next.entries[0].title).toBe("new");
  });
});

describe("removeIndexEntry", () => {
  it("removes a share entry without mutating the original index", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const index = makeIndex([makeEntry("a"), makeEntry("b"), makeEntry("c")]);
    const next = removeIndexEntry(index, "b");

    expect(next.entries.map((e) => e.id)).toEqual(["a", "c"]);
    expect(next.updatedAt).toBe(NOW.toISOString());
    expect(index.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op on entries when the id is missing", () => {
    const index = makeIndex([makeEntry("a")]);
    const next = removeIndexEntry(index, "missing");

    expect(next.entries).toEqual(index.entries);
  });
});

describe("generateShareId", () => {
  it("returns a non-empty id suitable for manifest keys", () => {
    expect(generateShareId()).toEqual(expect.any(String));
    expect(generateShareId().length).toBeGreaterThan(8);
  });
});

describe("sanitizeShareIndex", () => {
  it("keeps a well-formed public manifest", () => {
    const index = sanitizeShareIndex({
      v: 2,
      owner: {
        handle: "alice",
        name: "Alice",
        avatarUrl: "https://lh3.googleusercontent.com/a/avatar",
      },
      updatedAt: "2026-05-20T04:00:00.000Z",
      entries: [
        {
          id: "share-1",
          v: 2,
          sharedAt: "2026-05-20T04:01:00.000Z",
          updatedAt: "2026-05-20T04:02:00.000Z",
          target: { kind: "video", fileId: FILE_ID, folderId: FOLDER_ID },
          title: "Episode 1",
          caption: "Good cut.",
          posterUrl:
            "https://lh3.googleusercontent.com/drive-storage/poster=s1600",
        },
      ],
    });

    expect(index).toMatchObject({
      owner: { handle: "alice", name: "Alice" },
      entries: [
        {
          id: "share-1",
          target: { kind: "video", fileId: FILE_ID, folderId: FOLDER_ID },
          title: "Episode 1",
        },
      ],
    });
  });

  it("rejects roots without a valid owner or entries list", () => {
    expect(sanitizeShareIndex({ v: 2, entries: [] })).toBeNull();
    expect(
      sanitizeShareIndex({
        v: 2,
        owner: { handle: "alice" },
        updatedAt: "2026-05-20T04:00:00.000Z",
        entries: "bad",
      }),
    ).toBeNull();
  });

  it("drops malformed entries and unsafe optional image URLs", () => {
    const index = sanitizeShareIndex({
      v: 2,
      owner: {
        handle: "alice",
        avatarUrl: "javascript:alert(1)",
      },
      updatedAt: "2026-05-20T04:00:00.000Z",
      entries: [
        {
          id: "bad-target",
          v: 2,
          sharedAt: "2026-05-20T04:01:00.000Z",
          updatedAt: "2026-05-20T04:01:00.000Z",
          target: { kind: "video", fileId: "short" },
        },
        {
          id: "good-library",
          v: 2,
          sharedAt: "2026-05-20T04:02:00.000Z",
          updatedAt: "2026-05-20T04:02:00.000Z",
          target: { kind: "library", folderId: FOLDER_ID },
          posterUrl: "https://example.com/not-drive.png",
        },
      ],
    });

    expect(index?.owner.avatarUrl).toBeUndefined();
    expect(index?.entries).toEqual([
      expect.objectContaining({
        id: "good-library",
        target: { kind: "library", folderId: FOLDER_ID },
        posterUrl: undefined,
      }),
    ]);
  });
});
