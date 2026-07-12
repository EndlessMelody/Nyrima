import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUEST_SESSION_KEY,
  clearGuestSession,
  getGuestSession,
  isGuestSession,
  startGuestSession,
} from "./guestSession";

/**
 * The default vitest environment is Node, which has no `window`/`localStorage`.
 * Install a minimal Map-backed `localStorage` on a fake `window` so the helper
 * exercises its real persistence path under test.
 */
function installFakeStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const fake = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  vi.stubGlobal("window", { localStorage: fake });
  return map;
}

describe("guestSession", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installFakeStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("startGuestSession persists a well-formed guest marker", () => {
    const session = startGuestSession();

    expect(session.mode).toBe("guest");
    expect(session.id).toBe("guest-local");
    expect(session.displayName).toBe("Guest");
    expect(typeof session.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(session.createdAt))).toBe(false);

    // It is actually written under the agreed-upon key.
    expect(store.has(GUEST_SESSION_KEY)).toBe(true);
    expect(JSON.parse(store.get(GUEST_SESSION_KEY)!)).toEqual(session);
  });

  it("getGuestSession round-trips the started session", () => {
    const started = startGuestSession();
    expect(getGuestSession()).toEqual(started);
    expect(isGuestSession()).toBe(true);
  });

  it("getGuestSession returns null when nothing is stored", () => {
    expect(getGuestSession()).toBeNull();
    expect(isGuestSession()).toBe(false);
  });

  it("getGuestSession drops a broken (unparseable) value and returns null", () => {
    store.set(GUEST_SESSION_KEY, "{not valid json");
    expect(getGuestSession()).toBeNull();
    expect(store.has(GUEST_SESSION_KEY)).toBe(false);
  });

  it("getGuestSession rejects a structurally-wrong value", () => {
    store.set(GUEST_SESSION_KEY, JSON.stringify({ mode: "authenticated" }));
    expect(getGuestSession()).toBeNull();
    expect(store.has(GUEST_SESSION_KEY)).toBe(false);
  });

  it("clearGuestSession removes the marker", () => {
    startGuestSession();
    clearGuestSession();
    expect(getGuestSession()).toBeNull();
    expect(store.has(GUEST_SESSION_KEY)).toBe(false);
  });

  it("is a no-op (no throw) when no DOM is present", () => {
    vi.unstubAllGlobals(); // remove the fake window → typeof window === "undefined"
    expect(() => startGuestSession()).not.toThrow();
    expect(getGuestSession()).toBeNull();
    expect(isGuestSession()).toBe(false);
    expect(() => clearGuestSession()).not.toThrow();
  });
});
