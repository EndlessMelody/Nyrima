import { describe, expect, it } from "vitest";
import {
  AUTHENTICATED_CAPABILITIES,
  GUEST_CAPABILITIES,
  capabilitiesFor,
  hasCapability,
} from "./capabilities";

describe("capabilities", () => {
  it("gives unauthenticated sessions nothing", () => {
    expect(capabilitiesFor("unauthenticated")).toEqual([]);
    expect(capabilitiesFor("loading")).toEqual([]);
  });

  it("gives guests watch-only, local capabilities", () => {
    const caps = capabilitiesFor("guest");
    expect(caps).toEqual([...GUEST_CAPABILITIES]);
    // Allowed: Drive + player + local storage.
    expect(hasCapability(caps, "drive:connect")).toBe(true);
    expect(hasCapability(caps, "player:watch")).toBe(true);
    expect(hasCapability(caps, "history:local")).toBe(true);
    expect(hasCapability(caps, "settings:local")).toBe(true);
  });

  it("denies guests every social and cloud capability", () => {
    const caps = capabilitiesFor("guest");
    for (const cap of [
      "social:profile",
      "social:friends",
      "social:comments",
      "social:activity",
      "history:cloud",
      "settings:cloud",
      "sync:cloud",
    ]) {
      expect(hasCapability(caps, cap)).toBe(false);
    }
  });

  it("gives authenticated sessions the full set including social", () => {
    const caps = capabilitiesFor("authenticated");
    expect(caps).toEqual([...AUTHENTICATED_CAPABILITIES]);
    expect(hasCapability(caps, "social:profile")).toBe(true);
    expect(hasCapability(caps, "social:friends")).toBe(true);
    expect(hasCapability(caps, "social:comments")).toBe(true);
    expect(hasCapability(caps, "sync:cloud")).toBe(true);
  });

  it("authenticated is a strict superset of guest", () => {
    for (const cap of GUEST_CAPABILITIES) {
      expect(hasCapability(AUTHENTICATED_CAPABILITIES, cap)).toBe(true);
    }
  });
});
