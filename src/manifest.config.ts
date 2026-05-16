import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "../package.json";

/**
 * Chrome Extension Manifest V3 configuration for Nyrima.
 *
 * Key design decisions:
 *  - We request `identity` and `identity.email` to authenticate the user via
 *    chrome.identity.getAuthToken (uses the user's Chrome profile login).
 *  - We use the broad `https://www.googleapis.com/auth/drive.readonly` scope
 *    for browsing arbitrary folders the user selects. This can be tightened to
 *    `drive.file` later if we move to a Picker-based UX.
 *  - `host_permissions` for `drive.google.com` lets the content script inject
 *    the "Open with Nyrima" entry into the right-click menu overlay.
 *  - `host_permissions` for `googleapis.com` lets the app fetch file metadata
 *    and stream byte ranges via `alt=media`.
 *  - The app UI itself lives in a normal extension page (chrome-extension://.../app.html)
 *    so it can run heavy WASM video decoders without CSP friction.
 *
 * NOTE: The oauth2.client_id below is a placeholder. The user will create one
 * in the Google Cloud Console (OAuth client → Chrome Extension) and paste it
 * here, or override via .env. See docs/oauth-setup.md.
 */
export default defineManifest({
  manifest_version: 3,
  name: "Nyrima",
  description:
    "Professional video player & personal cinema that lives on Google Drive.",
  version: pkg.version,
  version_name: `${pkg.version}-dev`,

  action: {
    default_title: "Nyrima",
    default_popup: "src/popup/index.html",
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

  permissions: ["identity", "storage", "contextMenus", "tabs"],

  host_permissions: [
    "https://drive.google.com/*",
    "https://www.googleapis.com/*",
    "https://content.googleapis.com/*",
    "https://api.themoviedb.org/*",
    "https://image.tmdb.org/*",
  ],

  // oauth2 is intentionally omitted in this build. With a placeholder
  // client_id, chrome.identity.getAuthToken throws "bad client id". Nyrima
  // falls back to API-key access for "Anyone with the link" folders
  // (see src/app/services/api-key.ts). To enable OAuth for PRIVATE folders,
  // create a Chrome Extension OAuth client at
  //   https://console.cloud.google.com/apis/credentials
  // and uncomment the block below with your client_id:\
   oauth2: {
     client_id: "1234567890-xxxx.apps.googleusercontent.com",
     scopes: [
       "https://www.googleapis.com/auth/drive.readonly",
       "https://www.googleapis.com/auth/userinfo.email",
       "https://www.googleapis.com/auth/userinfo.profile",
     ],
  },

  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },

  web_accessible_resources: [
    {
      resources: ["src/app/index.html", "icons/*", "assets/*"],
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
        "connect-src 'self' https://www.googleapis.com https://content.googleapis.com https://oauth2.googleapis.com https://api.themoviedb.org",
        // Drive occasionally redirects ranged media requests to googleusercontent
        // or drive.google.com mirrors; allow them under media-src to avoid silent
        // CSP blocks during playback.
        "media-src 'self' blob: https://www.googleapis.com https://content.googleapis.com https://*.googleusercontent.com https://drive.google.com",
        "img-src 'self' data: blob: https://*.googleusercontent.com https://*.google.com https://www.googleapis.com https://image.tmdb.org",
      ].join("; ") + ";",
  },
});
