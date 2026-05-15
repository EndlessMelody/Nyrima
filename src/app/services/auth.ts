/**
 * Frontend auth helper.
 *
 * Nyrima supports two auth modes, transparently:
 *
 *   1. API key (default) — for folders shared as "Anyone with the link".
 *      Stored via api-key.ts in chrome.storage.local. No OAuth client
 *      required. Setup is 1 minute in Google Cloud Console.
 *
 *   2. OAuth (optional upgrade) — for the user's own private folders.
 *      Only available if the manifest declares an oauth2.client_id; in
 *      a fresh build that's commented out, so getAccessToken() will fail
 *      gracefully and we stay in API-key mode.
 *
 * authedFetch tries API key first, then OAuth, and surfaces a typed
 * DriveAccessError if both fail.
 */

import type { DcResponse } from "@shared/messages";
import { getApiKey, appendApiKey } from "./api-key";
import { classifyDriveError, DriveAccessError } from "./errors";
import { driveQueue } from "./drive/request-queue";
import { trackRequest } from "./drive/dev-mode";
import type { RequestOptions } from "./drive/types";

let cachedToken: { value: string; fetchedAt: number } | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000; // chrome.identity tokens last ~60min

/**
 * Try to fetch an OAuth token. Returns null when OAuth isn't configured in
 * the manifest (or the user hasn't consented yet and we don't want to prompt).
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
    if (!response.ok) return null;
    const token = response.data.token;
    cachedToken = { value: token, fetchedAt: Date.now() };
    return token;
  } catch {
    return null;
  }
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
  const apiKey = await getApiKey();

  // Attempt 1: API key only.
  if (apiKey) {
    const res = await fetch(appendApiKey(url, apiKey), init);
    if (res.ok || res.status === 206) return res;

    if (res.status !== 401 && res.status !== 403 && res.status !== 404) {
      // Surface non-auth failures immediately (5xx, 429, etc.).
      throw await classifyDriveError(res);
    }

    // Try OAuth fallback if it's available.
    const token = await tryGetAccessToken(false);
    if (!token) {
      throw await classifyDriveError(res);
    }
    const res2 = await fetchWithBearer(url, init, token);
    if (res2.ok || res2.status === 206) return res2;
    if (res2.status === 401) {
      cachedToken = null;
      const fresh = await tryGetAccessToken(true);
      if (fresh) {
        const res3 = await fetchWithBearer(url, init, fresh);
        if (res3.ok || res3.status === 206) return res3;
        throw await classifyDriveError(res3);
      }
    }
    throw await classifyDriveError(res2);
  }

  // No API key. Try OAuth if configured.
  const token = await tryGetAccessToken(false);
  if (token) {
    const res = await fetchWithBearer(url, init, token);
    if (res.ok || res.status === 206) return res;
    if (res.status === 401) {
      cachedToken = null;
      const fresh = await tryGetAccessToken(true);
      if (fresh) {
        const res2 = await fetchWithBearer(url, init, fresh);
        if (res2.ok || res2.status === 206) return res2;
      }
    }
    throw await classifyDriveError(res);
  }

  // Nothing configured.
  throw new DriveAccessError(
    "no-api-key",
    "Drive access isn't set up yet. Open the Setup guide on the home screen and paste a Google API key.",
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
