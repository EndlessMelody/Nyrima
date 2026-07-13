/**
 * Connections — the Google Drive link (the streaming identity, separate from
 * the Nyrima account). Shows the connected Drive profile with a disconnect
 * action and embeds the existing ConnectDriveScreen wizard for setup.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useNyrimaRootStore } from "@app/stores/nyrima-root-store";
import { hasApiKey } from "@app/services/api-key";
import { ConnectDriveScreen } from "@app/components/ConnectDriveScreen";
import {
  getUserProfile,
  clearUserProfile,
} from "@app/services/user-profile";
import { signOut as driveSignOut } from "@app/services/auth";
import type { UserProfile } from "@shared/types";
import type { SectionProps } from "../registry";

export function ConnectionsSection({ highlightSettingId: _ }: SectionProps) {
  const { canAccess } = useAuth();
  const root = useNyrimaRootStore((s) => s.root);
  const loadRoot = useNyrimaRootStore((s) => s.load);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [driveProfile, setDriveProfile] = useState<UserProfile | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadRoot();
    void hasApiKey().then((v) => {
      if (!cancelled) setKeyConfigured(v);
    });
    void getUserProfile().then((p) => {
      if (!cancelled) setDriveProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [loadRoot]);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await driveSignOut();
      await clearUserProfile();
      setDriveProfile(null);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="ny-ac__section-body">
      <div className="ny-ac__card" data-setting-id="connection-drive">
        <div className="ny-ac__row">
          <div className="ny-ac__connection">
            <GoogleDriveGlyph />
            <div>
              <div className="ny-ac__row-label">Google Drive</div>
              {driveProfile ? (
                <div className="ny-ac__row-sub">
                  {driveProfile.name ?? "Connected"}
                  {driveProfile.email && ` · ${driveProfile.email}`}
                  {" · streaming uses your personal quota"}
                </div>
              ) : (
                <div className="ny-ac__row-sub">
                  Not connected. Link a Google account below to stream your
                  libraries.
                </div>
              )}
            </div>
          </div>
          {driveProfile && (
            <button
              type="button"
              className="ny-btn ny-ac__danger-btn"
              disabled={disconnecting}
              onClick={() => void handleDisconnect()}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          )}
        </div>
      </div>

      <div className="ny-ac__card ny-ac__card--flush">
        <ConnectDriveScreen
          keyConfigured={!!keyConfigured}
          rootPaired={!!root}
          rootName={root?.name ?? null}
          onKeySaved={() => setKeyConfigured(true)}
        />
      </div>

      {!canAccess("social:profile") && (
        <p className="ny-ac__muted">
          Drive stays connected across guest sessions on this browser — it is
          independent of your Nyrima account.
        </p>
      )}
    </div>
  );
}

function GoogleDriveGlyph() {
  return (
    <svg
      className="ny-ac__connection-glyph"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8.5 3.5h7L22 15l-3.5 6h-13L2 15 8.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 3.5 15 15H2M15.5 3.5 9 15l3.5 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
