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
 * Make a Drive API request with the best credential available.
 *
 *  1. If we have an API key, try `?key=<KEY>` first (no Authorization header).
 *     This is enough for files shared as "Anyone with the link".
 *  2. If that returns 401/403 AND OAuth is available, retry with the Bearer
 *     token for private folders.
 *  3. If neither succeeds, throw a typed DriveAccessError so the UI can show
 *     the right "share this folder publicly OR sign in" prompt.
 *
 * Throws DriveAccessError on any non-OK response. Returns the Response only
 * when it's `ok` (or a 206 partial-content for ranged streams).
 */
export async function authedFetch(
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
