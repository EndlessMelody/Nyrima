/**
 * Tests for share identity projection and handle validation. These are pure
 * protocol checks; chrome.storage-backed persistence is exercised manually in
 * the extension smoke test.
 */

import { describe, expect, it } from "vitest";
import type { ShareProfile } from "@shared/types";
import { profileToAuthor, validateShareHandle } from "./share-profile";

describe("validateShareHandle", () => {
  it("accepts the supported lower-case slug shapes", () => {
    expect(validateShareHandle("khoa")).toBeNull();
    expect(validateShareHandle("khoa_01")).toBeNull();
    expect(validateShareHandle("nyrima-fan")).toBeNull();
  });

  it("rejects empty, short, uppercase, spaced, and symbol-heavy handles", () => {
    expect(validateShareHandle("")).toBe("Pick a handle.");
    expect(validateShareHandle("ab")).toBe("At least 3 characters.");
    expect(validateShareHandle("Khoa")).toContain("Lower-case");
    expect(validateShareHandle("khoa sama")).toContain("Lower-case");
    expect(validateShareHandle("@khoa")).toContain("Lower-case");
  });

  it("rejects handles longer than 32 characters", () => {
    expect(validateShareHandle("a".repeat(33))).toBe("At most 32 characters.");
  });
});

describe("profileToAuthor", () => {
  it("drops persistence-only fields before stamping wire payloads", () => {
    const profile: ShareProfile = {
      v: 1,
      handle: "khoa",
      name: "Dang Khoa",
      avatarUrl: "https://lh3.googleusercontent.com/a/example",
      updatedAt: "2026-05-20T05:00:00.000Z",
    };

    expect(profileToAuthor(profile)).toEqual({
      handle: "khoa",
      name: "Dang Khoa",
      avatarUrl: "https://lh3.googleusercontent.com/a/example",
    });
  });
});
