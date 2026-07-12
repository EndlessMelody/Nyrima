/**
 * Web replacement for the extension's background-service-worker OAuth broker.
 *
 * In the extension, the SW ran `chrome.identity.launchWebAuthFlow` and handed
 * tokens back to the app via `chrome.runtime.sendMessage({type:"AUTH_GET_TOKEN"})`.
 * The web app has no SW, so this module fulfils the same message contract using
 * a browser popup against Google's OAuth endpoint.
 *
 * Status: SKELETON. It implements the interactive popup token flow and an
 * in-memory + session cache, but production hardening (PKCE auth-code flow,
 * silent refresh, multi-account login hints) is deliberately left as TODOs —
 * see the migration plan. Crucially, when no OAuth Client ID is configured it
 * returns the same "not configured" error the SW did, so the existing API-key
 * path in `src/app/services/auth.ts` keeps the app fully usable for
 * "anyone-with-the-link" Drive folders without any OAuth at all.
 *
 * Configuration: a Client ID can come from either
 *   - `import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID` (build-time default), or
 *   - the per-account value the user pastes in Connect Drive (chrome.storage).
 * The redirect URI is `${origin}/auth/callback` (see `AuthCallbackPage`), which
 * must be registered as an Authorized redirect URI on a *Web* OAuth client.
 */

import {
  buildGoogleOAuthUrl,
  OAUTH_INTERACTIVE_TTL_MS,
} from "@shared/oauth-session";
import { GOOGLE_CLIENT_ID } from "@/config/googleOAuth";
import { STORAGE_KEYS } from "@shared/constants";
import type { DcResponse } from "@shared/messages";

const NEEDS_RECONSENT = "needs-reconsent";
const INTERACTIVE_AT_KEY = "dc.oauthInteractiveAt";
const TOKEN_SESSION_KEY = "dc.oauthAccessToken";

interface TokenEntry {
  token: string;
  expiresAt: number;
}

let memToken: TokenEntry | null = null;

function ok<T>(data: T): DcResponse<T> {
  return { ok: true, data };
}
function fail(error: string): DcResponse<never> {
  return { ok: false, error };
}

async function storedClientId(): Promise<string> {
  try {
    const obj = await chrome.storage.local.get(STORAGE_KEYS.OAUTH_CLIENT_ID);
    const v = obj[STORAGE_KEYS.OAUTH_CLIENT_ID];
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

/** Per-account BYOK client id wins; otherwise the app-wide env client id
 *  (centralized in `src/config/googleOAuth`). */
async function resolveClientId(): Promise<string> {
  return (await storedClientId()) || GOOGLE_CLIENT_ID;
}

function redirectUri(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/auth/callback`;
}

async function readInteractiveAt(): Promise<number | null> {
  try {
    const obj = await chrome.storage.local.get(INTERACTIVE_AT_KEY);
    const v = obj[INTERACTIVE_AT_KEY];
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

async function readPersistedToken(): Promise<TokenEntry | null> {
  try {
    const obj = await chrome.storage.session.get(TOKEN_SESSION_KEY);
    const entry = obj[TOKEN_SESSION_KEY] as TokenEntry | undefined;
    if (!entry || Date.now() >= entry.expiresAt) return null;
    return entry;
  } catch {
    return null;
  }
}

async function writePersistedToken(entry: TokenEntry | null): Promise<void> {
  try {
    if (entry) await chrome.storage.session.set({ [TOKEN_SESSION_KEY]: entry });
    else await chrome.storage.session.remove(TOKEN_SESSION_KEY);
  } catch {
    /* in-memory cache still works */
  }
}

/**
 * Open Google's consent screen in a popup and resolve with the implicit-flow
 * access token. The popup navigates to `${origin}/auth/callback#access_token=…`;
 * `AuthCallbackPage` posts the hash back to us via `postMessage`.
 */
function runPopupFlow(authUrl: string): Promise<TokenEntry> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("OAuth popup requires a browser context."));
      return;
    }
    const w = 480;
    const h = 640;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      authUrl,
      "nyrima-drive-oauth",
      `width=${w},height=${h},left=${left},top=${top}`,
    );
    if (!popup) {
      reject(new Error("Popup blocked. Allow popups and try Connect Drive again."));
      return;
    }

    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; params?: string } | null;
      if (!data || data.source !== "nyrima-oauth-callback") return;
      settled = true;
      cleanup();
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      const params = new URLSearchParams(data.params ?? "");
      const token = params.get("access_token");
      const expiresIn = parseInt(params.get("expires_in") || "3599", 10);
      if (!token) {
        reject(new Error(params.get("error") || "No access token returned."));
        return;
      }
      resolve({ token, expiresAt: Date.now() + (expiresIn - 300) * 1000 });
    };
    window.addEventListener("message", onMessage);
    const poll = window.setInterval(() => {
      if (popup.closed && !settled) {
        cleanup();
        reject(new Error("Sign-in was cancelled."));
      }
    }, 500);
  });
}

