import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Node env has no `chrome`. Install a minimal shim so importing the auth
 * module (and the api-key listener it pulls in) doesn't throw, and so
 * `tryGetAccessToken` can drive the AUTH_GET_TOKEN round-trip.
 *
 * `cachedToken` / `inflightToken` are module-level, so each test re-imports
 * the module fresh via `loadAuth()` to start from a clean cache.
 */
function installChrome(
  sendImpl: (msg: unknown) => Promise<unknown>,
): ReturnType<typeof vi.fn> {
  const sendMessage = vi.fn(sendImpl);
  vi.stubGlobal("chrome", {
    runtime: { sendMessage },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  return sendMessage;
}

async function loadAuth() {
  vi.resetModules();
  return import("./auth");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tryGetAccessToken", () => {
  it("coalesces concurrent non-interactive fetches into one round-trip", async () => {
    let resolveSend: (v: unknown) => void = () => {};
    const sendMessage = installChrome(
      () =>
        new Promise((res) => {
          resolveSend = res;
        }),
    );
    const { tryGetAccessToken } = await loadAuth();

    // Two callers hit the expired (empty) cache at once.
    const p1 = tryGetAccessToken();
    const p2 = tryGetAccessToken();

    // They must share a single in-flight AUTH_GET_TOKEN round-trip.
    expect(sendMessage).toHaveBeenCalledTimes(1);

    resolveSend({ ok: true, data: { token: "tok-123" } });
    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe("tok-123");
    expect(t2).toBe("tok-123");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("caches the token so a later call makes no further round-trip", async () => {
    const sendMessage = installChrome(async () => ({
      ok: true,
      data: { token: "tok-abc" },
    }));
    const { tryGetAccessToken } = await loadAuth();

    expect(await tryGetAccessToken()).toBe("tok-abc");
    expect(await tryGetAccessToken()).toBe("tok-abc");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight slot on failure so the next call retries", async () => {
    let call = 0;
    const sendMessage = installChrome(async () => {
      call += 1;
      if (call === 1) throw new Error("service worker asleep");
      return { ok: true, data: { token: "tok-retry" } };
    });
    const { tryGetAccessToken } = await loadAuth();

    expect(await tryGetAccessToken()).toBeNull();
    expect(await tryGetAccessToken()).toBe("tok-retry");
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
