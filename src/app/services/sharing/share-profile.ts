/**
 * ShareProfile storage — the user's own sharing identity.
 *
 * The handle picked here is stamped into every ShareEntry + ShareComment
 * the user writes. It's persisted under STORAGE_KEYS.SHARE_PROFILE in
 * chrome.storage.local; survives root re-pairs (account-reset keeps it on
 * purpose — same person, just different Drive).
 *
 * Onboarding flow (Phase 4.1):
 *   - First time the user clicks the topbar Share button (or visits the
 *     User Center → Sharing panel), we surface a handle picker.
 *   - Default name + avatar prefilled from `getUserProfile()` if a Google
 *     identity is connected; the user can override.
 *   - On save, the profile is stamped into chrome.storage.local; the next
 *     share entry uses it.
 *
 * Validation lives here rather than in the picker UI so the same rules
 * apply if a profile is restored from a Drive backup later.
 */

import { SHARE_HANDLE_PATTERN, STORAGE_KEYS } from "@shared/constants";
import type { ShareProfile, ShareAuthor } from "@shared/types";

/** Returns `null` when no profile has been set yet — Phase 4.1 surfaces
 *  the picker in that case. */
export async function getShareProfile(): Promise<ShareProfile | null> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.SHARE_PROFILE);
  const stored = obj[STORAGE_KEYS.SHARE_PROFILE] as ShareProfile | undefined;
  return stored ?? null;
}

/** Validate + persist. Throws when the handle doesn't match
 *  SHARE_HANDLE_PATTERN — the picker should pre-validate so this never
 *  fires in practice, but defence-in-depth matters for the user's
 *  identity payload. */
export async function setShareProfile(
  patch: Omit<ShareProfile, "v" | "updatedAt"> & Partial<Pick<ShareProfile, "updatedAt">>,
): Promise<ShareProfile> {
  if (!SHARE_HANDLE_PATTERN.test(patch.handle)) {
    throw new Error(
      `Invalid share handle "${patch.handle}". Use 3–32 lower-case characters: a–z, 0–9, dash, underscore.`,
    );
  }
  const next: ShareProfile = {
    v: 1,
    handle: patch.handle,
    name: patch.name,
    avatarUrl: patch.avatarUrl,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.SHARE_PROFILE]: next });
  return next;
}

/** Project a ShareProfile down to the ShareAuthor snapshot we stamp into
 *  every entry/comment. The two shapes overlap; this is the seam that
 *  drops the `v` / `updatedAt` bookkeeping fields that don't belong on
 *  the wire payload. */
export function profileToAuthor(profile: ShareProfile): ShareAuthor {
  return {
    handle: profile.handle,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
  };
}

/** Strict client-side validator. Returns null on success, error string on
 *  failure. The picker UI consumes this for live form validation. */
export function validateShareHandle(handle: string): string | null {
  if (!handle) return "Pick a handle.";
  if (handle.length < 3) return "At least 3 characters.";
  if (handle.length > 32) return "At most 32 characters.";
  if (!SHARE_HANDLE_PATTERN.test(handle)) {
    return "Lower-case letters, digits, dash, underscore only — must start with a letter or digit.";
  }
  return null;
}
