/**
 * GuestBanner — a subtle, dismissible strip shown across the app while the user
 * is in "Try Nyrima" guest mode. Explains the boundary (watch freely; social +
 * cloud sync are off) and offers a one-tap path to sign in.
 *
 * Placement: rendered by AppShell above the routed page, but suppressed on the
 * player route so it never sits over video. Dismissal is remembered for the
 * rest of the browser session (sessionStorage) so it doesn't nag after the user
 * has acknowledged it once.
 */

import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import "./GuestBanner.scss";

const DISMISS_KEY = "nyrima.guest.banner.dismissed";

function wasDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function GuestBanner() {
  const { status } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(wasDismissed);

  // Guest-only, and never over the player.
  if (status !== "guest") return null;
  if (location.pathname.startsWith("/play")) return null;
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(DISMISS_KEY, "1");
      } catch {
        /* private mode — banner just won't persist its dismissal */
      }
    }
  };

  return (
    <div className="ny-guest-banner" role="status">
      <span className="ny-guest-banner__dot" aria-hidden="true" />
      <p className="ny-guest-banner__text">
        You're using Nyrima as a guest. Watch freely, but social and cloud sync
        are disabled.
      </p>
      <div className="ny-guest-banner__actions">
        <button
          type="button"
          className="ny-guest-banner__signin"
          onClick={() => navigate("/login")}
        >
          Sign in
        </button>
        <button
          type="button"
          className="ny-guest-banner__dismiss"
          onClick={dismiss}
          aria-label="Dismiss guest notice"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
