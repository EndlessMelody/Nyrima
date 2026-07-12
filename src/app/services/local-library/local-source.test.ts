import { describe, expect, it } from "vitest";
import { toLocalFileId, toLocalFolderId } from "@shared/local-id";
import { QUICK_OPEN_REL_PATH, isQuickOpenPath, localLibrary } from "./local-source";

describe("isQuickOpenPath", () => {
  it("matches the quick-open root and any path beneath it", () => {
    expect(isQuickOpenPath(QUICK_OPEN_REL_PATH)).toBe(true);
    expect(isQuickOpenPath(`${QUICK_OPEN_REL_PATH}/Episode 01.mkv-100-1`)).toBe(true);
  });

  it("does not match real library paths, including ones sharing the prefix", () => {
    expect(isQuickOpenPath("")).toBe(false);
    expect(isQuickOpenPath("Movies/Episode 01.mkv")).toBe(false);
    expect(isQuickOpenPath(`${QUICK_OPEN_REL_PATH}-extra`)).toBe(false);
  });
});

describe("LocalLibraryRuntime quick-open support", () => {
  it("listEntries short-circuits to [] for a quick-open folder id without a connected root", async () => {
    const folderId = toLocalFolderId(QUICK_OPEN_REL_PATH);
    await expect(localLibrary.listEntries(folderId)).resolves.toEqual([]);
  });

  it("resolveFile returns a registered session file without a connected root", async () => {
    const file = new File(["x"], "Episode 01.mkv");
    const localId = toLocalFileId(`${QUICK_OPEN_REL_PATH}/Episode 01.mkv-${file.size}-${file.lastModified}`);

    localLibrary.registerSessionFile(localId, file);

    await expect(localLibrary.resolveFile(localId)).resolves.toBe(file);
  });
});
