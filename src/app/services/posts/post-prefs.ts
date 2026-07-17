/**
 * Local-only Posts preferences (Settings → Post Sharing). Not synced to
 * Drive or Supabase — same posture as every other per-device app setting.
 */

import { STORAGE_KEYS } from "@shared/constants";
import type { PostVisibility } from "@shared/post-types";

/** Visibility a freshly-created post starts at. Restricted to draft/private
 *  — you can't default a brand-new post straight to friends/public since
 *  publishing requires a share handle and copies media into the post
 *  folder (post-publish.ts). */
export type DefaultPostVisibility = Extract<PostVisibility, "draft" | "private">;

const FALLBACK: DefaultPostVisibility = "draft";

export async function getDefaultPostVisibility(): Promise<DefaultPostVisibility> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.POSTS_DEFAULT_VISIBILITY);
  const stored = obj[STORAGE_KEYS.POSTS_DEFAULT_VISIBILITY];
  return stored === "draft" || stored === "private" ? stored : FALLBACK;
}

export async function setDefaultPostVisibility(
  value: DefaultPostVisibility,
): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.POSTS_DEFAULT_VISIBILITY]: value });
}
