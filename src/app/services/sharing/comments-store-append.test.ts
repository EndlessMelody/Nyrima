/**
 * Queue-level tests for `appendComment`. Drive has no append primitive, so the
 * service must serialize local download + update calls to avoid dropping lines.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareComment } from "@shared/types";

const driveState = vi.hoisted(() => ({
  text: null as string | null,
}));

vi.mock("../drive-api", () => {
  const delay = () => new Promise((resolve) => setTimeout(resolve, 1));

  return {
    findChildByName: vi.fn(async () =>
      driveState.text === null
        ? null
        : { id: "comments-file", name: "comments.jsonl" },
    ),
    downloadTextFile: vi.fn(async () => driveState.text ?? ""),
    uploadTextFile: vi.fn(
      async (
        _parentId: string,
        _name: string,
        text: string,
      ) => {
        await delay();
        driveState.text = text;
        return { id: "comments-file" };
      },
    ),
    updateTextFile: vi.fn(async (_fileId: string, text: string) => {
      await delay();
      driveState.text = text;
      return { id: "comments-file" };
    }),
  };
});

import { appendComment, parseCommentsJsonl } from "./comments-store";

function makeComment(id: string): ShareComment {
  return {
    v: 1,
    id,
    sharedFolderId: "owner-folder",
    shareId: "share-1",
    at: "2026-05-20T05:00:00.000Z",
    author: { handle: "alice" },
    text: `comment ${id}`,
  };
}

beforeEach(() => {
  driveState.text = null;
});

describe("appendComment", () => {
  it("serializes concurrent local appends so both JSONL lines survive", async () => {
    await Promise.all([
      appendComment("my-shared-folder", makeComment("a")),
      appendComment("my-shared-folder", makeComment("b")),
    ]);

    expect(parseCommentsJsonl(driveState.text ?? "").map((c) => c.id).sort()).toEqual([
      "a",
      "b",
    ]);
  });
});
