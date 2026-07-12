/**
 * AppFooter — the bottom bar.
 *
 * Replaces the old three-mono-span chrome with a useful status strip:
 *
 *   Left:    live drive status pulse + library/episode/watched counts.
 *   Centre:  kana caption + brand line + Nyrima Drive folder shortcut.
 *   Right:   keyboard shortcut hint + build stamp.
 *
 * Data comes from stores the rest of the app already maintains:
 *   - useNyrimaRootStore.root      → drive connection state
 *   - useRecentStore.folders       → aggregate library stats
 *   - usePlaybackPositions         → in-progress + watched counts
 *
 * Suppressed on routes where the footer would compete with the page
 * chrome (player + onboarding) — the parent AppShell decides whether to
 * mount us.
 */

import { useMemo } from "react";
import { useNyrimaRootStore } from "../stores/nyrima-root-store";
import { useRecentStore } from "../stores/recent-store";
import { usePlaybackPositions } from "../hooks/usePlaybackPositions";
import { isInProgress } from "../services/storage";
import { driveFolderUrl } from "@shared/drive-urls";
import "./AppFooter.scss";

export function AppFooter() {
  const root = useNyrimaRootStore((s) => s.root);
  const rootError = useNyrimaRootStore((s) => s.rootError);
  const libraries = useNyrimaRootStore((s) => s.libraries);
  const recentFolders = useRecentStore((s) => s.folders);
  const [positions] = usePlaybackPositions();

  const stats = useMemo(() => {
    let videos = 0;
    let runtimeMs = 0;
    let watched = 0;
    let inProgress = 0;
    for (const f of recentFolders) {
      if (f.videoCount != null) videos += f.videoCount;
      if (f.runtimeMs) runtimeMs += f.runtimeMs;
      if (f.watchedCount) watched += f.watchedCount;
    }
    // Live in-progress count comes from the playback positions store —
    // RecentFolder.watchedCount is a snapshot written on visit, so it
    // lags the truth. inProgress here is "started but not finished".
    for (const p of Object.values(positions)) {
      if (isInProgress(p)) inProgress++;
    }
    return {
      libraries: libraries.length,
      videos,
      runtimeMs,
      watched,
      inProgress,
    };
  }, [recentFolders, libraries.length, positions]);

  const status = computeStatus(root, rootError);

  return (
    <footer className="dc-footer" role="contentinfo">
      <div className="dc-footer__cluster dc-footer__cluster--left">
        <span
          className={`dc-footer__pulse is-${status.tone}`}
          title={status.tooltip}
          aria-label={status.tooltip}
        >
          <span className="dc-footer__pulse-dot" />
          <span className="dc-footer__pulse-label">{status.label}</span>
        </span>

        {root && (
          <>
            <FooterDivider />
            <FooterStat label="LIB" value={stats.libraries} />
            {stats.videos > 0 && (
              <FooterStat
                label="EPS"
                value={stats.videos.toLocaleString()}
              />
            )}
            {stats.runtimeMs > 0 && (
              <FooterStat label="RUNTIME" value={formatRuntime(stats.runtimeMs)} />
            )}
            {stats.inProgress > 0 && (
              <FooterStat
                label="IN PROGRESS"
                value={stats.inProgress}
                tone="brand"
              />
            )}
            {stats.watched > 0 && (
              <FooterStat label="WATCHED" value={stats.watched} />
            )}
          </>
        )}
      </div>

      <div className="dc-footer__cluster dc-footer__cluster--center">
        <span className="dc-footer__kana">Nyrima</span>
        <span className="dc-footer__brand">
          nyrima · personal cinema for google drive
        </span>
        {root && (
          <a
            className="dc-footer__drive-link"
            href={driveFolderUrl(root.id)}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open "${root.name}" on Google Drive`}
          >
            <DriveGlyph />
            <span>{root.name}</span>
          </a>
        )}
      </div>

      <div className="dc-footer__cluster dc-footer__cluster--right">
        <span className="dc-footer__hint">
          <kbd>/</kbd>
          <span>search</span>
        </span>
        <span className="dc-footer__hint">
          <kbd>?</kbd>
          <span>shortcuts</span>
        </span>
        <FooterDivider />
        <span className="dc-footer__build">BUILD 0.0.1</span>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------

function FooterStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "brand";
}) {
  return (
    <span className={`dc-footer__stat${tone ? ` is-${tone}` : ""}`}>
      <span className="dc-footer__stat-value">{value}</span>
      <span className="dc-footer__stat-label">{label}</span>
    </span>
  );
}

function FooterDivider() {
  return <span className="dc-footer__divider" aria-hidden="true" />;
}

function DriveGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" width="11" height="11">
      <path
        d="m5.5 2 5 0 4 6.5-2 0M5.5 2l-4 6.5 2.5 4M5.5 2l4 6.5 5 0M3.5 12.5l9 0L14 9.5l-2.5 0M3.5 12.5l-2-4 2.5 0"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------

interface FooterStatus {
  tone: "ok" | "warn" | "off";
  label: string;
  tooltip: string;
}

function computeStatus(
  root: ReturnType<typeof useNyrimaRootStore.getState>["root"],
  rootError: ReturnType<typeof useNyrimaRootStore.getState>["rootError"],
): FooterStatus {
  if (rootError) {
    return {
      tone: "warn",
      label: "DRIVE · ATTENTION",
      tooltip: rootError.message,
    };
  }
  if (!root) {
    return {
      tone: "off",
      label: "DRIVE · NOT PAIRED",
      tooltip: "Pair a Nyrima root folder to enable libraries.",
    };
  }
  return {
    tone: "ok",
    label: "DRIVE · READY",
    tooltip: `Connected to "${root.name}" (verified ${formatRelativeShort(root.verifiedAt)})`,
  };
}

function formatRuntime(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const totalHr = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (totalHr < 24) return m === 0 ? `${totalHr}h` : `${totalHr}h ${m}m`;
  const d = Math.floor(totalHr / 24);
  const h = totalHr % 24;
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}

function formatRelativeShort(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return "just now";
  if (delta < 60 * 60_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / (24 * 3_600_000))}d ago`;
}
