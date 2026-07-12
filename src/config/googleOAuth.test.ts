import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Node env has no `window`/`sessionStorage`. Install a Map-backed sessionStorage
 * on a fake `window` with a fixed origin so the redirect + state helpers run
 * their real paths. Modules are re-imported per test (env/consts are read at
 * import time).
 */
function installWindow(origin = "http://localhost:5173"): Map<string, string> {
  const map = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  vi.stubGlobal("window", { location: { origin }, sessionStorage });
  return map;
}

async function loadConfig() {
  vi.resetModules();
  return import("./googleOAuth");
}

describe("googleOAuth config", () => {
  beforeEach(() => {
    installWindow();
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
    vi.stubEnv("VITE_GOOGLE_OAUTH_REDIRECT_URI", "");
    vi.stubEnv("VITE_GOOGLE_DRIVE_SCOPE", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("derives the redirect URI from the window origin when env is unset", async () => {
    const { GOOGLE_OAUTH_REDIRECT_URI } = await loadConfig();
    expect(GOOGLE_OAUTH_REDIRECT_URI).toBe(
      "http://localhost:5173/auth/google/callback",
    );
  });

  it("honors an explicit redirect URI env var", async () => {
    vi.stubEnv(
      "VITE_GOOGLE_OAUTH_REDIRECT_URI",
      "https://nyrima.app/auth/google/callback",
    );
    const { GOOGLE_OAUTH_REDIRECT_URI } = await loadConfig();
    expect(GOOGLE_OAUTH_REDIRECT_URI).toBe(
      "https://nyrima.app/auth/google/callback",
    );
  });

  it("defaults to the least-privilege drive.readonly scope", async () => {
    const { GOOGLE_DRIVE_SCOPES } = await loadConfig();
    expect(GOOGLE_DRIVE_SCOPES).toEqual([
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
  });

  it("builds a frontend-only implicit-token auth URL with state", async () => {
    const { getGoogleOAuthUrl, parseOAuthState } = await loadConfig();
    const url = new URL(getGoogleOAuthUrl({ mode: "guest", returnTo: "/app" }));

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("response_type")).toBe("token");
    expect(url.searchParams.get("client_id")).toBe(
      "test-client.apps.googleusercontent.com",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/auth/google/callback",
    );
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.readonly",
    );
    // No client secret should ever appear in the URL the browser builds.
    expect(url.searchParams.has("client_secret")).toBe(false);

    const state = parseOAuthState(url.searchParams.get("state"));
    expect(state?.mode).toBe("guest");
    expect(state?.returnTo).toBe("/app");
    expect(typeof state?.nonce).toBe("string");
  });

  it("round-trips + single-uses the CSRF nonce", async () => {
    const { getGoogleOAuthUrl, parseOAuthState, consumeOAuthNonce } =
      await loadConfig();
    const url = new URL(getGoogleOAuthUrl({ mode: "authenticated" }));
    const state = parseOAuthState(url.searchParams.get("state"))!;

    // First consume matches; second fails (single use).
    expect(consumeOAuthNonce(state.nonce)).toBe(true);
    expect(consumeOAuthNonce(state.nonce)).toBe(false);
  });

  it("falls back to crypto.getRandomValues for a hex nonce when randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        arr.set(Uint8Array.from({ length: arr.length }, (_, i) => i));
        return arr;
      },
    });
    const { getGoogleOAuthUrl, parseOAuthState } = await loadConfig();
    const url = new URL(getGoogleOAuthUrl({ mode: "guest" }));
    const state = parseOAuthState(url.searchParams.get("state"));
    expect(state?.nonce).toBe("000102030405060708090a0b0c0d0e0f");
  });

  it("rejects a wrong nonce and malformed state", async () => {
    const { getGoogleOAuthUrl, consumeOAuthNonce, parseOAuthState } =
      await loadConfig();
    getGoogleOAuthUrl({ mode: "guest" }); // stores a nonce
    expect(consumeOAuthNonce("not-the-nonce")).toBe(false);
    expect(parseOAuthState("@@not-base64@@")).toBeNull();
    expect(parseOAuthState(null)).toBeNull();
  });

  it("accepts a BYOK client id override", async () => {
    const { getGoogleOAuthUrl } = await loadConfig();
    const url = new URL(
      getGoogleOAuthUrl({ clientId: "byok.apps.googleusercontent.com" }),
    );
    expect(url.searchParams.get("client_id")).toBe(
      "byok.apps.googleusercontent.com",
    );
  });
});
