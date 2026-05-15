/**
 * Floating debug panel — visible when devMode.showDebugPanel is true OR
 * the URL has ?debug=1.
 *
 * Shows live counters and toggles so we can develop without burning Drive
 * quota and verify the queue/cache layer is behaving:
 *   - Queue depth (active vs queued per kind)
 *   - RPM (rolling 60s window)
 *   - Cache hits / misses / revalidations
 *   - Dedup hits / misses
 *   - Cooldown countdown
 *   - Toggles for cacheOnly / disablePrefetch / RPM cap / mock mode
 *   - "Clear Nyrima cache" button
 *
 * The panel polls once a second; keeping it cheap is more important than
 * being instantaneous. State changes (toggles, clears) re-fetch immediately.
 */

import { useEffect, useState } from "react";
import { useDevModeStore, getRpm } from "../services/drive/dev-mode";
import { driveQueue } from "../services/drive/request-queue";
import { getDedupStats } from "../services/drive/dedup";
import { getMetadataCacheStats } from "../services/drive/metadata-service";
import { useRateLimitStore } from "../services/drive/rate-limit-store";
import "./DriveDebugPanel.scss";

export function DriveDebugPanel() {
  const flags = useDevModeStore();
  const cooling = useRateLimitStore((s) => s.isCooling);
  const coolingUntil = useRateLimitStore((s) => s.coolingUntil);
  const [tick, setTick] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!flags.showDebugPanel && !urlHasDebug()) return null;

  const queueStats = driveQueue.getStats();
  const dedupStats = getDedupStats();
  const cacheStats = getMetadataCacheStats();
  const rpm = getRpm();

  return (
    <div className={`ny-debug ${collapsed ? "is-collapsed" : ""}`}>
      <div className="ny-debug__head">
        <span className="ny-debug__title">DRIVE DEBUG</span>
        <button
          type="button"
          className="ny-debug__toggle"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? "▴" : "▾"}
        </button>
      </div>

      {!collapsed && (
        <div className="ny-debug__body" data-tick={tick}>
          <section>
            <h4>Queue</h4>
            <div className="ny-debug__row">
              <span>Active</span>
              <strong>{queueStats.totalActive}</strong>
            </div>
            <div className="ny-debug__row">
              <span>Queued</span>
              <strong>{queueStats.totalQueued}</strong>
            </div>
            <div className="ny-debug__sub">
              {Object.entries(queueStats.active).map(([k, n]) => (
                <span key={k}>
                  {k}: {n}/{queueStats.queued[k as keyof typeof queueStats.queued]}
                </span>
              ))}
            </div>
            <div className="ny-debug__row">
              <span>RPM</span>
              <strong className={rpm > 50 ? "is-warn" : undefined}>{rpm}</strong>
            </div>
            {cooling && (
              <div className="ny-debug__row is-warn">
                <span>Cooldown</span>
                <strong>
                  {Math.max(0, Math.ceil((coolingUntil - Date.now()) / 1000))}s
                </strong>
              </div>
            )}
          </section>

          <section>
            <h4>Cache</h4>
            <div className="ny-debug__row">
              <span>Folder hits</span>
              <strong>{cacheStats.folderHits}</strong>
            </div>
            <div className="ny-debug__row">
              <span>Folder stale</span>
              <strong>{cacheStats.folderStaleHits}</strong>
            </div>
            <div className="ny-debug__row">
              <span>Folder miss</span>
              <strong>{cacheStats.folderMisses}</strong>
            </div>
            <div className="ny-debug__row">
              <span>File hits</span>
              <strong>{cacheStats.fileHits}</strong>
            </div>
            <div className="ny-debug__row">
              <span>File miss</span>
              <strong>{cacheStats.fileMisses}</strong>
            </div>
            <div className="ny-debug__row">
              <span>Subs hit/miss</span>
              <strong>
                {cacheStats.subtitleHits} / {cacheStats.subtitleMisses}
              </strong>
            </div>
            <div className="ny-debug__row">
              <span>Revalidations</span>
              <strong>{cacheStats.revalidations}</strong>
            </div>
            <div className="ny-debug__row">
              <span>Dedup hit/miss</span>
              <strong>
                {dedupStats.hits} / {dedupStats.misses}
              </strong>
            </div>
          </section>

          <section>
            <h4>Safe mode</h4>
            <label className="ny-debug__check">
              <input
                type="checkbox"
                checked={flags.cacheOnly}
                onChange={(e) => void flags.patch({ cacheOnly: e.target.checked })}
              />
              <span>Cache only (never hit Drive)</span>
            </label>
            <label className="ny-debug__check">
              <input
                type="checkbox"
                checked={flags.disablePrefetch}
                onChange={(e) =>
                  void flags.patch({ disablePrefetch: e.target.checked })
                }
              />
              <span>Disable background prefetch</span>
            </label>
            <label className="ny-debug__check">
              <input
                type="checkbox"
                checked={flags.mockMode}
                onChange={(e) => void flags.patch({ mockMode: e.target.checked })}
              />
              <span>Mock mode (fixtures)</span>
            </label>
            <label className="ny-debug__field">
              <span>RPM cap</span>
              <input
                type="number"
                min={0}
                max={600}
                value={flags.rpmCap}
                onChange={(e) =>
                  void flags.patch({
                    rpmCap: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="ny-debug__action"
              onClick={() => void flags.clearAllCaches()}
            >
              Clear Nyrima cache
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function urlHasDebug(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}
