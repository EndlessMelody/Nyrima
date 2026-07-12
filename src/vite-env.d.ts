/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  /** Supabase project URL (frontend-safe). When set with the anon key, the app
   *  uses Supabase Auth + Postgres instead of the local mock. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/publishable key (frontend-safe — RLS gates every row). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Public site origin used to build OAuth redirect URLs (e.g.
   *  https://nyrima.app). Falls back to window.location.origin. */
  readonly VITE_PUBLIC_SITE_URL?: string;
  /** Google Cloud OAuth *Web* client id used by the Drive connection flow.
   *  Preferred name. Public by design (no secret). When unset, users may paste
   *  their own in Connect Drive and the API-key path remains available. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Exact web redirect URI registered on the Google OAuth client, e.g.
   *  http://localhost:5173/auth/google/callback. Falls back to
   *  `${window.location.origin}/auth/google/callback`. */
  readonly VITE_GOOGLE_OAUTH_REDIRECT_URI?: string;
  /** Deprecated alias for VITE_GOOGLE_CLIENT_ID (legacy popup skeleton). */
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string;
  /** Space-separated OAuth scopes override (defaults live in src/config/googleOAuth). */
  readonly VITE_GOOGLE_DRIVE_SCOPE?: string;
  /** Base URL of the future Nyrima account/data API. Unset = local mock. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
