/**
 * Tests for the directory-payload sanitizer. The maintained JSON file
 * sits on a public GitHub URL — anything malformed in a future merge
 * (typo in a PR, schema drift across versions) must not crash the
 * Discover rail.
 *
 * Pure function; runs in the default vitest node env.
 */

import { describe, expect, it } from "vitest";
import { sanitizeDirectory } from "./directory";

const FOLDER_A = "1AbCdEfGhIjKlMnOpQrStUvWxYz_01";
const FOLDER_B = "2AbCdEfGhIjKlMnOpQrStUvWxYz_02";
const FOLDER_C = "3AbCdEfGhIjKlMnOpQrStUvWxYz_03";

describe("sanitizeDirectory", () => {
  it("returns [] for non-array roots", () => {
    expect(sanitizeDirectory(null)).toEqual([]);
    expect(sanitizeDirectory(undefined)).toEqual([]);
    expect(sanitizeDirectory({})).toEqual([]);
    expect(sanitizeDirectory("oops")).toEqual([]);
    expect(sanitizeDirectory(42)).toEqual([]);
  });

  it("passes a well-formed entry through unchanged", () => {
    const raw = [
      {
        v: 1,
        handle: "khoa",
        name: "Đăng Khoa",
        folderId: FOLDER_A,
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        bio: "Blu-ray anime",
        tags: ["anime", "blu-ray"],
        addedAt: "2026-05-19",
      },
    ];
    const out = sanitizeDirectory(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      handle: "khoa",
      folderId: FOLDER_A,
      tags: ["anime", "blu-ray"],
    });
  });

  it("drops entries with the wrong v", () => {
    const raw = [
      { v: 2, handle: "future", folderId: FOLDER_A, addedAt: "2026-01-01" },
      { v: 1, handle: "now", folderId: FOLDER_B, addedAt: "2026-01-01" },
    ];
    expect(sanitizeDirectory(raw).map((e) => e.handle)).toEqual(["now"]);
  });

  it("drops entries missing required fields", () => {
    const raw = [
      { v: 1, folderId: FOLDER_A, addedAt: "2026-01-01" }, // no handle
      { v: 1, handle: "hey", addedAt: "2026-01-01" }, // no folderId
      { v: 1, handle: "two", folderId: FOLDER_B }, // no addedAt
      { v: 1, handle: "okay", folderId: FOLDER_C, addedAt: "2026-01-01" },
    ];
    expect(sanitizeDirectory(raw).map((e) => e.handle)).toEqual(["okay"]);
  });

  it("dedupes by handle, keeping the first", () => {
    const raw = [
      { v: 1, handle: "dup", folderId: FOLDER_A, addedAt: "2026-01-01" },
      { v: 1, handle: "dup", folderId: FOLDER_B, addedAt: "2026-02-01" },
      { v: 1, handle: "other", folderId: FOLDER_C, addedAt: "2026-01-01" },
    ];
    const out = sanitizeDirectory(raw);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.handle === "dup")?.folderId).toBe(FOLDER_A);
  });

  it("strips non-string tags but keeps the valid ones", () => {
    const raw = [
      {
        v: 1,
        handle: "han",
        folderId: FOLDER_A,
        addedAt: "2026-01-01",
        tags: ["Anime", 42, null, "blu-ray", "<script>"],
      },
    ];
    const out = sanitizeDirectory(raw);
    expect(out[0].tags).toEqual(["anime", "blu-ray"]);
  });

  it("treats non-string optional fields as undefined", () => {
    const raw = [
      {
        v: 1,
        handle: "han",
        folderId: FOLDER_A,
        addedAt: "2026-01-01",
        name: 42,
        avatarUrl: { not: "a string" },
        bio: ["array"],
      },
    ];
    const out = sanitizeDirectory(raw);
    expect(out[0].name).toBeUndefined();
    expect(out[0].avatarUrl).toBeUndefined();
    expect(out[0].bio).toBeUndefined();
  });

  it("survives an array with garbage entries mixed in", () => {
    const raw = [
      null,
      "oops",
      42,
      { v: 1, handle: "good", folderId: FOLDER_A, addedAt: "2026-01-01" },
      undefined,
    ];
    const out = sanitizeDirectory(raw);
    expect(out.map((e) => e.handle)).toEqual(["good"]);
  });

  it("drops tags entirely when the field isn't an array", () => {
    const raw = [
      {
        v: 1,
        handle: "han",
        folderId: FOLDER_A,
        addedAt: "2026-01-01",
        tags: "anime,blu-ray", // user mistakenly used a string
      },
    ];
    const out = sanitizeDirectory(raw);
    expect(out[0].tags).toBeUndefined();
  });

  it("drops entries with invalid handles, folder ids, dates, and avatar hosts", () => {
    const raw = [
      { v: 1, handle: "NOPE", folderId: FOLDER_A, addedAt: "2026-01-01" },
      { v: 1, handle: "badfolder", folderId: "short", addedAt: "2026-01-01" },
      { v: 1, handle: "baddate", folderId: FOLDER_B, addedAt: "soon" },
      {
        v: 1,
        handle: "goodone",
        folderId: FOLDER_C,
        addedAt: "2026-01-01",
        avatarUrl: "https://example.com/a.png",
      },
    ];
    const out = sanitizeDirectory(raw);
    expect(out).toHaveLength(1);
    expect(out[0].handle).toBe("goodone");
    expect(out[0].avatarUrl).toBeUndefined();
  });
});
