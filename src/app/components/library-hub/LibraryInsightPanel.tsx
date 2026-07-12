/**
 * LibraryInsightPanel + SourceStatusCard — the compact right insight column.
 *
 * Real values only:
 *   - Library Overview → real total + per-category distribution.
 *   - Storage Used     → Drive exposes no quota to the app, so this shows an
 *                        honest "unavailable" note rather than a fake bar.
 *   - Sources          → real connection state + counts.
 *   - Recent Activity  → real playback history (empty state when none).
 */

import cn from "classnames";
import { Activity, Cloud, HardDrive, PieChart, Server } from "lucide-react";
import type {
  ActivityEntry,
  LibraryInsights,
  SourceState,
  SourceStatusModel,
} from "./types";

export function LibraryInsightPanel({
  insights,
  onConnectSource,
  labels,
}: {
  insights: LibraryInsights;
  onConnectSource?: () => void;
  labels?: {
    overviewTitle?: string;
    totalLabel?: string;
    storageUnavailableText?: string;
    recentActivityTitle?: string;
    recentEmptyText?: string;
  };
}) {
  const max = Math.max(1, ...insights.distribution.map((d) => d.count));
  return (
    <div className="lib-insight__inner">
      {/* Library Overview */}
      <section className="lib-panel">
        <header className="lib-panel__head">
          <span className="lib-panel__icon" aria-hidden="true">
            <PieChart />
          </span>
          <h3>{labels?.overviewTitle ?? "Library Overview"}</h3>
        </header>
        <div className="lib-panel__total">
          <span className="lib-panel__total-value">
            {insights.totalItems.toLocaleString()}
          </span>
          <span className="lib-panel__total-label">
            {labels?.totalLabel ?? "Total items"}
          </span>
        </div>
        <ul className="lib-dist">
          {insights.distribution.map((d) => (
            <li key={d.id ?? d.key} className="lib-dist__row" data-cat={d.key}>
              <span className="lib-dist__label">{d.label}</span>
              <span className="lib-dist__bar" aria-hidden="true">
                <span
                  className="lib-dist__fill"
                  style={{ width: `${d.count > 0 ? Math.max(4, (d.count / max) * 100) : 0}%` }}
                />
              </span>
              <span className="lib-dist__value">{d.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Storage Used — no quota API, so this is honest about being unknown. */}
      <section className="lib-panel">
        <header className="lib-panel__head">
          <span className="lib-panel__icon" aria-hidden="true">
            <Server />
          </span>
          <h3>Storage Used</h3>
        </header>
        <p className="lib-panel__empty">
          {labels?.storageUnavailableText ??
            "Storage usage isn't reported by your connected sources yet."}
        </p>
      </section>

      {/* Sources */}
      <section className="lib-panel">
        <header className="lib-panel__head">
          <span className="lib-panel__icon" aria-hidden="true">
            <Cloud />
          </span>
          <h3>Sources</h3>
        </header>
        <div className="lib-panel__sources">
          {insights.sources.map((s) => (
            <SourceStatusCard key={s.id} source={s} onConnect={onConnectSource} />
          ))}
        </div>
      </section>

      {/* Recent Activity */}
      <section className="lib-panel">
        <header className="lib-panel__head">
          <span className="lib-panel__icon" aria-hidden="true">
            <Activity />
          </span>
          <h3>{labels?.recentActivityTitle ?? "Recent Activity"}</h3>
        </header>
        {insights.recentActivity.length === 0 ? (
          <p className="lib-panel__empty">
            {labels?.recentEmptyText ??
              "Nothing yet — your watch history will appear here."}
          </p>
        ) : (
          <ul className="lib-activity">
            {insights.recentActivity.map((a: ActivityEntry) => (
              <li key={a.id} className="lib-activity__row">
                <span className="lib-activity__dot" aria-hidden="true" />
                <span className="lib-activity__text">{a.text}</span>
                {a.time && <span className="lib-activity__time">{a.time}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const STATE_LABEL: Record<SourceState, string> = {
  connected: "Connected",
  disconnected: "Not connected",
  error: "Error",
};

export function SourceStatusCard({
  source,
  onConnect,
}: {
  source: SourceStatusModel;
  onConnect?: () => void;
}) {
  const tone =
    source.state === "connected"
      ? "is-ready"
      : source.state === "error"
        ? "is-error"
        : "is-muted";
  const Icon = source.id === "drive" ? Cloud : HardDrive;
  return (
    <div className={cn("lib-source-card", tone)}>
      <span className="lib-source-card__icon" aria-hidden="true">
        <Icon />
      </span>
      <div className="lib-source-card__body">
        <span className="lib-source-card__name">{source.name}</span>
        <span className="lib-source-card__detail">{source.detail}</span>
      </div>
      <div className="lib-source-card__trailing">
        <span className={cn("lib-source-card__status", tone)}>
          <span className="lib-source-card__dot" aria-hidden="true" />
          {STATE_LABEL[source.state]}
        </span>
        {source.state === "disconnected" && source.id === "drive" && onConnect && (
          <button
            type="button"
            className="lib-source-card__connect ny-focusable"
            onClick={onConnect}
          >
            Connect
          </button>
        )}
      </div>
    </div>
  );
}
