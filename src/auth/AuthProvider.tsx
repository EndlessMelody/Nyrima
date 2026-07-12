/**
 * AuthProvider — React context for the Nyrima *account* session.
 *
 * Responsibilities:
 *   - restore / track the signed-in account and expose auth actions
 *   - keep the storage partition in sync: every sign-in/out calls
 *     `setActiveAccount()` on the platform storage adapter so each account's
 *     libraries, history, settings, and Drive connection are isolated
 *
 * The actual credential handling is delegated to a pluggable `AuthBackend`.
 * When Supabase env vars are present the Supabase backend is used (real auth).
 * Local mock fallback is allowed for development only; production missing
 * Supabase config fails loudly.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setActiveAccount } from "@/platform/storage-adapter";
import {
  getSupabaseConfigError,
  isSupabaseConfigured,
} from "@/lib/supabase";
import type {
  Account,
  AuthBackend,
  AuthError,
  AuthStatus,
  PasswordCredentials,
} from "./auth-types";
import { localAuthBackend } from "./providers/local-auth";
import { supabaseAuthBackend } from "./providers/supabase-auth";
import {
  clearGuestSession,
  getGuestSession,
  startGuestSession,
  type GuestSession,
} from "./guestSession";
import { capabilitiesFor, hasCapability, type Capability } from "./capabilities";

// Backend selection: real Supabase Auth when configured, else the local mock.
function selectAuthBackend(): AuthBackend {
  if (isSupabaseConfigured()) return supabaseAuthBackend;
  const error = getSupabaseConfigError();
  if (error) throw new Error(error);
  return localAuthBackend;
}

const backend: AuthBackend = selectAuthBackend();

/**
 * Re-hydrate account-scoped stores after the active account changes, so
 * per-account data (settings/theme) isn't left on the previous account or the
 * guest partition. Lazy import keeps AuthProvider decoupled from app stores.
 */
function reloadAccountScopedStores(): void {
  void import("@app/stores/settings-store")
    .then((m) => m.useSettingsStore.getState().load())
    .catch(() => {
      /* store not ready / no window — non-fatal */
    });
}

interface AuthContextValue {
  status: AuthStatus;
  account: Account | null;
  /** The active guest session, when `status === "guest"`. */
  guest: GuestSession | null;
  /** Capabilities granted by the current session (see `capabilities.ts`). */
  capabilities: Capability[];
  error: AuthError | null;
  signIn: (creds: PasswordCredentials) => Promise<Account>;
  signUp: (creds: PasswordCredentials) => Promise<Account>;
  signInWithGoogle: () => Promise<Account>;
  signOut: () => Promise<void>;
  /** Enter "Try Nyrima" guest mode (no Nyrima account, no backend write). */
  startGuestMode: () => GuestSession;
  /** Leave guest mode. Clears ONLY the local guest marker (keeps Drive data). */
  exitGuestMode: () => void;
  /** True when the current session is allowed the given capability. */
  canAccess: (capability: string) => boolean;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthError(e: unknown): AuthError {
  if (e && typeof e === "object" && "code" in e && "message" in e) {
    return { code: String((e as AuthError).code), message: String((e as AuthError).message) };
  }
  return {
    code: "unknown",
    message: e instanceof Error ? e.message : "Something went wrong.",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<AuthError | null>(null);

  // Point storage at the active account and re-hydrate account-scoped stores.
  // Centralized so restore, sign-in, sign-out, and external (Supabase) auth
  // changes all keep the storage partition + settings in sync. A real account
  // always supersedes (and clears) any lingering guest marker.
  const applyAccount = useCallback((acc: Account | null) => {
    setActiveAccount(acc?.id ?? null);
    setAccount(acc);
    if (acc) {
      clearGuestSession();
      setGuest(null);
      setStatus("authenticated");
    } else {
      setStatus("unauthenticated");
    }
    reloadAccountScopedStores();
  }, []);

  // Enter guest mode: use the shared "guest" storage partition (no account id)
  // and flip the session to "guest". No backend call, no Supabase user.
  const enterGuest = useCallback((session: GuestSession) => {
    setActiveAccount(null);
    setAccount(null);
    setGuest(session);
    setStatus("guest");
    reloadAccountScopedStores();
  }, []);

  // Restore the persisted session on boot. RequireAuth withholds protected
  // children until status leaves "loading", so the partition is set before any
  // app store mounts. Precedence: a real account wins; otherwise fall back to a
  // guest session if one was saved; otherwise unauthenticated.
  useEffect(() => {
    let alive = true;
    const fallback = () => {
      if (!alive) return;
      const saved = getGuestSession();
      if (saved) enterGuest(saved);
      else setStatus("unauthenticated");
    };
    void backend
      .restore()
      .then((acc) => {
        if (!alive) return;
        if (acc) applyAccount(acc);
        else fallback();
      })
      .catch(fallback);
    return () => {
      alive = false;
    };
  }, [applyAccount, enterGuest]);

  // React to out-of-band auth changes (Supabase OAuth return, token refresh,
  // sign-out in another tab). No-op for backends without onAuthChange.
  useEffect(() => {
    if (!backend.onAuthChange) return;
    return backend.onAuthChange((acc) => applyAccount(acc));
  }, [applyAccount]);

  const runAction = useCallback(
    async (fn: () => Promise<Account>): Promise<Account> => {
      setError(null);
      setStatus("loading");
      try {
        const acc = await fn();
        applyAccount(acc);
        return acc;
      } catch (e) {
        setError(toAuthError(e));
        // Revert to whatever the session was before the attempt.
        setStatus(account ? "authenticated" : guest ? "guest" : "unauthenticated");
        throw e;
      }
    },
    [account, guest, applyAccount],
  );

  const signIn = useCallback(
    (creds: PasswordCredentials) => runAction(() => backend.signIn(creds)),
    [runAction],
  );
  const signUp = useCallback(
    (creds: PasswordCredentials) => runAction(() => backend.signUp(creds)),
    [runAction],
  );
  const signInWithGoogle = useCallback(
    () => runAction(() => backend.signInWithGoogle()),
    [runAction],
  );

  const signOut = useCallback(async () => {
    await backend.signOut();
    clearGuestSession();
    setActiveAccount(null);
    setAccount(null);
    setGuest(null);
    setStatus("unauthenticated");
    setError(null);
  }, []);

  // "Try Nyrima": start a local guest session. Never touches the backend.
  const startGuestMode = useCallback(() => {
    const session = startGuestSession();
    setError(null);
    enterGuest(session);
    return session;
  }, [enterGuest]);

  // Leave guest mode. Per product rule, this clears ONLY the local Nyrima guest
  // marker — the connected Google Drive (tokens stored in the guest partition)
  // is left untouched so re-entering guest mode keeps Drive connected.
  const exitGuestMode = useCallback(() => {
    clearGuestSession();
    setActiveAccount(null);
    setAccount(null);
    setGuest(null);
    setStatus("unauthenticated");
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const capabilities = useMemo<Capability[]>(
    () => capabilitiesFor(status),
    [status],
  );
  const canAccess = useCallback(
    (capability: string) => hasCapability(capabilities, capability),
    [capabilities],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      account,
      guest,
      capabilities,
      error,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      startGuestMode,
      exitGuestMode,
      canAccess,
      clearError,
    }),
    [
      status,
      account,
      guest,
      capabilities,
      error,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      startGuestMode,
      exitGuestMode,
      canAccess,
      clearError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
