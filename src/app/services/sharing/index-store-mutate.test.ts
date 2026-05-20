/**
 * Queue-level tests for `mutateShareIndex`. The Drive API is mocked so we can
 * simulate two local read-modify-write calls racing against one manifest.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareEntry, ShareIndex } from "@shared/types";

const driveState = vi.hoisted(() => ({
  index: null as ShareIndex | null,
}));

vi.mock("../drive-api", () => {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const delay = () => new Promise((resolve) => setTimeout(resolve, 1));

  return {
    findChildByName: vi.fn(async () =>
      driveState.index ? { id: "index-file", name: "index.json" } : null,
    ),
    downloadJsonFile: vi.fn(async () => clone(driveState.index)),
    updateJsonFile: vi.fn(async (_fileId: string, data: ShareIndex) => {
      await delay();
      driveState.index = clone(data);
      return { id: "index-file" };
    }),
    uploadJsonFile: vi.fn(
      async (_parentId: string, _name: string, data: ShareIndex) => {
        await delay();
        driveState.index = clone(data);
        return { id: "index-file" };
      },
    ),
  };
});

import { mutateShareIndex } from "./index-store";

const owner = { handle: "alice" };

function makeEntry(id: string): ShareEntry {
  return {
    id,
    v: 2,
    sharedAt: "2026-05-20T05:00:00.000Z",
    updatedAt: "2026-05-20T05:00:00.000Z",
    target: { kind: "video", fileId: `file-${id}` },
    title: id,
  };
}

function addEntry(current: ShareIndex | null, entry: ShareEntry): ShareIndex {
  return {
    v: 2,
    owner,
    updatedAt: "2026-05-20T05:00:00.000Z",
    entries: [entry, ...(current?.entries ?? [])],
  };
}

beforeEach(() => {
  driveState.index = null;
});

describe("mutateShareIndex", () => {
  it("serializes concurrent local mutations so both entries survive", async () => {
    await Promise.all([
      mutateShareIndex("shared-folder", (current) =>
        addEntry(current, makeEntry("a")),
      ),
      mutateShareIndex("shared-folder", (current) =>
        addEntry(current, makeEntry("b")),
      ),
    ]);

    expect(driveState.index?.entries.map((e) => e.id).sort()).toEqual([
      "a",
      "b",
    ]);
  });
});
