/**
 * Background service worker (MV3).
 *
 * Responsibilities:
 *   1. Register the "Open with Nyrima" context menu on the toolbar icon
 *      and on links inside drive.google.com.
 *   2. Mediate OAuth: cache + refresh chrome.identity tokens, expose them to
 *      content/app scripts via runtime messages so we never expose tokens to
 *      arbitrary web pages.
 *   3. Handle deep-link requests like "open the app pre-loaded with folder X".
 *   4. Persist the recent-folders MRU list whenever a folder is opened.
 */

import {
  CONTEXT_MENU,
  MAX_RECENT_FOLDERS,
  STORAGE_KEYS,
  APP_PAGE,
} from "@shared/constants";
import { type DcMessage, type DcResponse, ok, err } from "@shared/messages";
import { extractFolderId } from "@shared/parse-folder-url";
import type { RecentFolder } from "@shared/types";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  await setupContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupContextMenus();
});

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------

async function setupContextMenus(): Promise<void> {
  // Always recreate to avoid duplicate-id errors after reloads.
  await new Promise<void>((resolve) =>
    chrome.contextMenus.removeAll(() => resolve()),
  );

  chrome.contextMenus.create({
    id: CONTEXT_MENU.OPEN_FOLDER_IN_APP,
    title: "Open with Nyrima",
    contexts: ["link", "page"],
    documentUrlPatterns: ["https://drive.google.com/*"],
    targetUrlPatterns: [
      "https://drive.google.com/drive/folders/*",
      "https://drive.google.com/drive/u/*/folders/*",
    ],
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU.OPEN_FOLDER_IN_APP) return;

  const url = info.linkUrl ?? info.pageUrl ?? tab?.url ?? "";
  const folderId = extractFolderId(url);
  if (!folderId) {
    console.warn("[Nyrima] Could not extract folder id from", url);
    return;
  }
  await openAppForFolder(folderId);
});

// ---------------------------------------------------------------------------
// Toolbar action
// ---------------------------------------------------------------------------
// The action has a default_popup set in the manifest, so chrome.action.onClicked
// would never fire — Chrome opens the popup instead. openAppPage() is still
// called by the context-menu and onInstalled handlers above.

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (msg: DcMessage, _sender, sendResponse: (r: DcResponse) => void) => {
    handleMessage(msg)
      .then((response) => sendResponse(response))
      .catch((e) => sendResponse(err(e)));
    return true; // keep the message channel open for async response
  },
);

async function handleMessage(msg: DcMessage): Promise<DcResponse> {
  switch (msg.type) {
    case "PING":
      return ok({ pong: true, at: Date.now() });

    case "AUTH_GET_TOKEN": {
      const token = await getAuthToken(msg.interactive ?? false);
      return ok({ token });
    }

    case "AUTH_REVOKE": {
      await revokeAllTokens();
      return ok({ revoked: true });
    }

    case "OPEN_APP_FOR_FOLDER": {
      await openAppForFolder(msg.folderId, msg.folderName);
      return ok({ opened: true });
    }

    case "GET_RECENT_FOLDERS": {
      const list = await readRecentFolders();
      return ok(list);
    }

    default:
      return err(
        `Unknown message: ${(msg as { type?: string }).type ?? "<no type>"}`,
      );
  }
}

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

// In-memory token cache — fastest path. Survives only while the MV3 service
// worker is alive (~30s idle timeout), so we also persist to session storage.
let customTokenCache: { token: string; expiresAt: number } | null = null;

// Session-storage key. chrome.storage.session is wiped on browser restart but
// survives service-worker idle unloads, which is exactly the cache lifetime
// we want for a 1-hour OAuth token.
const TOKEN_SESSION_KEY = "dc.oauthAccessToken";

