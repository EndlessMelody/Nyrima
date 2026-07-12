/**
 * Centralized Google Drive OAuth config for the web app.
 *
 * Flow choice: the app is frontend-only today (the trusted server layer in
 * `supabase/functions` is a placeholder — no code-exchange endpoint exists), so
 * we use Google's IMPLICIT TOKEN flow (`response_type=token`). The browser is
 * redirected to Google and back to our web callback with an access token in the
 * URL fragment. There is NO authorization code and NO client secret anywhere in
 * the frontend. If/when a backend token-exchange endpoint lands, switch to
 * `response_type=code` + `access_type=offline` and exchange the code server-side.
 *
 * This is Drive-access-only: OAuth here grants Google Drive read scope so a user
 * (signed-in OR guest) can browse and watch their own files. It does NOT create
 * a Nyrima account and is entirely separate from the Supabase account/social
 * identity (see `src/auth/*`).
 *
 * No `chrome.identity` and no `*.chromiumapp.org` redirect — that was the retired
 * extension build. The web app uses the route `/auth/google/callback`.
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Where the nonce half of the CSRF `state` is parked between redirects. */
const NONCE_STORAGE_KEY = "nyrima.oauth.nonce";

/** Least-privilege default. `drive.readonly` is enough to list + stream the
 *  user's files, and the profile (name/avatar) is read via the Drive About API,
 *  so no `userinfo.*` scopes are required. */
const DEFAULT_DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

export type OAuthMode = "guest" | "authenticated";

export interface OAuthState {
  /** Whether the connect was started from guest or authenticated mode. */
  mode: OAuthMode;
  /** In-app path to return to after the callback (defaults to /app). */
  returnTo: string;
  /** Random CSRF nonce, matched against sessionStorage on return. */
  nonce: string;
}

export interface GoogleOAuthUrlOptions {
  mode?: OAuthMode;
  returnTo?: string;
  /** Override the client id (e.g. a per-account BYOK id). Defaults to env. */
  clientId?: string;
  /** Override the redirect URI. Defaults to the configured/derived one. */
  redirectUri?: string;
  loginHint?: string | null;
  /** Set only when you must force the consent/account screens. */
  prompt?: "consent" | "select_account" | "none";
}

function readEnv(key: keyof ImportMetaEnv): string {
  const v = import.meta.env?.[key];
  return typeof v === "string" ? v.trim() : "";
}

function originOrEmpty(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

function resolveRedirectUri(): string {
  const explicit = readEnv("VITE_GOOGLE_OAUTH_REDIRECT_URI");
  if (explicit) return explicit;
  const origin = originOrEmpty();
  return `${origin}/auth/google/callback`;
}

function resolveScopes(): string[] {
  const override = readEnv("VITE_GOOGLE_DRIVE_SCOPE");
  if (override) {
    const scopes = override.split(/\s+/).filter(Boolean);
    if (scopes.length) return scopes;
  }
  return [...DEFAULT_DRIVE_SCOPES];
}

/** Public app client id (frontend-safe). Prefers the new var, then the legacy
 *  alias. Empty when neither is set (then BYOK or API-key paths apply). */
export const GOOGLE_CLIENT_ID =
  readEnv("VITE_GOOGLE_CLIENT_ID") || readEnv("VITE_GOOGLE_OAUTH_CLIENT_ID");

/** The exact redirect URI registered on the Google OAuth web client. */
export const GOOGLE_OAUTH_REDIRECT_URI = resolveRedirectUri();

/** Drive scopes requested at consent. */
export const GOOGLE_DRIVE_SCOPES = resolveScopes();

/** True when an app-wide client id is configured via env. */
export function isGoogleOAuthConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

// ── CSRF state (mode + returnTo + nonce) ──────────────────────────────────

function generateNonce(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Older browsers (and HTTP-served dev hosts, where `randomUUID` requires a
  // secure context) still expose `getRandomValues` — use it for a CSPRNG hex
  // nonce before falling back to Math.random.
  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function base64UrlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded);
}

function saveNonce(nonce: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(NONCE_STORAGE_KEY, nonce);
  } catch {
    /* private mode — state validation will fail closed, which is safe */
  }
}

/**
 * Build the opaque `state` value: encodes mode + returnTo and parks a fresh
 * nonce in sessionStorage to validate against on the callback (CSRF guard).
 */
export function buildOAuthState(mode: OAuthMode, returnTo: string): string {
  const nonce = generateNonce();
  saveNonce(nonce);
  const payload: OAuthState = { mode, returnTo, nonce };
  return base64UrlEncode(JSON.stringify(payload));
}

/** Decode + structurally validate a `state` value. Returns null when invalid. */
export function parseOAuthState(raw: string | null | undefined): OAuthState | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(base64UrlDecode(raw)) as Partial<OAuthState>;
    if (
      obj &&
      (obj.mode === "guest" || obj.mode === "authenticated") &&
      typeof obj.returnTo === "string" &&
      typeof obj.nonce === "string"
    ) {
      return { mode: obj.mode, returnTo: obj.returnTo, nonce: obj.nonce };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate the returned nonce against the stored one and consume it (single
 * use). Returns false when there's no stored nonce or it doesn't match.
 */
export function consumeOAuthNonce(nonce: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(NONCE_STORAGE_KEY);
    window.sessionStorage.removeItem(NONCE_STORAGE_KEY);
  } catch {
    return false;
  }
  return !!stored && !!nonce && stored === nonce;
}

/**
 * Build the Google OAuth authorization URL for a full-page redirect. Callers
 * navigate via `window.location.href = getGoogleOAuthUrl(...)`.
 */
export function getGoogleOAuthUrl(opts: GoogleOAuthUrlOptions = {}): string {
  const clientId = (opts.clientId ?? GOOGLE_CLIENT_ID).trim();
  const redirectUri = opts.redirectUri ?? GOOGLE_OAUTH_REDIRECT_URI;
  const mode: OAuthMode = opts.mode ?? "authenticated";
  const returnTo = opts.returnTo ?? "/app";

  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  // Frontend-only: implicit token flow. No code, no secret. (Switch to
  // response_type=code + access_type=offline once a backend exchange exists.)
  url.searchParams.set("response_type", "token");
  url.searchParams.set("scope", GOOGLE_DRIVE_SCOPES.join(" "));
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", buildOAuthState(mode, returnTo));
  if (opts.loginHint?.trim()) {
    url.searchParams.set("login_hint", opts.loginHint.trim());
  }
  if (opts.prompt) url.searchParams.set("prompt", opts.prompt);
  return url.toString();
}
