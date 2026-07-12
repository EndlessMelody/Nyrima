/**
 * Supabase browser client.
 *
 * Supabase Auth is the source of truth for user identity and Supabase Postgres
 * is the source of truth for persistent user data. This module exposes a lazily
 * created singleton client built from the frontend-safe env vars.
 *
 * The client is optional in development only: when the env vars are absent
 * locally or in CI, `getSupabaseClient()` returns null and the app can fall
 * back to the local mock auth + local repository. In production, missing
 * Supabase env fails loudly instead of silently using browser-local data.
 *
 * Only the anon (publishable) key is used here — it is safe to ship to the
 * browser because Row Level Security (see supabase/migrations) gates every
 * row. The service-role key and any Redis credentials are SERVER-ONLY and must
 * never appear in a VITE_* variable. See docs/supabase-and-cache-architecture.md.
 */

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

interface SupabaseEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_PUBLIC_SITE_URL?: string;
  PROD?: boolean;
}

function envValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

function configFromEnv(env: SupabaseEnv): {
  url: string;
  anonKey: string;
  prod: boolean;
} {
  return {
    url: envValue(env.VITE_SUPABASE_URL),
    anonKey: envValue(env.VITE_SUPABASE_ANON_KEY),
    prod: env.PROD === true,
  };
}

const runtimeConfig = configFromEnv(import.meta.env);

let client: SupabaseClient | null = null;

/** True when the frontend-safe Supabase env vars are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(runtimeConfig.url && runtimeConfig.anonKey);
}

export function hasSupabaseEnv(env: SupabaseEnv = import.meta.env): boolean {
  const config = configFromEnv(env);
  return Boolean(config.url && config.anonKey);
}

export function getSupabaseConfigError(
  env: SupabaseEnv = import.meta.env,
): string | null {
  const config = configFromEnv(env);
  const missing = [
    config.url ? null : "VITE_SUPABASE_URL",
    config.anonKey ? null : "VITE_SUPABASE_ANON_KEY",
  ].filter((name): name is string => !!name);

  if (missing.length === 0 || !config.prod) return null;
  return `Supabase is required in production. Missing ${missing.join(
    " and ",
  )}. Configure the frontend-safe Supabase variables instead of falling back to local storage.`;
}

export function shouldAllowLocalSupabaseFallback(
  env: SupabaseEnv = import.meta.env,
): boolean {
  return !hasSupabaseEnv(env) && getSupabaseConfigError(env) === null;
}

/** The public site origin used for OAuth redirect URLs. */
export function publicSiteUrl(): string {
  const fromEnv = import.meta.env.VITE_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return typeof window !== "undefined" ? window.location.origin : "";
}

/**
 * Returns the singleton Supabase client, or null when not configured.
 * `detectSessionInUrl` lets the client finish the OAuth redirect on
 * /auth/callback; `persistSession` keeps the user signed in across reloads.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    const error = getSupabaseConfigError();
    if (error) throw new Error(error);
    return null;
  }
  if (client) return client;
  client = createClient(runtimeConfig.url, runtimeConfig.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
  return client;
}
