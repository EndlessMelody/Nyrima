import { describe, expect, it } from "vitest";
import {
  LOCAL_ROOT_FOLDER_ID,
  isLocalId,
  parseLocalId,
  toLocalFileId,
  toLocalFolderId,
} from "./local-id";

describe("local-id", () => {
  it("round-trips simple relative paths", () => {
    const id = toLocalFileId("Movies/Show/Episode 01.mkv");
    expect(isLocalId(id)).toBe(true);
    expect(parseLocalId(id)).toBe("Movies/Show/Episode 01.mkv");
  });

  it("round-trips unicode and special characters", () => {
    const path = "Music/葬送のフリーレン/01 - テーマ曲 (Live).flac";
    const id = toLocalFileId(path);
    expect(parseLocalId(id)).toBe(path);
  });

  it("normalizes backslashes and surrounding slashes", () => {
    const id = toLocalFileId("\\Movies\\Show\\Episode 01.mkv\\");
    expect(parseLocalId(id)).toBe("Movies/Show/Episode 01.mkv");
  });

  it("produces URL-safe ids with no padding", () => {
    const id = toLocalFileId("a/b/c.mkv");
    expect(id).toMatch(/^local-[A-Za-z0-9_-]+$/);
    expect(id).not.toContain("=");
  });

  it("maps the empty/root path to LOCAL_ROOT_FOLDER_ID", () => {
    expect(toLocalFolderId("")).toBe(LOCAL_ROOT_FOLDER_ID);
    expect(toLocalFolderId("/")).toBe(LOCAL_ROOT_FOLDER_ID);
    expect(parseLocalId(LOCAL_ROOT_FOLDER_ID)).toBe("");
  });

  it("round-trips non-root folder paths", () => {
    const id = toLocalFolderId("Light Novel/Series");
    expect(parseLocalId(id)).toBe("Light Novel/Series");
  });

  it("rejects non-local ids", () => {
    expect(isLocalId("1AbCdEfGhIjKlMnOp")).toBe(false);
    expect(isLocalId("local-")).toBe(false);
    expect(parseLocalId("1AbCdEfGhIjKlMnOp")).toBeNull();
  });
});
