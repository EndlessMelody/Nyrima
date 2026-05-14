/**
 * TMDB API key management.
 *
 * Mirrors api-key.ts but for TheMovieDB. Stored in chrome.storage.local.
 */

const TMDB_KEY_STORAGE = "dc.tmdbKey";

let cachedTmdbKey: string | null | undefined = undefined;

export async function getTmdbKey(): Promise<string | null> {
  if (cachedTmdbKey !== undefined) return cachedTmdbKey;
  const obj = await chrome.storage.local.get(TMDB_KEY_STORAGE);
  const v = obj[TMDB_KEY_STORAGE] as string | undefined;
  cachedTmdbKey = v ?? null;
  return cachedTmdbKey;
}

export async function setTmdbKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    await clearTmdbKey();
    return;
  }
  await chrome.storage.local.set({ [TMDB_KEY_STORAGE]: trimmed });
  cachedTmdbKey = trimmed;
}

export async function clearTmdbKey(): Promise<void> {
  await chrome.storage.local.remove(TMDB_KEY_STORAGE);
  cachedTmdbKey = null;
}

export async function hasTmdbKey(): Promise<boolean> {
  return !!(await getTmdbKey());
}

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!(TMDB_KEY_STORAGE in changes)) return;
    cachedTmdbKey = (changes[TMDB_KEY_STORAGE]?.newValue as string | null | undefined) ?? null;
  });
}
