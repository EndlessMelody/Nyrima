/**
 * SocialLockedState — the friendly wall a guest hits at any social surface.
 *
 * Guest mode is watch-only: it has no social profile and never talks to the
 * social backend. Rather than hard-redirecting away from `/social`, we let the
 * guest land here and explain — with a clear path to sign in (which unlocks
 * everything) or to keep watching.
 */

import { useNavigate } from "react-router-dom";
import "./SocialLockedState.scss";

export function SocialLockedState() {
  const navigate = useNavigate();

  return (
    <div className="ny-social-locked" role="region" aria-label="Social locked">
      <div className="ny-social-locked__card">
        <span className="ny-social-locked__icon" aria-hidden="true">
          <LockIcon />
        </span>
        <span className="dc-tracker dc-tracker--accent">Social</span>
        <h1 className="ny-social-locked__title">Sign in to unlock Social</h1>
        <p className="ny-social-locked__desc">
          Guest mode is for watching. Create an account to sync your profile,
          friends, comments, and shared activity.
        </p>
        <div className="ny-social-locked__actions">
          <button
            type="button"
            className="ny-btn ny-btn--primary"
            onClick={() => navigate("/login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={() => navigate("/app")}
          >
            Keep watching
          </button>
        </div>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
      <rect
        x="4.5"
        y="10.5"
        width="15"
        height="10"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8 10.5V7.5a4 4 0 0 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
