import { describe, expect, it } from "vitest";
import {
  buildGoogleOAuthUrl,
  getStoredOAuthLoginHint,
  isOAuthInteractiveSessionExpired,
  OAUTH_INTERACTIVE_SESSION_HOURS,
  OAUTH_INTERACTIVE_TTL_MS,
} from "./oauth-session";

describe("OAuth session policy", () => {
  it("keeps the interactive session alive for 72 hours", () => {
    const interactiveAt = Date.UTC(2026, 4, 22, 12);

    expect(OAUTH_INTERACTIVE_SESSION_HOURS).toBe(72);
    expect(
      isOAuthInteractiveSessionExpired(
        interactiveAt,
        interactiveAt + OAUTH_INTERACTIVE_TTL_MS - 1,
      ),
    ).toBe(false);
    expect(
      isOAuthInteractiveSessionExpired(
        interactiveAt,
        interactiveAt + OAUTH_INTERACTIVE_TTL_MS,
      ),
    ).toBe(true);
  });
});

describe("buildGoogleOAuthUrl", () => {
  it("hints the stored Google account during silent token refresh", () => {
    const url = new URL(
      buildGoogleOAuthUrl({
        clientId: "nyrima.apps.googleusercontent.com",
        redirectUri: "https://nyrima.chromiumapp.org/",
        interactive: false,
        loginHint: "viewer@example.com",
      }),
    );

    expect(url.searchParams.get("response_type")).toBe("token");
    expect(url.searchParams.get("prompt")).toBe("none");
    expect(url.searchParams.get("login_hint")).toBe("viewer@example.com");
  });
});

describe("getStoredOAuthLoginHint", () => {
  it("reads the cached Drive profile email for a future silent refresh", () => {
    expect(
      getStoredOAuthLoginHint({
        profile: { email: " viewer@example.com " },
        fetchedAt: Date.UTC(2026, 4, 22),
      }),
    ).toBe("viewer@example.com");
  });
});
