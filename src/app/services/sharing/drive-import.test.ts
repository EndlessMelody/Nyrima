import { describe, expect, it } from "vitest";
import type { DriveFile } from "@shared/types";
import {
  buildImportFolderName,
  sanitizeImportFolderName,
  shouldCopyVideoCompanion,
} from "./drive-import";

const file = (
  name: string,
  mimeType = "text/plain",
  id = name,
): DriveFile => ({
  id,
  name,
  mimeType,
});

describe("sanitizeImportFolderName", () => {
  it("keeps Drive folder names readable while removing path-hostile chars", () => {
    expect(sanitizeImportFolderName('A/B: "Final" <OVA>?')).toBe(
      "A B Final OVA",
    );
  });

  it("falls back for empty titles", () => {
    expect(sanitizeImportFolderName("  ")).toBe("Imported share");
  });
});

describe("buildImportFolderName", () => {
  it("adds a stable timestamp suffix", () => {
    expect(
      buildImportFolderName("Frieren", new Date(2026, 4, 20, 7, 8)),
    ).toBe("Frieren - 2026-05-20 0708");
  });
});

describe("shouldCopyVideoCompanion", () => {
  it("copies matching subtitles and folder posters for a shared video", () => {
    expect(
      shouldCopyVideoCompanion(
        "Episode 01.mkv",
        file("Episode 01.en.ass", "text/x-ass"),
      ),
    ).toBe(true);
    expect(
      shouldCopyVideoCompanion("Episode 01.mkv", file("Poster.webp", "image/webp")),
    ).toBe(true);
  });

  it("ignores unrelated subtitles and folders", () => {
    expect(
      shouldCopyVideoCompanion(
        "Episode 01.mkv",
        file("Episode 02.en.ass", "text/x-ass"),
      ),
    ).toBe(false);
    expect(
      shouldCopyVideoCompanion(
        "Episode 01.mkv",
        file("Season 01", "application/vnd.google-apps.folder"),
      ),
    ).toBe(false);
  });
});
