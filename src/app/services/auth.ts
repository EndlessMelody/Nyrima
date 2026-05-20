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
import { classifyDriveError, DriveAccessError } from "./errors";
import { driveQueue } from "./drive/request-queue";
import { trackRequest } from "./drive/dev-mode";
import type { RequestOptions } from "./drive/types";

let cachedToken: { value: string; fetchedAt: number } | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000; // chrome.identity tokens last ~60min

// Mirrors the SW-side INTERACTIVE_AT_KEY. Read-only on this side: the SW writes
// it on every successful interactive consent, the frontend reads it to decide
// whether to show "Connect Drive" vs "Session expired — sign in again".
const INTERACTIVE_AT_KEY = "dc.oauthInteractiveAt";
const INTERACTIVE_TTL_MS = 24 * 60 * 60 * 1000;

/** Sentinel the SW throws past the 24h interactive ceiling. */
const NEEDS_RECONSENT = "needs-reconsent";

/**
 * Try to fetch an OAuth token. Returns null when OAuth isn't configured in
 * the manifest (or the user hasn't consented yet and we don't want to prompt).
 *
 * Past the 24h interactive ceiling, the SW throws NEEDS_RECONSENT; we drop
 * our cached token and return null. Callers that care about the difference
 * between "never signed in" and "session expired" can read getOAuthSessionState.
 */
export async function tryGetAccessToken(
  interactive = false,
): Promise<string | null> {
  if (cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_TTL_MS) {
    return cachedToken.value;
  }
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
  } catch {
    return null;
  }
}

export type OAuthSessionState =
  | "not-configured" // no OAuth Client ID paired
  | "signed-out" // OAuth configured but no interactive consent yet
  | "active" // within the 24h interactive window
  | "expired"; // past the 24h ceiling, needs re-consent

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
  const hasClient = !!(await getOAuthClientId());
  if (!hasClient) {
    return { state: "not-configured", interactiveAt: null, expiresAt: null };
  }
  let interactiveAt: number | null = null;
  try {
    const obj = await chrome.storage.local.get(INTERACTIVE_AT_KEY);
    const v = obj[INTERACTIVE_AT_KEY];
    if (typeof v === "number") interactiveAt = v;
  } catch {
    /* default to signed-out */
  }
  if (interactiveAt == null) {
    return { state: "signed-out", interactiveAt: null, expiresAt: null };
  }
  const expiresAt = interactiveAt + INTERACTIVE_TTL_MS;
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

    // 401 → token may be stale. Force-refresh once and retry before falling
    // back to API key, so the user doesn't get bumped to a throttled key for
    // a benign token expiry.
    if (res.status === 401) {
      cachedToken = null;
      const fresh = await tryGetAccessToken(true);
      if (fresh) {
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
