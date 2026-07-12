/**
 * Frontend auth helper.
 *
 * Nyrima supports two auth modes, layered:
 *
 *   1. OAuth (preferred when configured) — for users who provided their own
 *      Google Cloud OAuth Client ID via the User Center. Requests are billed
 *      against the user's personal quota, so Drive doesn't throttle them as
 *      "video-hosting" abuse.
 *
 *   2. API key (fallback) — for "Anyone with the link" folders or when the
 *      OAuth flow fails. Stored via api-key.ts in chrome.storage.local.
 *      Subject to Drive's strict public quota.
 *
 * authedFetch tries OAuth first when a token is available, then falls back
 * to the API key on auth failure. If neither path works it throws a typed
 * DriveAccessError so the UI can show "Setup access" or "Connect Drive".
 */

import type { DcResponse } from "@shared/messages";
import { getApiKey, appendApiKey } from "./api-key";
import { getOAuthClientId } from "./oauth-key";
import { isGoogleOAuthConfigured } from "@/config/googleOAuth";
import { classifyDriveError, DriveAccessError } from "./errors";
import { driveQueue } from "./drive/request-queue";
import { trackRequest } from "./drive/dev-mode";
import { debugLog } from "./debug-log";
import type { RequestOptions } from "./drive/types";
import { OAUTH_INTERACTIVE_TTL_MS } from "@shared/oauth-session";

let cachedToken: { value: string; fetchedAt: number } | null = null;
// Coalesces concurrent non-interactive token fetches into one round-trip.
let inflightToken: Promise<string | null> | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000; // chrome.identity tokens last ~60min

// Mirrors the SW-side INTERACTIVE_AT_KEY. Read-only on this side: the SW writes
// it on every successful interactive consent, the frontend reads it to decide
// whether to show "Connect Drive" vs "Session expired — sign in again".
const INTERACTIVE_AT_KEY = "dc.oauthInteractiveAt";

/** Sentinel the SW throws past the interactive ceiling. */
const NEEDS_RECONSENT = "needs-reconsent";

/**
 * Try to fetch an OAuth token. Returns null when OAuth isn't configured in
 * the manifest (or the user hasn't consented yet and we don't want to prompt).
 *
 * Past the interactive ceiling, the SW throws NEEDS_RECONSENT; we drop
 * our cached token and return null. Callers that care about the difference
 * between "never signed in" and "session expired" can read getOAuthSessionState.
 */
export async function tryGetAccessToken(
  interactive = false,
): Promise<string | null> {
  if (cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_TTL_MS) {
    return cachedToken.value;
  }
  // Interactive requests ("Connect Drive") must always run on their own so the
  // SW is free to surface a consent prompt — never fold them into a shared
  // background fetch.
  if (interactive) return requestToken(true);
  // Non-interactive hot path: a burst of Drive calls hitting an expired cache
  // should trigger exactly ONE AUTH_GET_TOKEN round-trip. The first caller
  // creates the in-flight promise; the rest await it.
  if (!inflightToken) {
    inflightToken = requestToken(false).finally(() => {
      inflightToken = null;
    });
  }
  return inflightToken;
}

async function requestToken(interactive: boolean): Promise<string | null> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "AUTH_GET_TOKEN",
      interactive,
    })) as DcResponse<{ token: string }>;
    if (!response.ok) {
      if (response.error.includes(NEEDS_RECONSENT)) cachedToken = null;
      return null;
    }
    const token = response.data.token;
    cachedToken = { value: token, fetchedAt: Date.now() };
    return token;
  } catch (e) {
    // IPC to the service worker failed (e.g. SW asleep / context torn down).
    // Stay silent for the caller (return null → fall back to API key) but make
    // the failure visible in dev so it's not a black hole.
    debugLog("[auth] AUTH_GET_TOKEN message failed", e);
    return null;
  }
}

export type OAuthSessionState =
  | "not-configured" // no OAuth Client ID paired
  | "signed-out" // OAuth configured but no interactive consent yet
  | "active" // within the interactive window
  | "expired"; // past the app ceiling, needs re-consent

/**
 * Returns the high-level OAuth state used by the login screen so it can
 * differentiate "first time, click Connect Drive" vs "session expired,
 * sign in again". Reads the SW-managed `dc.oauthInteractiveAt` timestamp.
 */
export async function getOAuthSessionState(): Promise<{
  state: OAuthSessionState;
  interactiveAt: number | null;
  expiresAt: number | null;
}> {
  const hasClient = !!(await getOAuthClientId()) || isGoogleOAuthConfigured();
  if (!hasClient) {
    return { state: "not-configured", interactiveAt: null, expiresAt: null };
  }
  let interactiveAt: number | null = null;
  try {
    const obj = await chrome.storage.local.get(INTERACTIVE_AT_KEY);
    const v = obj[INTERACTIVE_AT_KEY];
    if (typeof v === "number") interactiveAt = v;
  } catch (e) {
    debugLog("[auth] reading oauthInteractiveAt failed", e);
    /* default to signed-out */
  }
  if (interactiveAt == null) {
    return { state: "signed-out", interactiveAt: null, expiresAt: null };
  }
  const expiresAt = interactiveAt + OAUTH_INTERACTIVE_TTL_MS;
  if (Date.now() >= expiresAt) {
    return { state: "expired", interactiveAt, expiresAt };
  }
  return { state: "active", interactiveAt, expiresAt };
}

export async function getAccessToken(interactive = true): Promise<string> {
  const t = await tryGetAccessToken(interactive);
  if (!t)
    throw new DriveAccessError(
      "auth-required",
      "Sign in to Drive is not configured.",
    );
  return t;
}

