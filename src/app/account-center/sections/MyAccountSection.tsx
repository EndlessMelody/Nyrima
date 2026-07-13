/**
 * My Account — the Nyrima account card (Supabase identity), Discord-style:
 * banner + avatar header with the editable identity summary, then the
 * account rows. Guests get a sign-in prompt card instead.
 */

import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { useSettingsStore } from "@app/stores/settings-store";
import { useAccountCenter } from "../useAccountCenter";
import type { SectionProps } from "../registry";

export function MyAccountSection({ highlightSettingId: _ }: SectionProps) {
  const navigate = useNavigate();
  const { status, account, signOut, exitGuestMode } = useAuth();
  const settings = useSettingsStore((s) => s.settings);
  const { setSection, close } = useAccountCenter();
  const isGuest = status === "guest";

  async function handleSignOut() {
    close();
    await signOut();
    navigate("/", { replace: true });
  }

  if (isGuest) {
    return (
      <div className="ny-ac__section-body">
        <div className="ny-ac__profile-card" data-setting-id="account-identity">
          <div className="ny-ac__profile-banner ny-ac__profile-banner--guest" />
          <div className="ny-ac__profile-head">
            <span className="ny-ac__profile-avatar ny-ac__profile-avatar--mono">G</span>
            <div className="ny-ac__profile-id">
              <span className="ny-ac__profile-name">Guest</span>
              <span className="ny-ac__profile-sub">Trying Nyrima without an account</span>
            </div>
          </div>
          <div className="ny-ac__profile-body">
            <p className="ny-ac__muted">
              Sign in to unlock your profile, friends, comments, and settings
              sync across devices. Everything you customize as a guest stays on
              this browser.
            </p>
            <div className="ny-ac__actions-row">
              <button
                type="button"
                className="ny-btn ny-btn--primary"
                onClick={() => {
                  close();
                  navigate("/login");
                }}
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
          </div>
        </div>
      </div>
    );
  }

  const displayName =
    settings.profileNickname || account?.displayName || "—";
  const initial = displayName[0]?.toUpperCase() ?? "U";
  const memberSince = account?.createdAt
    ? new Date(account.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  return (
    <div className="ny-ac__section-body">
      <div className="ny-ac__profile-card" data-setting-id="account-identity">
        <div
          className="ny-ac__profile-banner"
          style={
            settings.profileBannerDataUrl
              ? { backgroundImage: `url(${settings.profileBannerDataUrl})` }
              : undefined
          }
        />
        <div className="ny-ac__profile-head">
          {settings.profileAvatarDataUrl ? (
            <img
              className="ny-ac__profile-avatar"
              src={settings.profileAvatarDataUrl}
              alt=""
            />
          ) : (
            <span className="ny-ac__profile-avatar ny-ac__profile-avatar--mono">
              {initial}
            </span>
          )}
          <div className="ny-ac__profile-id">
            <span className="ny-ac__profile-name">{displayName}</span>
            <span className="ny-ac__profile-sub">
              {account?.method === "google" ? "Google account" : "Email account"}
            </span>
          </div>
          <button
            type="button"
            className="ny-btn ny-btn--primary"
            onClick={() => setSection("profile")}
          >
            Edit Profile
          </button>
        </div>

        <div className="ny-ac__profile-body">
          <div className="ny-ac__field-row">
            <div>
              <div className="ny-ac__field-label">Display name</div>
              <div className="ny-ac__field-value">{account?.displayName ?? "—"}</div>
            </div>
          </div>
          <div className="ny-ac__field-row">
            <div>
              <div className="ny-ac__field-label">Email</div>
              <div className="ny-ac__field-value">{account?.email ?? "—"}</div>
            </div>
          </div>
          <div className="ny-ac__field-row">
            <div>
              <div className="ny-ac__field-label">Member since</div>
              <div className="ny-ac__field-value">{memberSince}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="account-sign-out">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Sign out</div>
            <div className="ny-ac__row-sub">
              Ends this session on this device. Your local settings stay.
            </div>
          </div>
          <button
            type="button"
            className="ny-btn ny-ac__danger-btn"
            onClick={() => void handleSignOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
