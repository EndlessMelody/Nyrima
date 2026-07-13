/**
 * AuthCallbackPage — OAuth redirect landing.
 *
 * Two flows share this route, distinguished by whether we have a `window.opener`:
 *   1. Drive connection (popup): the Connect-Drive popup is redirected here with
 *      `#access_token=…`. We post the hash back to the opener
 *      (drive-auth-web.ts listens) and close the popup.
 *   2. Account OAuth (full page): "Continue with Google" does a full-page
 *      redirect to Supabase and back here with `?code=…`. We deterministically
 *      finalize the PKCE exchange via the Supabase client, then route into the
 *      app (or back to /login on cancel/failure). The global AuthProvider also
 *      reacts to the resulting session, so the app is authenticated either way.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabaseClient } from "@/lib/supabase";
import { resolveLandingPage } from "@app/services/landing-page";

/** The Supabase client, or null when it isn't configured (or prod misconfig). */
function safeSupabaseClient(): ReturnType<typeof getSupabaseClient> {
  try {
    return getSupabaseClient();
  } catch {
    return null;
  }
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Finishing sign-in…");

  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    const search = window.location.search.startsWith("?")
      ? window.location.search.slice(1)
      : "";
    const params = hash || search;

    // (1) Popup flow → hand the token back to the opener that started Connect Drive.
    if (window.opener && params) {
      window.opener.postMessage(
        { source: "nyrima-oauth-callback", params },
        window.location.origin,
      );
      setMessage("Connected. You can close this window.");
      window.setTimeout(() => {
        try {
          window.close();
        } catch {
          /* ignore */
        }
      }, 400);
      return;
    }

    // (2) Full-page account OAuth return.
    const url = new URL(window.location.href);
    const oauthError =
      url.searchParams.get("error_description") ?? url.searchParams.get("error");

    // No Supabase client (e.g. local mock dev) → just leave the callback URL.
    const client = safeSupabaseClient();
    if (!client) {
      setMessage("Redirecting…");
      const t = window.setTimeout(
        () => navigate(resolveLandingPage(), { replace: true }),
        400,
      );
      return () => window.clearTimeout(t);
    }

    // Google consent was denied / errored → back to the sign-in screen.
    if (oauthError) {
      setMessage("Sign-in didn't complete. Redirecting…");
      const t = window.setTimeout(() => navigate("/login", { replace: true }), 700);
      return () => window.clearTimeout(t);
    }

    // Finalize the PKCE exchange. `getSession()` awaits the client's
    // detectSessionInUrl handling, so the freshly-exchanged session is present
    // once it resolves; a short grace retry covers any init ordering.
    let cancelled = false;
    const activeClient = client;
    setMessage("Finishing sign-in…");
    void (async () => {
      try {
        let session = (await activeClient.auth.getSession()).data.session;
        if (!session && !cancelled) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          session = (await activeClient.auth.getSession()).data.session;
        }
        if (cancelled) return;
        navigate(session ? resolveLandingPage() : "/login", { replace: true });
      } catch {
        if (!cancelled) navigate("/login", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#070812",
        color: "#f8f7ff",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontSize: "13px",
        letterSpacing: "0.06em",
      }}
    >
      {message}
    </div>
  );
}
