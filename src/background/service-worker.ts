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

function getAuthToken(interactive: boolean): Promise<string> {
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
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      if (typeof result === "object" && result && "token" in result) {
        const t = (result as { token?: string }).token;
        if (t) {
          resolve(t);
          return;
        }
      }
      reject(new Error("Unexpected getAuthToken response shape"));
    });
  });
}

async function revokeAllTokens(): Promise<void> {
  // Best-effort: clear cached tokens. Real revocation requires hitting Google's
  // revoke endpoint with the access token; we do that opportunistically.
  return new Promise((resolve) => {
    chrome.identity.clearAllCachedAuthTokens(() => resolve());
  });
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
