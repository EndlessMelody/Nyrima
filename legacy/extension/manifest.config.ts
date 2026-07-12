import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "../package.json";

/**
 * Chrome Extension Manifest V3 configuration for Nyrima.
 *
 * Key design decisions:
 *  - Auth is BYOK: each user pastes their own Google Cloud OAuth Client ID
 *    in the User Center → API Settings. The background SW then runs
 *    `chrome.identity.launchWebAuthFlow` with that client_id. The legacy
 *    `manifest.oauth2` block + `chrome.identity.getAuthToken` path has been
 *    removed because a single shared client_id would have to live in the
 *    public manifest and would put every user behind one quota.
 *  - We use the broad `https://www.googleapis.com/auth/drive.readonly` scope
 *    for browsing arbitrary folders the user selects. This can be tightened to
 *    `drive.file` later if we move to a Picker-based UX.
 *  - `host_permissions` for `drive.google.com` lets the content script inject
 *    the "Open with Nyrima" entry into the right-click menu overlay.
 *  - `host_permissions` for `googleapis.com` lets the app fetch file metadata
 *    and stream byte ranges via `alt=media`.
 *  - The app UI itself lives in a normal extension page (chrome-extension://.../app.html)
 *    so it can run heavy WASM video decoders without CSP friction.
 */
export default defineManifest({
  manifest_version: 3,
  name: "Nyrima",
  description:
    "Professional video player & personal cinema that lives on Google Drive.",
  version: pkg.version,
  version_name: pkg.version,

  action: {
    default_title: "Nyrima",
    default_popup: "src/popup/index.html",
    default_icon: {
      "16": "icons/extension-icon-16.png",
      "32": "icons/extension-icon-32.png",
      "48": "icons/extension-icon-48.png",
      "128": "icons/extension-icon-128.png",
    },
  },

  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },

  content_scripts: [
    {
      matches: ["https://drive.google.com/*"],
      js: ["src/content/drive-inject.tsx"],
      run_at: "document_idle",
    },
  ],

  permissions: [
    "identity",
    "storage",
    "contextMenus",
    "tabs",
    // Lets the SW stamp `Authorization: Bearer` onto <video> Range requests
    // to googleapis.com so OAuth users get native streaming instead of the
    // multi-GB blob prefetch. Scoped to existing host_permissions.
    "declarativeNetRequestWithHostAccess",
    // Periodic silent-refresh of the 1h OAuth token so the user stays
    // signed in for the app's 72h interactive window without a re-consent
    // round-trip on the first Drive call after expiry.
    "alarms",
  ],

  host_permissions: [
    "https://drive.google.com/*",
    "https://www.googleapis.com/*",
    "https://content.googleapis.com/*",
    // Phase 4.4 — bootstrap directory hosted as a public JSON on GitHub.
    // Anonymous read-only fetch; no token leaves the extension.
    "https://raw.githubusercontent.com/*",
  ],

  // `oauth2` is intentionally not declared. BYOK auth runs through
  // `chrome.identity.launchWebAuthFlow` with the user's own client_id;
  // `chrome.identity.getAuthToken` (which is the only API that reads
  // manifest.oauth2) is no longer called. See service-worker.ts.

  icons: {
    "16": "icons/extension-icon-16.png",
    "32": "icons/extension-icon-32.png",
    "48": "icons/extension-icon-48.png",
    "128": "icons/extension-icon-128.png",
  },

  web_accessible_resources: [
    {
      resources: ["icons/extension-icon-128.png"],
      matches: ["https://drive.google.com/*"],
    },
  ],

  // Content Security Policy.
  //   - script-src + object-src locked down per MV3 requirements.
  //   - connect-src for fetch/XHR (Drive API metadata + listing).
  //   - media-src so <video src="https://www.googleapis.com/.../?alt=media&key=...">
  //     plays without CSP blocking. blob: also kept for the OAuth/Blob fallback.
  //   - img-src so thumbnailLink (lh3.googleusercontent.com) and Drive icons
  //     can render in tiles.
  //   - 'wasm-unsafe-eval' for the future libmpv/ffmpeg.wasm decoders.
  content_security_policy: {
    extension_pages:
      [
        "script-src 'self' 'wasm-unsafe-eval'",
        "object-src 'self'",
        "connect-src 'self' https://www.googleapis.com https://content.googleapis.com https://oauth2.googleapis.com https://raw.githubusercontent.com",
        // Drive occasionally redirects ranged media requests to googleusercontent
        // or drive.google.com mirrors; allow them under media-src to avoid silent
        // CSP blocks during playback.
        "media-src 'self' blob: https://www.googleapis.com https://content.googleapis.com https://*.googleusercontent.com https://drive.google.com",
        // Folder posters are served from Drive's image thumbnail CDN
        // (lh3.googleusercontent.com et al). No third-party image hosts
        // are needed now that MAL is out of the pipeline.
        // `avatars.githubusercontent.com` covers directory-entry avatars
        // sourced from GitHub profile pictures (a common case when the
        // user's only public avatar is their GitHub one).
        "img-src 'self' data: blob: https://*.googleusercontent.com https://*.google.com https://www.googleapis.com https://*.githubusercontent.com",
      ].join("; ") + ";",
  },
});
