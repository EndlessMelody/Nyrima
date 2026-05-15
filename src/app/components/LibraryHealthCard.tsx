/**
 * LibraryHealthCard — compact stats panel for the lobby's right rail.
 *
 * Numbers derive entirely from already-loaded state (recent folders +
 * stored playback positions) so this never costs a Drive round-trip.
 * Labels stay friendly — "Ready", not "0 errors".
 */

import { useMemo } from "react";
import type { PlaybackPosition, RecentFolder } from "@shared/types";
import { isInProgress, isWatched } from "../services/storage";
import "./LibraryHealthCard.scss";

interface Props {
  folders: RecentFolder[];
  positions: Record<string, PlaybackPosition>;
  apiKeyConfigured: boolean | null;
  onOpenSetup: () => void;
  onOpenFolder: () => void;
}

export function LibraryHealthCard({
  folders,
  positions,
  apiKeyConfigured,
  onOpenSetup,
  onOpenFolder,
}: Props) {
  const stats = useMemo(() => {
    const allPositions = Object.values(positions);
    const inProgress = allPositions.filter(isInProgress).length;
    const watched = allPositions.filter(isWatched).length;
    const tracked = allPositions.length;

    const lastScan = folders.reduce(
      (max, f) => Math.max(max, f.lastOpenedAt),
      0,
    );

    return { inProgress, watched, tracked, lastScan };
  }, [folders, positions]);

  return (
    <aside className="ny-health" aria-label="Library health">
      <header className="ny-health__head">
        <span className="ny-health__eyebrow">状況 · LIBRARY HEALTH</span>
        <StatusDot configured={apiKeyConfigured} hasFolders={folders.length > 0} />
      </header>

      <ul className="ny-health__metrics">
        <Metric label="Libraries" value={String(folders.length)} />
        <Metric label="Tracked videos" value={String(stats.tracked)} />
        <Metric label="In progress" value={String(stats.inProgress)} accent="brand" />
        <Metric label="Watched" value={String(stats.watched)} accent="accent" />
      </ul>

      <div className="ny-health__row">
        <span className="ny-health__row-label">Drive access</span>
        <span
          className={`ny-health__row-pill ${
            apiKeyConfigured
              ? "ny-health__row-pill--ok"
              : "ny-health__row-pill--warn"
          }`}
        >
          {apiKeyConfigured ? "Ready" : "Needs setup"}
        </span>
      </div>

      <div className="ny-health__row">
        <span className="ny-health__row-label">Last opened</span>
        <span className="ny-health__row-value">
          {stats.lastScan ? formatRelative(stats.lastScan) : "—"}
        </span>
      </div>

      <div className="ny-health__actions">
        <button
          type="button"
          className="ny-btn ny-btn--primary ny-health__cta"
          onClick={onOpenFolder}
        >
          Open a folder
        </button>
        <button
          type="button"
          className="ny-btn ny-btn--ghost ny-health__cta"
          onClick={onOpenSetup}
        >
          {apiKeyConfigured ? "Manage access" : "Setup access"}
        </button>
      </div>
    </aside>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "brand" | "accent";
}) {
  return (
    <li className={`ny-health__metric${accent ? ` is-${accent}` : ""}`}>
      <span className="ny-health__metric-value">{value}</span>
      <span className="ny-health__metric-label">{label}</span>
    </li>
  );
}

function StatusDot({
  configured,
  hasFolders,
}: {
  configured: boolean | null;
  hasFolders: boolean;
}) {
  if (configured === null) {
    return <span className="dc-status-dot" aria-label="Checking access" />;
  }
  if (configured && hasFolders) {
    return (
      <span
        className="dc-status-dot dc-status-dot--ok"
        aria-label="Ready"
        title="Ready"
      />
    );
  }
  if (configured && !hasFolders) {
    return (
      <span
        className="dc-status-dot dc-status-dot--warn"
        aria-label="No libraries opened yet"
        title="No libraries opened yet"
      />
    );
  }
  return (
    <span
      className="dc-status-dot dc-status-dot--err"
      aria-label="API key not configured"
      title="API key not configured"
    />
  );
}

function formatRelative(epoch: number): string {
  const diff = Date.now() - epoch;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(epoch).toLocaleDateString();
}
