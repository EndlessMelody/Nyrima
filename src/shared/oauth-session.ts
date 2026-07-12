const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export const OAUTH_INTERACTIVE_SESSION_HOURS = 72;
export const OAUTH_INTERACTIVE_TTL_MS =
  OAUTH_INTERACTIVE_SESSION_HOURS * 60 * 60 * 1000;

const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

interface GoogleOAuthUrlOptions {
  clientId: string;
  redirectUri: string;
  interactive: boolean;
  loginHint?: string | null;
}

export function isOAuthInteractiveSessionExpired(
  interactiveAt: number | null,
  now = Date.now(),
): boolean {
  return (
    interactiveAt == null ||
    now >= interactiveAt + OAUTH_INTERACTIVE_TTL_MS
  );
}

export function buildGoogleOAuthUrl({
  clientId,
  redirectUri,
  interactive,
  loginHint,
}: GoogleOAuthUrlOptions): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  if (!interactive) url.searchParams.set("prompt", "none");
  if (loginHint?.trim()) url.searchParams.set("login_hint", loginHint.trim());
  return url.toString();
}

export function getStoredOAuthLoginHint(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const cached = value as {
    email?: unknown;
    profile?: { email?: unknown };
  };
  const email =
    typeof cached.profile?.email === "string"
      ? cached.profile.email
      : typeof cached.email === "string"
        ? cached.email
        : "";

  return email.trim() || null;
}
