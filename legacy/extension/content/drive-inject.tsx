/**
 * Content script that runs on drive.google.com.
 *
 * Two responsibilities:
 *   1. Inject a small floating action button at the bottom-right of any Drive
 *      folder page. Clicking it opens that folder inside Nyrima.
 *   2. Listen for navigation changes (Drive is a SPA) and re-bind the button
 *      so the action follows the user as they browse different folders.
 *
 * NOTE: We deliberately avoid touching Drive's own DOM beyond appending a
 *  shadow-DOM host. This keeps us resilient to Drive's frequent UI rewrites.
 *
 * Lifecycle nuance — "Extension context invalidated":
 *   When the user reloads/updates the extension while a Drive tab is still
 *   open, Chrome leaves this script running but tears down its chrome.runtime
 *   bridge. Any sendMessage from that point throws
 *     "Extension context invalidated."
 *   That cascades into an Uncaught (in promise) on every click. We guard the
 *   click handler with isExtensionContextValid() + try/catch and visually
 *   swap the FAB into a stale "Reload tab" state when we detect it.
 */

import { extractFolderId } from "@shared/parse-folder-url";
import type { DcMessage } from "@shared/messages";
import { buildDriveFabMarkup, DRIVE_FAB_LABEL } from "./drive-fab-markup";
import injectStyles from "./drive-inject.scss?inline";

// eslint-disable-next-line no-console
console.log(
  "[Nyrima] content script loaded, readyState=",
  document.readyState,
);

const HOST_ID = "nyrima-fab-host";
const STALE_LABEL = "Reload tab to reactivate";
const NYRIMA_MARK_URL = chrome.runtime.getURL("icons/extension-icon-128.png");

/**
 * After the extension is reloaded, `chrome.runtime` still exists on the
 * window of the orphaned content script, but `chrome.runtime.id` becomes
 * undefined and any sendMessage throws synchronously-then-asynchronously.
 * Checking `.id` is the documented way to detect this state.
 */
function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

let stale = false;

function getCurrentFolderId(): string | null {
  return extractFolderId(window.location.href);
}

function getCurrentFolderName(): string | null {
  // Try a few common selectors Drive has used. Fallback to document.title.
  const candidates = [
    'div[role="main"] [data-target="title"]',
    'div[role="main"] h1',
    'div[role="main"] [aria-level="1"]',
  ];
  for (const sel of candidates) {
    const el = document.querySelector<HTMLElement>(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return document.title.replace(/ - Google Drive$/, "").trim() || null;
}

function mountFab(): void {
  // eslint-disable-next-line no-console
  console.log("[Nyrima] mountFab() called");
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.bottom = "24px";
  host.style.right = "24px";
  host.style.zIndex = "2147483646";
  host.style.pointerEvents = "auto";

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = injectStyles;
  shadow.appendChild(style);

  const button = document.createElement("button");
  button.className = "dc-fab";
  button.type = "button";
  button.title = "Open this folder in Nyrima";
  button.innerHTML = buildDriveFabMarkup(NYRIMA_MARK_URL);

  const labelEl = () => button.querySelector(".dc-fab__label") as HTMLElement;
  const flash = (cls: string, text: string, ms = 1800) => {
    button.classList.add(cls);
    labelEl().textContent = text;
    window.setTimeout(() => {
      button.classList.remove(cls);
      labelEl().textContent = DRIVE_FAB_LABEL;
    }, ms);
  };

  button.addEventListener("click", () => {
    // Never let the handler return an unawaited promise — that becomes an
    // "Uncaught (in promise)" the moment chrome.runtime throws.
    void handleClick();
  });

  async function handleClick(): Promise<void> {
    // Hard stop if a previous click already detected invalidation.
    if (stale || !isExtensionContextValid()) {
      markStale();
      return;
    }

    const folderId = getCurrentFolderId();
    if (!folderId) {
      flash("dc-fab--error", "Open a folder first");
      return;
    }

    const msg: DcMessage = {
      type: "OPEN_APP_FOR_FOLDER",
      folderId,
      folderName: getCurrentFolderName() ?? undefined,
    };

    try {
      await chrome.runtime.sendMessage(msg);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes("Extension context invalidated") ||
        m.includes("message port closed") ||
        m.includes("Receiving end does not exist")
      ) {
        markStale();
        return;
      }
      // eslint-disable-next-line no-console
      console.warn("[Nyrima] sendMessage failed:", e);
      flash("dc-fab--error", "Couldn't open Nyrima");
    }
  }

  shadow.appendChild(button);
  document.body.appendChild(host);
  // eslint-disable-next-line no-console
  console.log("[Nyrima] FAB mounted at", host);

  // Cheap heartbeat: every few seconds, peek at chrome.runtime.id and flip
  // the FAB into the stale state proactively if the extension was reloaded.
  // This way the user sees the "Reload tab" hint even without clicking.
  const heartbeat = window.setInterval(() => {
    if (!isExtensionContextValid()) {
      window.clearInterval(heartbeat);
      markStale();
    }
  }, 4000);
}

/**
 * Visually mark the FAB as orphaned and stop trying to talk to the
 * background. Idempotent: safe to call from both the heartbeat and the
 * click error handler.
 */
function markStale(): void {
  if (stale) return;
  stale = true;
  const host = document.getElementById(HOST_ID);
  const button = host?.shadowRoot?.querySelector<HTMLButtonElement>(".dc-fab");
  const label = host?.shadowRoot?.querySelector<HTMLElement>(".dc-fab__label");
  if (button) {
    button.classList.add("dc-fab--stale");
    button.title =
      "Nyrima was reloaded. Refresh this tab to bring the button back.";
    button.disabled = true;
  }
  if (label) label.textContent = STALE_LABEL;
  // eslint-disable-next-line no-console
  console.info(
    "[Nyrima] extension context invalidated — content script orphaned. Reload the Drive tab.",
  );
}

function refresh(): void {
  // If we're not on a folder URL, leave the FAB but mark it inactive.
  const host = document.getElementById(HOST_ID);
  const onFolder = !!getCurrentFolderId();
  if (host) {
    host.style.opacity = onFolder ? "1" : "0.55";
  } else {
    mountFab();
  }
}

// Initial mount
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountFab, { once: true });
} else {
  mountFab();
}

// Drive is a SPA — re-evaluate on navigation.
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    refresh();
  }
});
observer.observe(document.body, { subtree: true, childList: true });
window.addEventListener("popstate", refresh);
window.addEventListener("hashchange", refresh);
