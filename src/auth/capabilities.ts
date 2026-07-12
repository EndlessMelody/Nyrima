/**
 * Capability model — what a session is allowed to do.
 *
 * Instead of scattering `status === "authenticated"` checks across the app, the
 * auth layer hands out a flat list of capability strings derived from the
 * session state. UI and route guards ask `canAccess("social:profile")` rather
 * than hardcoding the auth tier, so the rules live in exactly one place.
 *
 * Three tiers:
 *   - unauthenticated → nothing (gets bounced to /login)
 *   - guest           → watch-only: Drive + player + LOCAL history/settings
 *   - authenticated   → everything, including social + cloud sync
 *
 * Guests deliberately have no `social:*` or `*:cloud` capability — guest mode
 * is for watching, and the social backend only ever holds real accounts.
 */

import type { AuthStatus } from "./auth-types";

export type Capability =
  | "drive:connect"
  | "drive:browse"
  | "player:watch"
  | "player:subtitles"
  | "player:multi-audio"
  | "history:local"
  | "history:cloud"
  | "settings:local"
  | "settings:cloud"
  | "social:profile"
  | "social:friends"
  | "social:comments"
  | "social:activity"
  | "sync:cloud";

/** What a guest ("Try Nyrima") can do: watch their own Drive, stored locally. */
export const GUEST_CAPABILITIES: readonly Capability[] = [
  "drive:connect",
  "drive:browse",
  "player:watch",
  "player:subtitles",
  "player:multi-audio",
  "history:local",
  "settings:local",
];

/** What a signed-in Nyrima account can do: everything, including social. */
export const AUTHENTICATED_CAPABILITIES: readonly Capability[] = [
  "drive:connect",
  "drive:browse",
  "player:watch",
  "player:subtitles",
  "player:multi-audio",
  "history:local",
  "history:cloud",
  "settings:local",
  "settings:cloud",
  "social:profile",
  "social:friends",
  "social:comments",
  "social:activity",
  "sync:cloud",
];

/** Resolve the capability set for a given session status. */
export function capabilitiesFor(status: AuthStatus): Capability[] {
  switch (status) {
    case "authenticated":
      return [...AUTHENTICATED_CAPABILITIES];
    case "guest":
      return [...GUEST_CAPABILITIES];
    default:
      return [];
  }
}

/** Membership test against a capability list. */
export function hasCapability(
  capabilities: readonly string[],
  capability: string,
): boolean {
  return capabilities.includes(capability);
}
