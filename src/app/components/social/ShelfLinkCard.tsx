/**
 * ShelfLinkCard — always-visible identity + share-link strip at the top of
 * the Social hub.
 *
 * Why this sits inside the page (not on the topbar): the URL is the most
 * actionable thing a user does in the hub — they paste it into Discord,
 * SMS, etc. Keeping it one tap away from every tab means "go to social,
 * grab my link" never requires a detour through Privacy or My Shares.
 *
 * State surfaces:
 *   - profile null         → "Pick a handle" CTA (opens the share composer
 *                            which carries the picker).
 *   - profile, no folder   → "Create your shelf" CTA (calls ensureFolders,
 *                            which lazily creates the flat Shared/ folder).
 *   - profile + folder     → avatar + handle + Drive URL + copy/open +
 *                            public/private pill (clickable → toggles).
 *
 * The public toggle here is the same primitive PrivacyPanel uses, just
 * surfaced inline so the user can flip visibility in one click without
 * switching tabs. PrivacyPanel keeps its longer-form explanation copy.
 */

import { useEffect, useState } from "react";
import cn from "classnames";
import { useSharingStore } from "../../stores/sharing-store";
import {
  publishSharedFolder,
  unpublishSharedFolder,
} from "../../services/sharing/share-permissions";

interface Props {
  /** Render nothing while the profile is still hydrating from chrome.storage
   *  — avoids a flash of "Pick a handle" on every Social mount. */
  ready: boolean;
}

export function ShelfLinkCard({ ready }: Props) {
  const profile = useSharingStore((s) => s.profile);
  const folders = useSharingStore((s) => s.folders);
  const ensureFolders = useSharingStore((s) => s.ensureFolders);
  const isPublic = useSharingStore((s) => s.isPublic);
  const refreshPublicState = useSharingStore((s) => s.refreshPublicState);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Auto-ensure folder once the profile is loaded — gives the user the URL
  // immediately without needing to share something first. Cheap on cached
  // installs (one chrome.storage read); only pays Drive cost the very first
  // time after a fresh Nyrima root pairing.
  useEffect(() => {
    if (!ready || !profile || folders) return;
    let cancelled = false;
    setCreating(true);
    void ensureFolders()
      .then(() => {
        if (!cancelled) {
          setCreateError(null);
          void refreshPublicState();
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setCreateError(
            e instanceof Error ? e.message : "Couldn't create your Shared/ folder.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCreating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, profile, folders, ensureFolders, refreshPublicState]);

  if (!ready) return null;

  if (!profile) {
    return (
      <section className="ny-shelf-link ny-shelf-link--prompt" aria-label="Set up your Nyrima identity">
        <div className="ny-shelf-link__head">
          <div className="ny-shelf-link__avatar ny-shelf-link__avatar--empty">
            <span aria-hidden>?</span>
          </div>
          <div className="ny-shelf-link__copy">
            <p className="ny-shelf-link__title">Pick a handle to publish your shelf.</p>
            <p className="ny-shelf-link__sub">
              Your <code>Shared/</code> folder becomes the URL you give friends.
            </p>
          </div>
        </div>
        <div className="ny-shelf-link__actions">
          <button
            type="button"
            className="ny-shelf-link__btn ny-shelf-link__btn--primary"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("nyrima:topbar", { detail: { scope: "share" } }),
              )
            }
            style={{ gridColumn: "1 / -1" }}
          >
            Set up
          </button>
        </div>
      </section>
    );
  }

  const folderUrl = folders
    ? `https://drive.google.com/drive/folders/${folders.root}`
    : null;

  async function copyUrl() {
    if (!folderUrl) return;
    try {
      await navigator.clipboard.writeText(folderUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard write rejected (rare in extension context) — fall back
      // to a manual select. Keeping the button silent on failure beats a
      // surprise toast that re-opens after dismissing.
    }
  }

  async function togglePublic() {
    if (!folders) return;
    setTogglingPublic(true);
    setToggleError(null);
    try {
      if (isPublic === true) {
        await unpublishSharedFolder(folders.root);
      } else {
        await publishSharedFolder(folders.root);
      }
      await refreshPublicState({ force: true });
    } catch (e) {
      setToggleError(
        e instanceof Error ? e.message : "Couldn't update folder visibility.",
      );
    } finally {
      setTogglingPublic(false);
    }
  }

  const displayName = profile.name ?? profile.handle;
  const initial = displayName[0]?.toUpperCase() ?? "?";

  return (
    <section className="ny-shelf-link" aria-label="Your shelf link">
      <div className="ny-shelf-link__head">
        <div className="ny-shelf-link__avatar">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span aria-hidden>{initial}</span>
          )}
        </div>

        <div className="ny-shelf-link__copy">
          <div className="ny-shelf-link__name-row">
            <span className="ny-shelf-link__name">{displayName}</span>
            <span className="ny-shelf-link__handle">@{profile.handle}</span>
          </div>
          <PublicChip
            isPublic={isPublic}
            pending={togglingPublic}
            disabled={!folderUrl || togglingPublic}
            onToggle={() => void togglePublic()}
          />
        </div>
      </div>

      {folderUrl ? (
        <a
          className="ny-shelf-link__url"
          href={folderUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={folderUrl}
        >
          {prettyUrl(folderUrl)}
        </a>
      ) : creating ? (
        <span className="ny-shelf-link__url is-muted">
          Creating your Shared/ folder…
        </span>
      ) : createError ? (
        <span className="ny-shelf-link__url is-error" title={createError}>
          {createError}
        </span>
      ) : (
        <span className="ny-shelf-link__url is-muted">
          Pair your Nyrima root to publish a shelf URL.
        </span>
      )}
      {toggleError && (
        <span className="ny-shelf-link__url is-error" title={toggleError}>
          {toggleError}
        </span>
      )}

      <div className="ny-shelf-link__actions">
        <button
          type="button"
          className={cn("ny-shelf-link__btn", { "is-copied": copied })}
          onClick={() => void copyUrl()}
          disabled={!folderUrl}
          aria-label="Copy shelf URL"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <a
          className={cn("ny-shelf-link__btn", "ny-shelf-link__btn--ghost", {
            "is-disabled": !folderUrl,
          })}
          href={folderUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!folderUrl}
        >
          Open
        </a>
      </div>
    </section>
  );
}

function PublicChip({
  isPublic,
  pending,
  disabled,
  onToggle,
}: {
  isPublic: boolean | null;
  pending: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const state = pending ? "pending" : isPublic === true ? "public" : isPublic === false ? "private" : "unknown";
  const label =
    pending
      ? "Updating…"
      : isPublic === true
        ? "Public"
        : isPublic === false
          ? "Private"
          : "Probing…";
  return (
    <button
      type="button"
      className={cn("ny-shelf-link__chip", `is-${state}`)}
      onClick={onToggle}
      disabled={disabled}
      title={
        isPublic === true
          ? "Click to make your shelf private."
          : "Click to publish your shelf (Anyone with the link can read your index)."
      }
    >
      <span className="ny-shelf-link__chip-dot" />
      <span>{label}</span>
    </button>
  );
}

/** Compact URL display: drops the protocol + the leading
 *  `drive.google.com/` so the folder id stays visible without sprawling. */
function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "");
}
