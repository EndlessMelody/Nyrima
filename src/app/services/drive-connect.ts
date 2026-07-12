/**
 * Start the Drive OAuth connect as a full-page web redirect.
 *
 * This is the single entry point every "Connect Google Drive" affordance calls
 * (Connect-Drive screen, User Center, player error). It resolves the client id
 * (per-account BYOK first, then the app-wide env client id), then navigates the
 * browser to Google's consent screen. Google returns to
 * `/auth/google/callback` (see `AuthGoogleCallbackPage`) which stores the token.
 *
 * Works identically for guest and authenticated sessions — the mode is recorded
 * in the OAuth `state` so the callback returns to the right place and keeps a
 * guest a guest. OAuth here is Drive-access-only; it never creates a Nyrima
 * account.
 */

import { getOAuthClientId } from "./oauth-key";
import { isGuestSession } from "@/auth/guestSession";
import {
  GOOGLE_CLIENT_ID,
  getGoogleOAuthUrl,
  type OAuthMode,
} from "@/config/googleOAuth";

export class DriveConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveConnectError";
  }
}

export interface StartDriveConnectOptions {
  /** In-app path to return to after consent. Defaults to /app. */
  returnTo?: string;
  /** Override the mode; defaults to the live session (guest vs authenticated). */
  mode?: OAuthMode;
}

/**
 * Navigate to Google's consent screen. On success this never returns (the page
 * unloads). Throws `DriveConnectError` only when no client id is configured, so
 * callers can surface a setup hint.
 */
export async function startDriveConnect(
  opts: StartDriveConnectOptions = {},
): Promise<void> {
  const byok = (await getOAuthClientId())?.trim();
  const clientId = byok || GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new DriveConnectError(
      "Google Drive isn't configured. Set VITE_GOOGLE_CLIENT_ID, or paste your own OAuth Client ID in Settings.",
    );
  }

  const mode: OAuthMode =
    opts.mode ?? (isGuestSession() ? "guest" : "authenticated");
  const returnTo = opts.returnTo ?? "/app";

  if (typeof window === "undefined") {
    throw new DriveConnectError("Drive connect requires a browser context.");
  }
  window.location.href = getGoogleOAuthUrl({ mode, returnTo, clientId });
}
