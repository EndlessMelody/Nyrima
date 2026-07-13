/**
 * ProfileHeader — banner/avatar/bio/genres/social-links/pinned card at the
 * top of the profile dashboard, plus the edit (self) / add-friend (other)
 * action. First real UI surface for `sendFriendRequest` (the friendships
 * table existed but had no caller before this).
 */

import { useState } from "react";
import { sendFriendRequest, type SocialProfile } from "../../services/social/social-api";
import "./ProfileHeader.scss";

interface Props {
  profile: SocialProfile;
  isSelf: boolean;
  onEdit: () => void;
}

export function ProfileHeader({ profile, isSelf, onEdit }: Props) {
  const [friendState, setFriendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const displayName = profile.displayName || profile.handle || "Nyrima user";
  const initial = displayName[0]?.toUpperCase() ?? "?";

  async function handleAddFriend() {
    setFriendState("sending");
    try {
      await sendFriendRequest(profile.id);
      setFriendState("sent");
    } catch {
      setFriendState("error");
    }
  }

  return (
    <header className="ny-profile-header">
      <div className="ny-profile-header__banner" aria-hidden="true" />
      <div className="ny-profile-header__body">
        {profile.avatarUrl ? (
          <img
            className="ny-profile-header__avatar"
            src={profile.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="ny-profile-header__avatar ny-profile-header__avatar--mono">
            {initial}
          </span>
        )}

        <div className="ny-profile-header__id">
          <h1 className="ny-profile-header__name">{displayName}</h1>
          {profile.handle && (
            <span className="ny-profile-header__handle">@{profile.handle}</span>
          )}
          {profile.bio && <p className="ny-profile-header__bio">{profile.bio}</p>}

          {profile.genres.length > 0 && (
            <div className="ny-profile-header__genres">
              {profile.genres.map((g) => (
                <span key={g} className="ny-profile-header__genre">
                  {g}
                </span>
              ))}
            </div>
          )}

          {profile.socialLinks.length > 0 && (
            <div className="ny-profile-header__links">
              {profile.socialLinks.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ny-profile-header__link"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}

          {profile.pinnedLabel && (
            <div className="ny-profile-header__pinned">
              <span className="ny-profile-header__pinned-tag">
                {profile.pinnedKind === "post" ? "Pinned post" : "Pinned library"}
              </span>
              <span className="ny-profile-header__pinned-label">{profile.pinnedLabel}</span>
            </div>
          )}
        </div>

        <div className="ny-profile-header__actions">
          {isSelf ? (
            <button type="button" className="ny-btn ny-btn--primary" onClick={onEdit}>
              Edit profile
            </button>
          ) : (
            <button
              type="button"
              className="ny-btn ny-btn--primary"
              disabled={friendState === "sending" || friendState === "sent"}
              onClick={() => void handleAddFriend()}
            >
              {friendState === "sent"
                ? "Request sent"
                : friendState === "sending"
                  ? "Sending…"
                  : friendState === "error"
                    ? "Try again"
                    : "Add friend"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
