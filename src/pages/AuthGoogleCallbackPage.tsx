/**
 * AuthGoogleCallbackPage — landing for the Google DRIVE OAuth redirect.
 *
 * Route: `/auth/google/callback` (distinct from `/auth/callback`, which handles
 * the Supabase *account* OAuth return). The frontend-only implicit token flow
 * sends the access token back in the URL fragment:
 *   #access_token=…&expires_in=3599&state=…   (or #error=… on failure)
 *
 * Steps: wait for the session/storage partition to settle → parse the
 * fragment → map any error to friendly copy → validate the CSRF state/nonce →
 * persist the token where the Drive layer reads it → keep guests as guests →
 * return to the intended in-app path (default /app).
 *
 * No client secret, no code exchange, no chrome.identity — purely Drive access.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { consumeOAuthNonce, parseOAuthState } from "@/config/googleOAuth";
import { ingestRedirectToken } from "@/platform/drive-auth-web";
import { getUserProfile } from "@app/services/user-profile";

type Phase = "working" | "error";

function paramsFrom(raw: string): URLSearchParams {
  const s = raw.startsWith("#") || raw.startsWith("?") ? raw.slice(1) : raw;
  return new URLSearchParams(s);
}

/** Map Google's `error` codes to user-facing copy. */
function messageForError(code: string): string {
  switch (code) {
    case "access_denied":
      return "Google Drive connection was cancelled.";
    case "redirect_uri_mismatch":
      return "This redirect URL is not allowed. Check your Google OAuth settings.";
    default:
      return "Nyrima could not connect to Drive. Please try again.";
  }
}

/** Only allow internal paths; map the bare /library to the app lobby. */
function safeReturnTo(returnTo: string | undefined): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return "/app";
  }
  if (returnTo === "/library" || returnTo === "/library/") return "/app";
  return returnTo;
}

export function AuthGoogleCallbackPage() {
  const navigate = useNavigate();
  const { status, startGuestMode } = useAuth();
  const [phase, setPhase] = useState<Phase>("working");
  const [message, setMessage] = useState("Finishing Drive connection…");
  const [returnTo, setReturnTo] = useState("/app");
  const handledRef = useRef(false);

  useEffect(() => {
    // Wait until AuthProvider has restored the session so the storage partition
    // (guest vs account) is set before we write the Drive token.
    if (status === "loading") return;
    if (handledRef.current) return;
    handledRef.current = true;

    void (async () => {
      const frag = paramsFrom(window.location.hash);
      const query = paramsFrom(window.location.search);
      const get = (key: string) => frag.get(key) ?? query.get(key);

      const errorCode = get("error");
      const token = get("access_token");
      const stateRaw = get("state");
      const state = parseOAuthState(stateRaw);
      const dest = safeReturnTo(state?.returnTo);
      setReturnTo(dest);

      // 1) Provider-reported error (access_denied, redirect_uri_mismatch, …).
      if (errorCode) {
        setPhase("error");
        setMessage(messageForError(errorCode));
        return;
      }

      // 2) CSRF: the state must decode and its nonce must match (single-use).
      if (!state || !consumeOAuthNonce(state.nonce)) {
        setPhase("error");
        setMessage(
          "Nyrima could not verify this sign-in (expired or invalid request). Please try connecting again.",
        );
        return;
      }

      // 3) Implicit flow must return an access token.
      if (!token) {
        setPhase("error");
        setMessage("Nyrima could not connect to Drive. Please try again.");
        return;
      }

      // 4) Keep a guest a guest (the marker should already be restored from
      //    localStorage; re-assert defensively if it somehow wasn't).
      if (state.mode === "guest" && status !== "authenticated") {
        startGuestMode();
      }

      // 5) Persist the token where the Drive data layer reads it, then warm the
      //    profile cache so the UserChip updates. Profile failure is non-fatal.
      try {
        const expiresIn = parseInt(get("expires_in") || "3599", 10);
        await ingestRedirectToken({ token, expiresInSec: expiresIn });
        await getUserProfile().catch(() => undefined);
      } catch {
        setPhase("error");
        setMessage("Nyrima could not connect to Drive. Please try again.");
        return;
      }

      // 6) Clean the token out of the URL, then return to the app.
      try {
        window.history.replaceState(
          {},
          "",
          window.location.origin + "/auth/google/callback",
        );
      } catch {
        /* ignore */
      }
      navigate(dest, { replace: true });
    })();
  }, [status, startGuestMode, navigate]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#070812",
        color: "#f8f7ff",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center", display: "grid", gap: 16 }}>
        <p style={{ fontSize: 13, letterSpacing: "0.06em", lineHeight: 1.6 }}>
          {message}
        </p>
        {phase === "error" && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => navigate(returnTo, { replace: true })}
              style={btnStyle(true)}
            >
              Back to Nyrima
            </button>
            <button
              type="button"
              onClick={() => navigate("/login", { replace: true })}
              style={btnStyle(false)}
            >
              Sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    appearance: "none",
    border: primary ? "0" : "1px solid rgba(248,247,255,0.24)",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    color: primary ? "#080916" : "#f8f7ff",
    background: primary
      ? "linear-gradient(120deg, #ff55cf, #45d6ff)"
      : "transparent",
  };
}
