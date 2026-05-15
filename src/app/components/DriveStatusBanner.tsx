/**
 * DriveStatusBanner — surfaces non-error Drive states.
 *
 * Two cases this lights up:
 *  1. Drive is rate-limiting us — show a calm "cooling down" pill so the
 *     user knows playback / scans will resume on their own.
 *  2. The current library is being refreshed in the background while the
 *     UI renders from the IDB cache — show a subtle "syncing" pill.
 *
 * Either state is informational, not blocking. The banner never replaces
 * content; it sits in the header area as a chip.
 */

import { useEffect, useState } from "react";
import { useRateLimitStore } from "../services/drive/rate-limit-store";
import "./DriveStatusBanner.scss";

interface Props {
  refreshing?: boolean;
  /** Epoch ms of the cached snapshot currently rendered. */
  cacheAgeAt?: number;
  onRefresh?: () => void;
}

export function DriveStatusBanner({ refreshing, cacheAgeAt, onRefresh }: Props) {
  const cooling = useRateLimitStore((s) => s.isCooling);
  const coolingUntil = useRateLimitStore((s) => s.coolingUntil);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!cooling) {
      setRemaining(0);
      return;
    }
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((coolingUntil - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [cooling, coolingUntil]);

  if (cooling) {
    return (
      <div className="ny-drive-banner ny-drive-banner--cooling" role="status">
        <span className="ny-drive-banner__pulse" aria-hidden />
        <span>
          Drive is cooling down — playback will resume in{" "}
          <strong>{remaining}s</strong>
        </span>
      </div>
    );
  }

  if (refreshing) {
    return (
      <div className="ny-drive-banner ny-drive-banner--refreshing" role="status">
        <span className="ny-drive-banner__spinner" aria-hidden />
        <span>Refreshing library in the background…</span>
        {cacheAgeAt ? (
          <span className="ny-drive-banner__sub">
            Showing cached library from {formatAge(cacheAgeAt)}
          </span>
        ) : null}
      </div>
    );
  }

  if (cacheAgeAt && onRefresh) {
    return (
      <div className="ny-drive-banner ny-drive-banner--cached" role="status">
        <span>Cached library from {formatAge(cacheAgeAt)}</span>
        <button
          type="button"
          className="ny-drive-banner__btn"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>
    );
  }

  return null;
}

function formatAge(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
