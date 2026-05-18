/**
 * One-shot migration: purge the legacy MAL/Jikan poster cache and scrub
 * MAL-origin cover URLs off existing `RecentFolder` records.
 *
 * Context: before 2026-05-18 Nyrima resolved library posters by querying
 * MyAnimeList via the Jikan v4 API and persisted the results into
 * `STORAGE_KEYS.METADATA_CACHE` (and the matched `posterUrl` onto each
 * `RecentFolder.coverPosterUrl`). That service was removed in favour of a
 * user-placed `Poster.{jpg,png,…}` file inside each Drive folder. On
 * upgrade we need to:
 *
 *   1. Drop the chrome.storage entry for the dead poster cache so the
 *      blob doesn't sit unused in storage forever.
 *   2. Drop any `coverPosterUrl` on a RecentFolder whose URL host looks
 *      like a MAL CDN — those URLs are expired/invalid against the new
 *      pipeline and would render a broken image until the next enrichment
 *      pass overwrote them. The next pass either replaces them with a
 *      fresh Drive thumbnailLink (when the user has placed a Poster.*) or
 *      leaves the slot empty so the initials tile renders.
 *
 * Gated by a marker key so it runs exactly once per install.
 */

import { STORAGE_KEYS } from "@shared/constants";
import type { RecentFolder } from "@shared/types";

const MIGRATION_MARKER_KEY = "dc.posterMigration.v1";

/** Hosts that ever served MAL poster art. We match liberally — any URL
 *  containing one of these substrings is treated as MAL-origin and
 *  stripped. Newly written URLs come from `lh3.googleusercontent.com`
 *  (Drive's thumbnail CDN) so the heuristic doesn't false-positive on
 *  fresh data. */
const MAL_URL_HOSTS = ["myanimelist.net", "cdn.myanimelist.net"];

function isMalUrl(url: string | undefined): boolean {
  if (!url) return false;
  return MAL_URL_HOSTS.some((host) => url.includes(host));
}

/**
 * Run the migration once. Cheap to call — returns immediately after the
 * first run via the marker check. Errors are swallowed so a flaky
 * chrome.storage doesn't bring down the app boot path.
 */
export async function runMalPosterMigration(): Promise<void> {
  try {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    const marker = await chrome.storage.local.get(MIGRATION_MARKER_KEY);
    if (marker[MIGRATION_MARKER_KEY] === true) return;

    // 1. Drop the legacy poster cache. `remove` is a no-op when absent.
    await chrome.storage.local.remove(STORAGE_KEYS.METADATA_CACHE);

    // 2. Scrub MAL URLs off RecentFolder.coverPosterUrl.
    const obj = await chrome.storage.local.get(STORAGE_KEYS.RECENT_FOLDERS);
    const list = (obj[STORAGE_KEYS.RECENT_FOLDERS] as RecentFolder[]) ?? [];
    let dirty = false;
    const next = list.map((f) => {
      if (!isMalUrl(f.coverPosterUrl)) return f;
      dirty = true;
      // Strip coverPosterUrl + coverFileId together — the file id, if
      // present, would have pointed at a Drive file id that never
      // mattered for MAL-served URLs anyway; clearing both forces the
      // next enrichment pass to re-discover from the Drive folder.
      const { coverPosterUrl: _u, coverFileId: _f, ...rest } = f;
      return rest as RecentFolder;
    });
    if (dirty) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.RECENT_FOLDERS]: next,
      });
    }

    await chrome.storage.local.set({ [MIGRATION_MARKER_KEY]: true });
  } catch {
    // Best-effort. A failed migration retries on next boot.
  }
}