export async function signOut(): Promise<void> {
  cachedToken = null;
  try {
    await chrome.runtime.sendMessage({ type: "AUTH_REVOKE" });
  } catch {
    /* OAuth not configured — nothing to revoke */
  }
}

/**
 * Public entry point for every Drive API call.
 *
 * Routes the request through DriveRequestQueue (concurrency cap, priority,
 * retry + backoff with jitter, cooldown signal on rate-limit), then performs
 * the actual auth-aware fetch via `authedFetchRaw`, which tries API key
 * first and falls back to OAuth if available.
 *
 * Pass `opts.kind` so the queue applies the right concurrency cap, and
 * `opts.signal` so cancellations propagate. Without opts, the request is
 * scheduled as a normal-priority "metadata" call.
 *
 * Throws DriveAccessError on permanent failure. Retryable errors are absorbed
 * inside the queue until the retry budget is exhausted.
 */
export function authedFetch(
  url: string,
  init: RequestInit = {},
  opts: RequestOptions = {},
): Promise<Response> {
  const { kind = "metadata", priority = "normal", signal } = opts;
  // Compose the caller's signal with the queue's per-attempt signal so
  // either one can cancel the underlying fetch.
  const initSignal = init.signal as AbortSignal | undefined;
  return driveQueue.run({
    kind,
    priority,
    signal,
    run: (attemptSignal) => {
      const combined = combineSignals([signal, initSignal, attemptSignal]);
      trackRequest();
      return authedFetchRaw(url, { ...init, signal: combined });
    },
  });
}

/** Low-level: skip the queue. Reserved for the queue itself + cold paths. */
export async function authedFetchRaw(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  // Strategy: OAuth first when a token is available (personal quota is far
  // more generous than the public-API-key quota Google has been throttling
  // as "video-hosting" abuse). Fall back to API key on auth failure, or
  // when no token is available at all.
  const token = await tryGetAccessToken(false);
  const apiKey = await getApiKey();

  if (token) {
    const res = await fetchWithBearer(url, init, token);
    if (res.ok || res.status === 206) return res;

    // 401 → token may be stale. Re-read the (web-redirect-managed) token cache
    // once before falling back to the API key, so a benign expiry doesn't bump
    // the user to a throttled key. We never prompt here: interactive re-consent
    // is an explicit user action via the /auth/google/callback redirect flow,
    // not a surprise popup mid-request.
    if (res.status === 401) {
      cachedToken = null;
      const fresh = await tryGetAccessToken(false);
      if (fresh && fresh !== token) {
        const res2 = await fetchWithBearer(url, init, fresh);
        if (res2.ok || res2.status === 206) return res2;
        // Fall through to the API-key path if OAuth still doesn't work.
      }
    }

    // For non-auth failures (5xx, 429, 404, network), API key won't help —
    // surface immediately so the queue can apply backoff / surface the error.
    if (res.status !== 401 && res.status !== 403) {
      // For 4xx other than 401/403, prefer the typed error from this response.
      if (!apiKey) throw await classifyDriveError(res);
    }

    if (apiKey) {
      const resKey = await fetch(appendApiKey(url, apiKey), init);
      if (resKey.ok || resKey.status === 206) return resKey;
      // Both paths failed — surface whichever response was more informative.
      throw await classifyDriveError(resKey.status >= 500 ? res : resKey);
    }

    throw await classifyDriveError(res);
  }

  // No OAuth token. Use API key directly.
  if (apiKey) {
    const res = await fetch(appendApiKey(url, apiKey), init);
    if (res.ok || res.status === 206) return res;
    const err = await classifyDriveError(res);
    // If the API key got refused (403 / quota throttle) AND the user has an
    // OAuth Client ID configured but no live token, this is the
    // "I need to click Connect Drive" state, not a "file is private" state.
    // Re-tag the error so the UI can offer the right action.
    if (
      (err.reason === "private-folder" || err.reason === "rate-limited") &&
      (await getOAuthClientId())
    ) {
      throw new DriveAccessError(
        "needs-oauth",
        "Drive rejected the public API key (likely quota-throttled). Click Connect Drive to authenticate with your personal Drive quota.",
        err.status,
        err.driveMessage,
      );
    }
    throw err;
  }

  // No API key but OAuth client ID is configured — user just hasn't
  // completed the consent flow yet.
  if (await getOAuthClientId()) {
    throw new DriveAccessError(
      "needs-oauth",
      "Click Connect Drive in the User Center to authenticate with your Google account.",
    );
  }

  // Nothing configured.
  throw new DriveAccessError(
    "no-api-key",
    "Drive access isn't set up yet. Open the Setup guide on the home screen and paste a Google API key, or connect your Drive account via the User Center.",
  );
}

async function fetchWithBearer(
  url: string,
  init: RequestInit,
  token: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

/**
 * Merge multiple AbortSignals into one. Aborts as soon as any input aborts.
 * AbortSignal.any() is the standard form but isn't in older Chromiums; this
 * polyfills the behaviour and stays cheap (no listeners after settle).
 */
function combineSignals(
  inputs: Array<AbortSignal | undefined>,
): AbortSignal | undefined {
  const signals = inputs.filter((s): s is AbortSignal => !!s);
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  // Prefer the platform when available.
  const anyFn = (
    AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }
  ).any;
  if (typeof anyFn === "function") return anyFn(signals);
  const ctrl = new AbortController();
  const onAbort = (s: AbortSignal) => () => {
    ctrl.abort((s as { reason?: unknown }).reason);
  };
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort((s as { reason?: unknown }).reason);
      break;
    }
    s.addEventListener("abort", onAbort(s), { once: true });
  }
  return ctrl.signal;
}