async function readPersistedToken(): Promise<{ token: string; expiresAt: number } | null> {
  try {
    const obj = await chrome.storage.session.get(TOKEN_SESSION_KEY);
    const entry = obj[TOKEN_SESSION_KEY] as { token: string; expiresAt: number } | undefined;
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) return null;
    return entry;
  } catch {
    return null;
  }
}

async function writePersistedToken(entry: { token: string; expiresAt: number } | null): Promise<void> {
  try {
    if (entry) {
      await chrome.storage.session.set({ [TOKEN_SESSION_KEY]: entry });
    } else {
      await chrome.storage.session.remove(TOKEN_SESSION_KEY);
    }
  } catch {
    // ignore — in-memory cache still works for the current SW lifetime
  }
}

async function getAuthToken(interactive: boolean): Promise<string> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.OAUTH_CLIENT_ID);
  const customClientId = obj[STORAGE_KEYS.OAUTH_CLIENT_ID] as string | undefined;

  if (customClientId) {
    // Try in-memory first, then session storage. This is the hot path on
    // every Drive call — keep it cheap.
    if (customTokenCache && Date.now() < customTokenCache.expiresAt) {
      await setDnrAuthRule(customTokenCache.token);
      return customTokenCache.token;
    }
    const persisted = await readPersistedToken();
    if (persisted) {
      customTokenCache = persisted;
      await setDnrAuthRule(persisted.token);
      return persisted.token;
    }

    return new Promise((resolve, reject) => {
      const redirectUri = chrome.identity.getRedirectURL();
      const scopes = encodeURIComponent(
        "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"
      );
      // For non-interactive, add prompt=none so it fails fast or succeeds silently.
      const promptParam = interactive ? "" : "&prompt=none";
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${customClientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}${promptParam}`;

      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          reject(new Error(chrome.runtime.lastError?.message || "OAuth flow failed or cancelled."));
          return;
        }

        try {
          const hash = new URL(redirectUrl).hash.substring(1);
          const params = new URLSearchParams(hash);
          const token = params.get("access_token");
          const expiresIn = parseInt(params.get("expires_in") || "3599", 10);

          if (token) {
            // Cache token with a 5-minute safety margin in BOTH layers so a
            // service-worker idle restart doesn't force a re-auth.
            const entry = {
              token,
              expiresAt: Date.now() + (expiresIn - 300) * 1000,
            };
            customTokenCache = entry;
            void writePersistedToken(entry);
            void setDnrAuthRule(token);
            resolve(token);
          } else {
            reject(new Error("No access_token found in redirect URI."));
          }
        } catch (err) {
          reject(new Error("Failed to parse redirect URI."));
        }
      });
    });
  }

  return new Promise((resolve, reject) => {
    // Newer chrome.identity types declare getAuthToken with a GetAuthTokenResult
    // object response. Older Chrome builds still call back with a bare string.
    // We accept both, hence the `unknown` cast + runtime narrowing.
    chrome.identity.getAuthToken({ interactive }, (result: unknown) => {
      if (chrome.runtime.lastError || !result) {
        reject(
          new Error(chrome.runtime.lastError?.message ?? "No token returned"),
        );
        return;
      }
      const finish = (t: string) => {
        void setDnrAuthRule(t);
        resolve(t);
      };
      if (typeof result === "string") {
        finish(result);
        return;
      }
      if (typeof result === "object" && result && "token" in result) {
        const t = (result as { token?: string }).token;
        if (t) {
          finish(t);
          return;
        }
      }
      reject(new Error("Unexpected getAuthToken response shape"));
    });
  });
}

async function revokeAllTokens(): Promise<void> {
  customTokenCache = null;
  await writePersistedToken(null);
  await clearDnrAuthRule();
  // Best-effort: clear cached tokens. Real revocation requires hitting Google's
  // revoke endpoint with the access token; we do that opportunistically.
  return new Promise((resolve) => {
    chrome.identity.clearAllCachedAuthTokens(() => resolve());
  });
}

// ---------------------------------------------------------------------------
// DNR auth-header injection for <video> Range streams.
// ---------------------------------------------------------------------------
//
// `<video src>` can't carry an Authorization header from JS, so an OAuth-only
// user previously had to pay a full-file blob prefetch before playback could
// start. With a single dynamic DNR rule we stamp `Authorization: Bearer` onto
// every extension-initiated request to Drive's media endpoints, which lets the
// browser issue native Range requests against the bare media URL and start
// playback in a couple of seconds.
//
// The rule is kept in sync with the current cached OAuth token: refreshed
// whenever a new token is minted, cleared on sign-out. Dynamic rules persist
// across SW restarts, so as long as the session-storage token is still valid,
// the rule survives idle unloads without re-installation.

const DNR_AUTH_RULE_ID = 1;
let lastInstalledDnrToken: string | null = null;

async function setDnrAuthRule(token: string): Promise<void> {
  if (lastInstalledDnrToken === token) return; // idempotent
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_AUTH_RULE_ID],
      addRules: [
        {
          id: DNR_AUTH_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              {
                header: "Authorization",
                operation: "set",
                value: `Bearer ${token}`,
              },
            ],
          } as chrome.declarativeNetRequest.RuleAction,
          condition: {
            urlFilter: "||www.googleapis.com/drive/v3/files/",
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ["media", "xmlhttprequest"],
          } as chrome.declarativeNetRequest.RuleCondition,
        },
      ],
    });
    lastInstalledDnrToken = token;
  } catch (e) {
    console.warn("[Nyrima] DNR auth rule install failed:", e);
  }
}

async function clearDnrAuthRule(): Promise<void> {
  lastInstalledDnrToken = null;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_AUTH_RULE_ID],
    });
  } catch {
    // ignore — rule may not exist
  }
}

// ---------------------------------------------------------------------------
// App page opening
// ---------------------------------------------------------------------------

async function openAppPage(hash = ""): Promise<chrome.tabs.Tab> {
  const url = chrome.runtime.getURL(APP_PAGE) + (hash ? `#${hash}` : "");
  // Prefer reusing an existing app tab if one is open.
  const tabs = await chrome.tabs.query({
    url: chrome.runtime.getURL(APP_PAGE) + "*",
  });
  if (tabs[0]?.id != null) {
    await chrome.tabs.update(tabs[0].id, { active: true, url });
    if (tabs[0].windowId != null) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
    return tabs[0];
  }
  return chrome.tabs.create({ url });
}

async function openAppForFolder(
  folderId: string,
  folderName?: string,
): Promise<void> {
  await rememberRecentFolder({
    id: folderId,
    name: folderName ?? "Untitled folder",
    lastOpenedAt: Date.now(),
  });
  const hash = `/library/${encodeURIComponent(folderId)}`;
  await openAppPage(hash);
}

// ---------------------------------------------------------------------------
// Recent folders MRU
// ---------------------------------------------------------------------------

async function readRecentFolders(): Promise<RecentFolder[]> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.RECENT_FOLDERS);
  return (obj[STORAGE_KEYS.RECENT_FOLDERS] as RecentFolder[] | undefined) ?? [];
}

async function writeRecentFolders(list: RecentFolder[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.RECENT_FOLDERS]: list });
}

async function rememberRecentFolder(folder: RecentFolder): Promise<void> {
  const list = await readRecentFolders();
  const existing = list.find((f) => f.id === folder.id);
  const merged: RecentFolder = existing
    ? { ...existing, ...folder, lastOpenedAt: folder.lastOpenedAt }
    : folder;
  const next = [merged, ...list.filter((f) => f.id !== folder.id)].slice(
    0,
    MAX_RECENT_FOLDERS,
  );
  await writeRecentFolders(next);
}

// extractFolderId lives in @shared/parse-folder-url so that the content
// script can use it without inheriting the chrome.runtime.onInstalled side
// effects this module declares at top level.
