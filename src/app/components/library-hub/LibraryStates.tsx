/**
 * LibraryStates — soft-glass empty / loading / disconnected / error surfaces.
 *
 * All share one shell (`lib-state`) with a gentle accent glow and a clear CTA,
 * matching the Nyrima panel language. `LibraryStatePanel` is the base; the
 * named exports preset friendly English copy for each case.
 */

import type { ReactNode } from "react";
import {
  AlertTriangle,
  Cloud,
  RefreshCw,
  SearchX,
} from "lucide-react";

export function LibraryStatePanel({
  icon,
  tracker,
  title,
  message,
  action,
  tone = "brand",
}: {
  icon: ReactNode;
  tracker: string;
  title: string;
  message: string;
  action?: ReactNode;
  tone?: "brand" | "accent" | "warning";
}) {
  return (
    <div className="lib-state" data-tone={tone}>
      <span className="lib-state__glow" aria-hidden="true" />
      <span className="lib-state__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="dc-tracker dc-tracker--accent">{tracker}</span>
      <h3 className="lib-state__title">{title}</h3>
      <p className="lib-state__message">{message}</p>
      {action && <div className="lib-state__actions">{action}</div>}
    </div>
  );
}

export function LibraryEmptyState({
  onReset,
  filtered,
}: {
  onReset?: () => void;
  filtered?: boolean;
}) {
  return (
    <LibraryStatePanel
      icon={<SearchX />}
      tracker="No items found"
      title="No items found"
      message="Connect a source or adjust your filters to start building your library."
      action={
        filtered && onReset ? (
          <button type="button" className="ny-btn ny-btn--ghost" onClick={onReset}>
            Clear filters
          </button>
        ) : undefined
      }
    />
  );
}

export function LibraryDisconnectedState({ onConnect }: { onConnect?: () => void }) {
  return (
    <LibraryStatePanel
      icon={<Cloud />}
      tracker="Source not connected"
      title="No source connected"
      message="Connect Google Drive or a local folder to start streaming your collection."
      action={
        <button type="button" className="ny-btn ny-btn--primary" onClick={onConnect}>
          Connect a source
        </button>
      }
    />
  );
}

export function LibraryErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <LibraryStatePanel
      icon={<AlertTriangle />}
      tracker="Sync failed"
      title="We couldn't sync your library"
      message="Something interrupted the last sync. Check your connection and try again."
      tone="warning"
      action={
        <button type="button" className="ny-btn ny-btn--primary" onClick={onRetry}>
          <RefreshCw aria-hidden="true" /> Try again
        </button>
      }
    />
  );
}
