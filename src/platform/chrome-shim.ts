/**
 * Install a minimal `window.chrome` polyfill for the web runtime.
 *
 * Nyrima began life as a Chrome extension, so its stores and services call
 * `chrome.storage.*`, `chrome.runtime.getURL`, and
 * `chrome.runtime.sendMessage` directly. In a normal browser `chrome` (or its
 * `storage`/`runtime` members) is undefined, which would crash the app on
 * boot. This shim provides web-backed implementations so all that code runs
 * unchanged — the central adapter the migration relies on.
 *
 * Only the surface the app actually uses is implemented: storage (local /
 * session / onChanged), runtime (getURL / id / sendMessage / onMessage /
 * lifecycle no-ops), and a thin identity stub for the Drive-OAuth adapter.
 * Pure-extension APIs (tabs, contextMenus, alarms, declarativeNetRequest) lived
 * only in the now-retired background/content/popup code and are intentionally
 * absent.
 *
 * IMPORTANT: import this module for its side effect BEFORE any store/service
 * module loads — see `src/main.tsx`.
 */

import { storageAdapter } from "./storage-adapter";
import { assetUrl } from "./asset-url";
import type { DcMessage } from "@shared/messages";

type MessageCallback = (response: unknown) => void;

function buildRuntime() {
  const noopEvent = {
    addListener: () => {},
    removeListener: () => {},
    hasListener: () => false,
  };

  function sendMessage(
    message: DcMessage,
    callback?: MessageCallback,
  ): Promise<unknown> {
    // Lazy import breaks the chrome-shim → runtime-messages → drive-auth-web
    // → (chrome.storage) init cycle: the router only loads on first message.
    const result = import("./runtime-messages").then((m) => m.routeMessage(message));
    if (typeof callback === "function") {
      void result.then(
        (r) => callback(r),
        (e) => callback({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
    }
    return result;
  }

  return {
    id: "nyrima-web",
    lastError: undefined as { message: string } | undefined,
    getURL: (path: string) => assetUrl(path),
    sendMessage,
    onMessage: noopEvent,
    onInstalled: noopEvent,
    onStartup: noopEvent,
    onConnect: noopEvent,
  };
}

function buildIdentity() {
  return {
    getRedirectURL: (path = "") =>
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback${path}`
        : `/auth/callback${path}`,
    // The web app uses a popup flow in drive-auth-web, not launchWebAuthFlow.
    launchWebAuthFlow: (
      _opts: unknown,
      cb?: (redirectUrl?: string) => void,
    ) => {
      if (typeof cb === "function") cb(undefined);
    },
    clearAllCachedAuthTokens: (cb?: () => void) => {
      if (typeof cb === "function") cb();
    },
    clearAllCachedAuthToken: (cb?: () => void) => {
      if (typeof cb === "function") cb();
    },
  };
}

export function installChromeShim(): void {
  if (typeof globalThis === "undefined") return;
  const g = globalThis as unknown as { chrome?: Record<string, unknown> };

  // A real extension context already has the genuine APIs — never clobber them.
  const existing = g.chrome;
  const hasRealStorage =
    existing && typeof existing === "object" && "storage" in existing;
  if (hasRealStorage) return;

  const shim = {
    storage: storageAdapter,
    runtime: buildRuntime(),
    identity: buildIdentity(),
  };

  // Cast through unknown: we deliberately implement only a subset of the vast
  // @types/chrome surface. App code only touches the members above.
  g.chrome = shim as unknown as Record<string, unknown>;
}

// Install on import so a stray early `chrome.*` reference (e.g. a module-level
// onChanged listener) is always safe.
installChromeShim();
