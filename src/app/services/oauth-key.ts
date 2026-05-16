import { STORAGE_KEYS } from "@shared/constants";

let memoryCache: string | null = null;

export async function getOAuthClientId(): Promise<string | null> {
  if (memoryCache !== null) return memoryCache;
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.OAUTH_CLIENT_ID);
    memoryCache = (data[STORAGE_KEYS.OAUTH_CLIENT_ID] as string) || null;
    return memoryCache;
  } catch {
    return null;
  }
}

export async function setOAuthClientId(clientId: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.OAUTH_CLIENT_ID]: clientId });
  memoryCache = clientId;
}

export async function clearOAuthClientId(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.OAUTH_CLIENT_ID);
  memoryCache = null;
}
