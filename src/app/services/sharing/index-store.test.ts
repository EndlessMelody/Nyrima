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
} from "./index-store";

const NOW = new Date("2026-05-20T05:00:00.000Z");

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
