/**
 * LocalAccessGate — wraps the `/play`, `/read`, and `/music/player` routes.
 *
 * `localLibrary` only has a usable root handle once
 * `useLocalLibraryStore`'s status is `"ready"` / `"indexing"` / `"error"`
 * (all three set the handle before anything async can fail). On a fresh
 * session, a persisted handle normally comes back as `"needs-permission"` —
 * `requestPermission()` only succeeds inside a click handler, so a deep link
 * straight into the player can't recover on its own. This gate intercepts
 * those states for routes whose id params are local, showing a one-button
 * recovery screen instead of letting the page's Drive-oriented load/error
 * logic run against a disconnected local library.
 */

import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, FolderOpen, HardDrive, RefreshCw } from "lucide-react";
import { isLocalId } from "@shared/local-id";
import { useLocalLibraryStore } from "../services/local-library/local-library-store";
import { LibraryStatePanel } from "./library-hub/LibraryStates";
import "../pages/AllLibraryPage.scss";

export function LocalAccessGate({ children }: { children: ReactNode }) {
  const params = useParams();
  const status = useLocalLibraryStore((s) => s.status);
  const rootName = useLocalLibraryStore((s) => s.rootName);
  const connect = useLocalLibraryStore((s) => s.connect);
  const reconnect = useLocalLibraryStore((s) => s.reconnect);
  const [busy, setBusy] = useState(false);

  const hasLocalParam = Object.values(params).some((value) => isLocalId(value));
  if (!hasLocalParam) return <>{children}</>;

  const run = (action: () => Promise<void>) => () => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };

  if (status === "needs-permission") {
    return (
      <GateShell>
        <LibraryStatePanel
          icon={<HardDrive />}
          tracker="Local source"
          title="Local library paused"
          message={`Nyrima remembers "${rootName || "your folder"}" but needs permission again to open this file.`}
          tone="accent"
          action={
            <button type="button" className="ny-btn ny-btn--primary" disabled={busy} onClick={run(reconnect)}>
              <RefreshCw aria-hidden="true" /> Re-grant access
            </button>
          }
        />
      </GateShell>
    );
  }

  if (status === "disconnected") {
    return (
      <GateShell>
        <LibraryStatePanel
          icon={<FolderOpen />}
          tracker="Local source"
          title="Local library not connected"
          message="This item lives in a local folder. Reconnect it to keep playing — Nyrima picks up right where you left off."
          action={
            <button type="button" className="ny-btn ny-btn--primary" disabled={busy} onClick={run(connect)}>
              <FolderOpen aria-hidden="true" /> Connect local folder
            </button>
          }
        />
      </GateShell>
    );
  }

  if (status === "unsupported") {
    return (
      <GateShell>
        <LibraryStatePanel
          icon={<AlertTriangle />}
          tracker="Local source"
          title="Local folders aren't supported in this browser"
          message="This item lives in a local folder, which needs the File System Access API (Chrome, Edge, or another Chromium-based browser)."
          tone="warning"
        />
      </GateShell>
    );
  }

  // "ready" | "indexing" | "error" — the local library already has a root
  // handle (set before either of those states), so the page's own load
  // effect can resolve the file normally.
  return <>{children}</>;
}

function GateShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", padding: "32px" }}>
      {children}
    </div>
  );
}
