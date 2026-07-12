/**
 * Guest session — the "Try Nyrima" mode marker.
 *
 * A guest is someone using Nyrima WITHOUT a Nyrima account. They can connect
 * their own Google Drive (OAuth, for Drive access only) and watch their files
 * with subtitles + multi-audio, but they get no social profile and no cloud
 * sync — nothing they do ever touches the Nyrima social backend.
 *
 * IMPORTANT: like `account-store`, this lives OUTSIDE the per-account
 * `chrome.storage` shim. It's stored under a fixed, un-namespaced
 * `localStorage` key so the guest marker is independent of the account
 * partition. Starting guest mode does NOT create a Supabase user or any
 * server-side record — it is purely a local flag.
 */

/** The single localStorage key the guest marker is persisted under. */
export const GUEST_SESSION_KEY = "nyrima.guest.session";

export interface GuestSession {
  mode: "guest";
  /** Stable, non-identifying id. Guests are not distinguished server-side. */
  id: "guest-local";
  displayName: string;
  /** ISO-8601 timestamp of when this guest session was started. */
  createdAt: string;
}

const GUEST_ID = "guest-local";
const GUEST_DISPLAY_NAME = "Guest";

/** Safe localStorage accessor — no-op when running without a DOM (SSR/tests). */
function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Type guard for a structurally-valid persisted guest session. */
function isValidGuestSession(value: unknown): value is GuestSession {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.mode === "guest" &&
    v.id === GUEST_ID &&
    typeof v.displayName === "string" &&
    typeof v.createdAt === "string"
  );
}

/**
 * Begin a guest session: build the marker, persist it, and return it. Any
 * existing marker is overwritten with a fresh `createdAt`.
 */
export function startGuestSession(): GuestSession {
  const session: GuestSession = {
    mode: "guest",
    id: GUEST_ID,
    displayName: GUEST_DISPLAY_NAME,
    createdAt: new Date().toISOString(),
  };
  const store = storage();
  if (store) {
    try {
      store.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
    } catch {
      /* quota / private-mode — guest mode still works for this tab */
    }
  }
  return session;
}

/**
 * Read the persisted guest session. Returns `null` when none is set. If the
 * stored value is corrupt (bad JSON or wrong shape) the broken value is
 * removed and `null` is returned.
 */
export function getGuestSession(): GuestSession | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(GUEST_SESSION_KEY);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (isValidGuestSession(parsed)) return parsed;
    // Structurally invalid — treat as corrupt.
    clearGuestSession();
    return null;
  } catch {
    // Unparseable — drop the broken value so we don't keep tripping on it.
    clearGuestSession();
    return null;
  }
}

/** True when an active guest session is present. */
export function isGuestSession(): boolean {
  return getGuestSession() !== null;
}

/** Remove the guest session marker. Leaves all other local data intact. */
export function clearGuestSession(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(GUEST_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
