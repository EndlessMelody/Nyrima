/**
 * AccountPage — the signed-in Nyrima account + its linked Drive identity.
 *
 * Distinguishes the two identities the product keeps separate:
 *   - Nyrima account (from AuthProvider) — who you signed in as
 *   - Drive connection (from the stored UserProfile) — which Google account is
 *     linked for streaming, if any
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { getUserProfile } from "@app/services/user-profile";
import type { UserProfile } from "@shared/types";
import "./AccountPage.scss";

export function AccountPage() {
  const navigate = useNavigate();
  const { status, account, signOut, exitGuestMode } = useAuth();
  const isGuest = status === "guest";
  const [driveProfile, setDriveProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getUserProfile().then((p) => {
      if (!cancelled) setDriveProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }

  const initial = account?.displayName?.[0]?.toUpperCase() ?? "U";
  const memberSince = account?.createdAt
    ? new Date(account.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  return (
      <div className="ny-account">
      <header className="ny-account__head">
        <span className="dc-tracker">Account</span>
        <h1 className="ny-account__title">Your account</h1>
      </header>

      {isGuest ? (
        <section className="ny-account__card">
          <span className="ny-account__avatar">G</span>
          <div className="ny-account__identity">
            <span className="ny-account__name">Guest</span>
            <span className="ny-account__meta">
              You're using Nyrima without an account. Sign in to unlock your
              profile, friends, comments, and cloud sync.
            </span>
          </div>
          <div className="ny-account__guest-actions">
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
              onClick={() => {
                exitGuestMode();
                navigate("/login", { replace: true });
              }}
            >
              Exit guest mode
            </button>
          </div>
        </section>
      ) : (
        <section className="ny-account__card">
          <span className="ny-account__avatar">{initial}</span>
          <div className="ny-account__identity">
            <span className="ny-account__name">{account?.displayName ?? "—"}</span>
            <span className="ny-account__email">{account?.email}</span>
            <span className="ny-account__meta">
              {account?.method === "google" ? "Google account" : "Email account"} ·
              member since {memberSince}
            </span>
          </div>
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={() => void handleSignOut()}
          >
            Sign out
          </button>
        </section>
      )}

      <section className="ny-account__card ny-account__card--drive">
        <div className="ny-account__identity">
          <span className="ny-account__sub-label">Google Drive connection</span>
          {driveProfile ? (
            <>
              <span className="ny-account__name">
                {driveProfile.name ?? "Connected"}
              </span>
              {driveProfile.email && (
                <span className="ny-account__email">{driveProfile.email}</span>
              )}
              <span className="ny-account__meta">
                Drive is linked. Streaming uses your personal quota.
              </span>
            </>
          ) : (
            <span className="ny-account__meta">
              No Drive connected yet. Connect one in Settings to stream your
              libraries.
            </span>
          )}
        </div>
        <button
          type="button"
          className="ny-btn ny-btn--ghost"
          onClick={() => navigate("/settings")}
        >
          Manage in Settings
        </button>
      </section>
      </div>
  );
}
