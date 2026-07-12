/**
 * Supabase implementation of the AuthBackend contract.
 *
 * Supabase Auth is the source of truth for identity. This backend maps a
 * Supabase `User` onto Nyrima's `Account` and is selected automatically by
 * AuthProvider when the project env vars are present (see lib/supabase.ts).
 *
 * Google sign-in here is IDENTITY ONLY (email + profile scopes) — it does NOT
 * request Google Drive scopes. The Drive connection is a separate, later flow
 * handled server-side via an Edge Function (see supabase/functions/README.md).
 */

import type { User } from "@supabase/supabase-js";
import { getSupabaseClient, publicSiteUrl } from "@/lib/supabase";
import type { Account, AuthBackend, AuthMethod, PasswordCredentials } from "../auth-types";

class AuthFlowError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthFlowError";
  }
}

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new AuthFlowError("not-configured", "Supabase is not configured.");
  }
  return client;
}

function methodOf(user: User): AuthMethod {
  const provider = user.app_metadata?.provider;
  return provider === "google" ? "google" : "password";
}

function displayNameOf(user: User): string {
  const meta = user.user_metadata ?? {};
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";
  if (name) return name;
  const local = (user.email ?? "you").split("@")[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export function toAccount(user: User): Account {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? "",
    displayName: displayNameOf(user),
    avatarUrl:
      typeof meta.avatar_url === "string" ? meta.avatar_url : undefined,
    method: methodOf(user),
    createdAt: user.created_at ? Date.parse(user.created_at) : Date.now(),
  };
}

export const supabaseAuthBackend: AuthBackend = {
  async restore(): Promise<Account | null> {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    const user = data.session?.user;
    return user ? toAccount(user) : null;
  },

  async signIn({ email, password }: PasswordCredentials): Promise<Account> {
    const client = requireClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !data.user) {
      throw new AuthFlowError("sign-in-failed", error?.message ?? "Sign-in failed.");
    }
    return toAccount(data.user);
  },

  async signUp({ email, password, displayName }: PasswordCredentials): Promise<Account> {
    const client = requireClient();
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: displayName?.trim() ? { full_name: displayName.trim() } : undefined,
        emailRedirectTo: `${publicSiteUrl()}/auth/callback`,
      },
    });
    if (error) {
      throw new AuthFlowError("sign-up-failed", error.message);
    }
    if (!data.user) {
      // Email-confirmation projects return no session until the link is clicked.
      throw new AuthFlowError(
        "confirm-email",
        "Account created. Check your email to confirm, then sign in.",
      );
    }
    return toAccount(data.user);
  },

  // Identity-only Google sign-in. This performs a full-page redirect to Google
  // and back to /auth/callback; the resulting account is delivered via
  // onAuthChange / restore() after the redirect, so this promise intentionally
  // does not resolve in the redirecting tab.
  async signInWithGoogle(): Promise<Account> {
    const client = requireClient();
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "email profile",
        redirectTo: `${publicSiteUrl()}/auth/callback`,
      },
    });
    if (error) {
      throw new AuthFlowError("google-failed", error.message);
    }
    // The browser is navigating away; keep the caller in its "working" state.
    return new Promise<Account>(() => {});
  },

  async signOut(): Promise<void> {
    const client = getSupabaseClient();
    if (client) await client.auth.signOut();
  },

  onAuthChange(listener: (account: Account | null) => void): () => void {
    const client = getSupabaseClient();
    if (!client) return () => {};
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      listener(session?.user ? toAccount(session.user) : null);
    });
    return () => data.subscription.unsubscribe();
  },
};
