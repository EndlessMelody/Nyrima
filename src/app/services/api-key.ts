/**
 * Drive API key management.
 *
 * For "Anyone with the link" folders, Drive's REST API only needs an API key
 * (not an OAuth token). Storing the key in chrome.storage.local lets the user
 * one-time pair the extension with a Google Cloud project they own.
 *
 * Setup instructions (also documented in docs/api-key-setup.md):
 *   1. Open https://console.cloud.google.com/apis/credentials
 *   2. Create credentials → API key
 *   3. (Recommended) Restrict the key to "HTTP referrers" containing
 *      chrome-extension://<your-id>/* and API "Google Drive API".
 *   4. Paste the key into Nyrima's "Setup access" dialog.
 */

const API_KEY_STORAGE = "dc.apiKey";

let cachedApiKey: string | null | undefined = undefined;

export async function getApiKey(): Promise<string | null> {
  if (cachedApiKey !== undefined) return cachedApiKey;
  const obj = await chrome.storage.local.get(API_KEY_STORAGE);
  const v = obj[API_KEY_STORAGE] as string | undefined;
  cachedApiKey = v ?? null;
  return cachedApiKey;
}

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    await clearApiKey();
    return;
  }
  await chrome.storage.local.set({ [API_KEY_STORAGE]: trimmed });
  cachedApiKey = trimmed;
}

export async function clearApiKey(): Promise<void> {
  await chrome.storage.local.remove(API_KEY_STORAGE);
  cachedApiKey = null;
}

export async function hasApiKey(): Promise<boolean> {
  return !!(await getApiKey());
}

// Keep the cache in sync if another extension page updates the key.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!(API_KEY_STORAGE in changes)) return;
    cachedApiKey = (changes[API_KEY_STORAGE]?.newValue as string | null | undefined) ?? null;
  });
}

/**
 * Append `?key=<API_KEY>` to a request URL. Returns the original URL if no
 * key is configured so callers can choose how to react.
 */
export function appendApiKey(url: string, key: string | null): string {
  if (!key) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}key=${encodeURIComponent(key)}`;
}
