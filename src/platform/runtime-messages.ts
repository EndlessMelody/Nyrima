/**
 * Local router for `chrome.runtime.sendMessage`.
 *
 * In the extension these messages crossed the process boundary to the
 * background service worker. On the web there is no SW, so we resolve the same
 * `DcMessage` protocol in-page:
 *   - AUTH_GET_TOKEN / AUTH_REVOKE → the web Drive-OAuth adapter
 *   - GET_RECENT_FOLDERS          → read straight from the storage adapter
 *   - OPEN_APP_FOR_FOLDER         → no-op (the web app navigates via the router)
 *   - PING                        → liveness probe
 *
 * The return shape is `DcResponse`, exactly what `src/app/services/auth.ts`
 * and other callers already expect.
 */

import type { DcMessage, DcResponse } from "@shared/messages";
import { STORAGE_KEYS } from "@shared/constants";
import type { RecentFolder } from "@shared/types";
import * as driveAuth from "./drive-auth-web";

export async function routeMessage(msg: DcMessage): Promise<DcResponse> {
  switch (msg?.type) {
    case "PING":
      return { ok: true, data: { pong: true, at: Date.now() } };

    case "AUTH_GET_TOKEN":
      return driveAuth.getToken(msg.interactive ?? false);

    case "AUTH_REVOKE":
      return driveAuth.revoke();

    case "GET_RECENT_FOLDERS": {
      try {
        const obj = await chrome.storage.local.get(STORAGE_KEYS.RECENT_FOLDERS);
        const list =
          (obj[STORAGE_KEYS.RECENT_FOLDERS] as RecentFolder[] | undefined) ?? [];
        return { ok: true, data: list };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case "OPEN_APP_FOR_FOLDER":
      // The deep-link path was a content-script/context-menu affordance. In the
      // web app, navigation is handled by react-router; nothing to do here.
      return { ok: true, data: { opened: false } };

    default:
      return {
        ok: false,
        error: `Unsupported message: ${(msg as { type?: string })?.type ?? "<no type>"}`,
      };
  }
}
