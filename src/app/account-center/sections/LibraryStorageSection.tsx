/**
 * Library & Storage — library grid density + default sort/view, plus the
 * destructive cache actions ported from the old UserCenter dropdown.
 */

import { useCallback, useState } from "react";
import cn from "classnames";
import { Trash2, RefreshCw } from "lucide-react";
import { useSettingsStore } from "@app/stores/settings-store";
import { useDevModeStore } from "@app/services/drive/dev-mode";
import { STORAGE_KEYS } from "@shared/constants";
import type { LibrarySortKey, LibraryViewMode } from "@shared/types";
import type { SectionProps } from "../registry";

const SORT_OPTIONS: { value: LibrarySortKey; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "modified", label: "Modified" },
  { value: "size", label: "Size" },
  { value: "duration", label: "Duration" },
];

const VIEW_OPTIONS: { value: LibraryViewMode; label: string }[] = [
  { value: "grouped", label: "Grouped" },
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
];

export function LibraryStorageSection({ highlightSettingId: _ }: SectionProps) {
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);
  const [clearing, setClearing] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  const handleClearHistory = useCallback(async () => {
    setClearing(true);
    try {
      await chrome.storage.local.remove(STORAGE_KEYS.PLAYBACK_STATE);
      // The in-memory cache in storage.ts self-refreshes via onChanged, but
      // the lobby/library `usePlaybackPositions` state loads once on mount —
      // reload for a clean view across all open surfaces.
      window.location.reload();
    } catch {
      setClearing(false);
    }
  }, []);

  const handleClearCache = useCallback(async () => {
    try {
      // Wipe the IDB-backed SWR caches (folder scans, file metadata, subtitle
      // text, thumbnails, media segments) plus the legacy METADATA_CACHE key.
      await chrome.storage.local.remove(STORAGE_KEYS.METADATA_CACHE);
      await useDevModeStore.getState().clearAllCaches();
      setCacheCleared(true);
      window.setTimeout(() => setCacheCleared(false), 1600);
    } catch {
      // ignore — best-effort cleanup
    }
  }, []);

  return (
    <div className="ny-ac__section-body">
      <div className="ny-ac__card" data-setting-id="library-density">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Library density</div>
            <div className="ny-ac__row-sub">
              Compact fits more posters per row with tighter gaps.
            </div>
          </div>
          <div className="ny-ac__pills">
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                type="button"
                key={d}
                className={cn("ny-ac__pill", {
                  "is-active": settings.libraryDensity === d,
                })}
                onClick={() => void patch({ libraryDensity: d })}
              >
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="library-defaults">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Default sort</div>
            <div className="ny-ac__row-sub">Applied when opening a library.</div>
          </div>
          <div className="ny-ac__pills">
            {SORT_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={cn("ny-ac__pill", {
                  "is-active": settings.librarySort === option.value,
                })}
                onClick={() => void patch({ librarySort: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Default view</div>
            <div className="ny-ac__row-sub">Layout inside a video library.</div>
          </div>
          <div className="ny-ac__pills">
            {VIEW_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={cn("ny-ac__pill", {
                  "is-active": settings.libraryView === option.value,
                })}
                onClick={() => void patch({ libraryView: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="storage-history">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Clear watch history</div>
            <div className="ny-ac__row-sub">
              Removes every saved playback position. Reloads the app.
            </div>
          </div>
          <button
            type="button"
            className="ny-btn ny-ac__danger-btn"
            disabled={clearing}
            onClick={() => void handleClearHistory()}
          >
            <Trash2 aria-hidden="true" />
            {clearing ? "Clearing…" : "Clear"}
          </button>
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="storage-cache">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Clear metadata cache</div>
            <div className="ny-ac__row-sub">
              Folder scans, thumbnails, and subtitle caches rebuild on demand.
            </div>
          </div>
          <button
            type="button"
            className="ny-btn"
            onClick={() => void handleClearCache()}
          >
            <RefreshCw aria-hidden="true" />
            {cacheCleared ? "Cleared ✓" : "Clear"}
          </button>
        </div>
      </div>
    </div>
  );
}
