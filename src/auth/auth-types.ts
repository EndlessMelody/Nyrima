/**
 * Account-auth domain types.
 *
 * This is the *account* identity layer (who is signed into Nyrima), which is
 * deliberately separate from the *Drive* connection (which Google Drive a user
 * has linked). Keeping them apart lets one Nyrima account own a Drive
 * connection, settings, history, etc. — the per-account model the product is
 * built around.
 *
 * `AuthBackend` is the swap point: today it's a local mock (see
 * `providers/local-auth.ts`); later it becomes an HTTP client against the real
 * accounts API (VITE_API_BASE_URL) with no change to the UI or AuthProvider.
 */

export type AuthMethod = "password" | "google";

export interface Account {
  /** Stable account id — also used to namespace per-account storage. */
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  method: AuthMethod;
  createdAt: number;
}

export interface Session {
  accountId: string;
  createdAt: number;
}

/**
 * Session state.
 *   - loading         → restoring the persisted session on boot
 *   - unauthenticated → no account and no guest session (→ /login)
 *   - guest           → "Try Nyrima": using the app without a Nyrima account
 *   - authenticated   → signed into a real Nyrima account
 *
 * `guest` is deliberately NOT treated as a full authenticated user — it carries
 * a reduced capability set (see `capabilities.ts`).
 */
export type AuthStatus =
  | "loading"
  | "unauthenticated"
  | "guest"
  | "authenticated";

export interface AuthError {
  code: string;
  message: string;
}

export interface PasswordCredentials {
  email: string;
  password: string;
  /** Only used on sign-up. */
  displayName?: string;
}

/**
 * The pluggable auth implementation. A real backend implements the same
 * contract over the network.
 */
export interface AuthBackend {
  /** Restore the persisted session, if any. Resolves the current account. */
  restore(): Promise<Account | null>;
  signIn(creds: PasswordCredentials): Promise<Account>;
  signUp(creds: PasswordCredentials): Promise<Account>;
  signInWithGoogle(): Promise<Account>;
  signOut(): Promise<void>;
  /**
   * Optional reactive hook. Backends with out-of-band auth changes (OAuth
   * redirect return, token refresh, sign-out in another tab) call the listener
   * with the new account or null. Returns an unsubscribe function. Backends
   * without external state (the local mock) may omit this.
   */
  onAuthChange?(listener: (account: Account | null) => void): () => void;
}
