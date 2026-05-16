/**
 * Fetches the signed-in user's Google profile (avatar, name, email).
 *
 * Uses the Drive About API (`fields=user`) which works with the existing
 * `drive.readonly` scope — no additional OAuth scopes needed.
 *
 * The result is cached in chrome.storage.local with a 1-hour TTL so we
 * don't re-fetch on every page load.
 */

import { tryGetAccessToken } from "./auth";
import type { UserProfile } from "@shared/types";

const CACHE_KEY = "dc.userProfile";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedProfile {
  profile: UserProfile;
  fetchedAt: number;
}

/**
 * Get the current user's profile. Returns cached data when fresh, otherwise
 * fetches from the Drive About API. Returns null when no OAuth token is
 * available (API-key-only mode).
 */
export async function getUserProfile(): Promise<UserProfile | null> {
  // Check cache first.
  try {
    const stored = await chrome.storage.local.get(CACHE_KEY);
    const cached = stored[CACHE_KEY] as CachedProfile | undefined;
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.profile;
    }
  } catch {
    // Storage read failed — proceed to network.
  }

  // Need a token for the About API.
  const token = await tryGetAccessToken(false);
  if (!token) return null;

  try {
    const res = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      user?: {
        displayName?: string;
        photoLink?: string;
        emailAddress?: string;
      };
    };

    if (!data.user) return null;

    const profile: UserProfile = {
      email: data.user.emailAddress ?? "",
      name: data.user.displayName ?? undefined,
      picture: data.user.photoLink ?? undefined,
    };

    // Cache for next time.
    try {
      await chrome.storage.local.set({
        [CACHE_KEY]: { profile, fetchedAt: Date.now() } satisfies CachedProfile,
      });
    } catch {
      // Non-critical — just means the next load will re-fetch.
    }

    return profile;
  } catch {
    return null;
  }
}

/** Clear cached profile (e.g. on sign-out). */
export async function clearUserProfile(): Promise<void> {
  try {
    await chrome.storage.local.remove(CACHE_KEY);
  } catch {
    // ignore
  }
}