/** Fulfils `{type:"AUTH_GET_TOKEN", interactive}`. */
export async function getToken(interactive: boolean): Promise<DcResponse> {
  const clientId = await resolveClientId();
  if (!clientId) {
    return fail(
      "OAuth not configured. Open Settings → Connect Drive and paste your Google Cloud OAuth Client ID, or use an API key for public folders.",
    );
  }

  // Serve a warm token when we have one.
  if (memToken && Date.now() < memToken.expiresAt) return ok({ token: memToken.token });
  const persisted = await readPersistedToken();
  if (persisted) {
    memToken = persisted;
    return ok({ token: persisted.token });
  }

  // Enforce the same interactive-session ceiling the SW used.
  const interactiveAt = await readInteractiveAt();
  const expired =
    interactiveAt == null || Date.now() >= interactiveAt + OAUTH_INTERACTIVE_TTL_MS;
  if (!interactive) {
    // No cached token and we're not allowed to prompt → tell the caller to
    // (re)connect. auth.ts treats this as "show Connect Drive".
    return fail(expired ? NEEDS_RECONSENT : "No active Drive session.");
  }

  // Interactive: open the consent popup. TODO(prod): switch to the PKCE
  // auth-code flow with a token-exchange endpoint for refresh-token support.
  try {
    const authUrl = buildGoogleOAuthUrl({
      clientId,
      redirectUri: redirectUri(),
      interactive: true,
    });
    const entry = await runPopupFlow(authUrl);
    memToken = entry;
    await writePersistedToken(entry);
    await chrome.storage.local.set({ [INTERACTIVE_AT_KEY]: Date.now() });
    return ok({ token: entry.token });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Connect Drive failed.");
  }
}

/**
 * Persist a token obtained out-of-band by the web redirect flow
 * (`/auth/google/callback`, implicit token flow). Writes the same session +
 * interactive-timestamp records the Drive data layer reads via `getToken(false)`,
 * so after the callback navigates back, `authedFetch` picks the token up with no
 * further prompts. Mirrors the popup path's storage exactly.
 */
export async function ingestRedirectToken(args: {
  token: string;
  expiresInSec?: number;
}): Promise<void> {
  const expiresIn =
    typeof args.expiresInSec === "number" && Number.isFinite(args.expiresInSec)
      ? args.expiresInSec
      : 3599;
  const entry: TokenEntry = {
    token: args.token,
    // Refresh 5 minutes early, matching the popup flow.
    expiresAt: Date.now() + (expiresIn - 300) * 1000,
  };
  memToken = entry;
  await writePersistedToken(entry);
  try {
    await chrome.storage.local.set({ [INTERACTIVE_AT_KEY]: Date.now() });
  } catch {
    /* in-memory + session cache still serve the token this session */
  }
}

/** Fulfils `{type:"AUTH_REVOKE"}`. */
export async function revoke(): Promise<DcResponse> {
  memToken = null;
  await writePersistedToken(null);
  try {
    await chrome.storage.local.remove(INTERACTIVE_AT_KEY);
  } catch {
    /* ignore */
  }
  return ok({ revoked: true });
}
