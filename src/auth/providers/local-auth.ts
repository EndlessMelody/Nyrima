/**
 * Local mock auth backend.
 *
 * Implements the `AuthBackend` contract entirely in the browser so the full
 * login/sign-up/sign-out UX is real and clickable before any server exists.
 * Accounts persist in localStorage via `account-store`. Swap this for an HTTP
 * implementation when `VITE_API_BASE_URL` is configured — the AuthProvider and
 * all UI stay unchanged.
 */

import type { Account, AuthBackend, PasswordCredentials } from "../auth-types";
import {
  clearSession,
  findAccountByEmail,
  findAccountById,
  getSession,
  hashPassword,
  setSession,
  toPublicAccount,
  upsertAccount,
  type StoredAccount,
} from "../account-store";

class AuthFlowError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthFlowError";
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `acct_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function deriveName(email: string): string {
  const local = email.split("@")[0] ?? "you";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function validateEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new AuthFlowError("invalid-email", "Enter a valid email address.");
  }
}

export const localAuthBackend: AuthBackend = {
  async restore(): Promise<Account | null> {
    const session = getSession();
    if (!session) return null;
    const account = findAccountById(session.accountId);
    return account ? toPublicAccount(account) : null;
  },

  async signIn({ email, password }: PasswordCredentials): Promise<Account> {
    validateEmail(email);
    const existing = findAccountByEmail(email);
    if (!existing || existing.method !== "password") {
      throw new AuthFlowError(
        "no-account",
        "No account with that email. Create one to get started.",
      );
    }
    const hash = await hashPassword(password);
    if (existing.passwordHash !== hash) {
      throw new AuthFlowError("bad-password", "Incorrect password.");
    }
    setSession(existing.id);
    return toPublicAccount(existing);
  },

  async signUp({ email, password, displayName }: PasswordCredentials): Promise<Account> {
    validateEmail(email);
    if (password.length < 6) {
      throw new AuthFlowError(
        "weak-password",
        "Use at least 6 characters for your password.",
      );
    }
    if (findAccountByEmail(email)) {
      throw new AuthFlowError(
        "email-taken",
        "An account with that email already exists. Try signing in.",
      );
    }
    const account: StoredAccount = {
      id: newId(),
      email: email.trim(),
      displayName: displayName?.trim() || deriveName(email),
      method: "password",
      createdAt: Date.now(),
      passwordHash: await hashPassword(password),
    };
    upsertAccount(account);
    setSession(account.id);
    return toPublicAccount(account);
  },

  // STUB: a real implementation runs Google Identity Services and exchanges the
  // credential for a Nyrima session. Here we mint/reuse a demo Google account so
  // the "Continue with Google" path is fully navigable. TODO(prod): wire GIS +
  // backend token exchange; associate the resulting Drive connection.
  async signInWithGoogle(): Promise<Account> {
    const email = "google-user@nyrima.app";
    let account = findAccountByEmail(email);
    if (!account) {
      account = {
        id: newId(),
        email,
        displayName: "Google User",
        method: "google",
        createdAt: Date.now(),
      };
      upsertAccount(account);
    }
    setSession(account.id);
    return toPublicAccount(account);
  },

  async signOut(): Promise<void> {
    clearSession();
  },
};
