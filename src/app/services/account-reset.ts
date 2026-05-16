/**
 * Account-reset routine.
 *
 * Triggered when the user (re)picks a Nyrima root folder — usually because
 * they switched accounts/API keys and the previously-cached folders, file
 * metadata, and playback positions all belong to a different Drive.
 *
 * What we drop:
 *   - chrome.storage.local: dc.recentFolders, dc.playbackState,
 *     dc.metadataCache, dc.playbackEngineCache
 *   - IndexedDB caches: folder scans, file metadata, subtitle text,
 *     thumbnails, media segments
 *
 * What we keep:
 *   - dc.settings              — subtitle/player preferences are personal
 *   - dc.apiKey / dc.tmdbKey   — the user just pasted them, don't wipe
 *   - dc.oauthClientId         — same as above
 *   - dc.userProfile           — re-derived from auth on next call
 */

import { STORAGE_KEYS } from "@shared/constants";
import { idbClear, STORES } from "./drive/idb";

const STORAGE_KEYS_TO_CLEAR: string[] = [
  STORAGE_KEYS.RECENT_FOLDERS,
  STORAGE_KEYS.PLAYBACK_STATE,
  STORAGE_KEYS.METADATA_CACHE,
  STORAGE_KEYS.PLAYBACK_ENGINE_CACHE,
];

/**
 * Wipe everything that's tied to the previously-active Drive account, but
 * preserve user-set preferences and credentials. Safe to call multiple times.
 */
export async function wipeAccountData(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS_TO_CLEAR);
  // IDB clears: invalidate every cache that holds Drive bytes / listings.
  await Promise.all([
    idbClear(STORES.FOLDER_SCAN),
    idbClear(STORES.FILE_METADATA),
    idbClear(STORES.SUBTITLE),
    idbClear(STORES.THUMBNAIL),
    idbClear(STORES.MEDIA_SEGMENT),
    idbClear(STORES.WATCH_PROGRESS),
  ]);
}
