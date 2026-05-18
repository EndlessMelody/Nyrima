/**
 * PrivacyPanel — control plane for the Shared/ folder's public state.
 *
 * Reads + writes through the existing share-permissions helpers, so the
 * cache stays consistent with the composer's "make Shared/ public" probe.
 *
 * Layout: three rows.
 *   1. Public/Private toggle — the canonical home for what currently lives
 *      as a one-off checkbox inside ShareComposerDialog.
 *   2. Bootstrap directory consent — placeholder for P4.4. Currently
 *      disabled with a "coming with P4.4" hint.
 *   3. Block list — local mute list for handles you don't want to see in
 *      Inbox even if you accidentally followed them. Persists alongside
 *      followedUsers. Placeholder until P4.2 ships the discovery surface
 *      that creates the need.
 */

import { useEffect, useState } from "react";
import { useSharingStore } from "../../stores/sharing-store";
import {
  publishSharedFolder,
  unpublishSharedFolder,
} from "../../services/sharing/share-permissions";

export function PrivacyPanel() {
  const folders = useSharingStore((s) => s.folders);
  const ensureFolders = useSharingStore((s) => s.ensureFolders);
  const isPublic = useSharingStore((s) => s.isPublic);
  const refreshPublicState = useSharingStore((s) => s.refreshPublicState);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Probe Drive on mount so the toggle reflects reality rather than just the
  // cached value. Cheap (single permissions list call) and the result
  // re-seeds the cache.
  useEffect(() => {
    void refreshPublicState();
  }, [refreshPublicState]);

  async function toggle(next: boolean) {
    setPending(true);
    setError(null);
    try {
      const ids = folders ?? (await ensureFolders());
      if (next) {
        await publishSharedFolder(ids.root);
      } else {
        await unpublishSharedFolder(ids.root);
      }
      await refreshPublicState({ force: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update permission.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="ny-social-pane">
      <div className="ny-privacy-row">
        <div className="ny-privacy-row__copy">
          <h3 className="ny-privacy-row__title">Public discovery</h3>
          <p className="ny-privacy-row__sub">
            When public, anyone with the link to your <code>Shared/</code>{" "}
            folder can read your <code>index.json</code>. They never gain
            access to the videos themselves — just the manifest of what
            you've shared. Followers need this on to populate their inbox.
          </p>
        </div>
        <div className="ny-privacy-row__control">
          <div className={`ny-privacy-pill is-${stateLabel(isPublic, pending)}`}>
            <span className="ny-privacy-pill__dot" />
            <span className="ny-privacy-pill__label">
              {stateLabelText(isPublic, pending)}
            </span>
          </div>
          {isPublic ? (
            <button
              type="button"
              className="ny-btn ny-btn--ghost"
              onClick={() => void toggle(false)}
              disabled={pending}
            >
              Make private
            </button>
          ) : (
            <button
              type="button"
              className="ny-btn ny-btn--primary"
              onClick={() => void toggle(true)}
              disabled={pending}
            >
              Make public
            </button>
          )}
        </div>
      </div>
      {error && <p className="ny-privacy-row__error">{error}</p>}

      <div className="ny-privacy-row is-disabled">
        <div className="ny-privacy-row__copy">
          <h3 className="ny-privacy-row__title">
            Listed in the bootstrap directory
          </h3>
          <p className="ny-privacy-row__sub">
            Opt in to appear in Nyrima's discoverable user index so people
            can find you without a link. Ships with P4.4.
          </p>
        </div>
        <div className="ny-privacy-row__control">
          <span className="ny-privacy-pill is-soon">
            <span className="ny-privacy-pill__dot" />
            <span className="ny-privacy-pill__label">P4.4</span>
          </span>
        </div>
      </div>

      <div className="ny-privacy-row is-disabled">
        <div className="ny-privacy-row__copy">
          <h3 className="ny-privacy-row__title">Block list</h3>
          <p className="ny-privacy-row__sub">
            Hide a handle's shares from your Inbox even if you accidentally
            re-follow them. Lands with the discovery surfaces in P4.2.
          </p>
        </div>
        <div className="ny-privacy-row__control">
          <span className="ny-privacy-pill is-soon">
            <span className="ny-privacy-pill__dot" />
            <span className="ny-privacy-pill__label">P4.2</span>
          </span>
        </div>
      </div>
    </section>
  );
}

function stateLabel(isPublic: boolean | null, pending: boolean): string {
  if (pending) return "pending";
  if (isPublic === true) return "public";
  if (isPublic === false) return "private";
  return "unknown";
}

function stateLabelText(isPublic: boolean | null, pending: boolean): string {
  if (pending) return "Working…";
  if (isPublic === true) return "Public";
  if (isPublic === false) return "Private";
  return "Probing…";
}
