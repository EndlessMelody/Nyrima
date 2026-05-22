# Nyrima Architecture

This document describes the current deployable Chrome extension. It is the
technical companion to [`how-nyrima-works.md`](./how-nyrima-works.md).
Engineering status and future work remain in [`../PHASES.md`](../PHASES.md).

## System Intent

Nyrima is designed around four current constraints:

1. **No Nyrima backend.** The extension page talks to Google Drive APIs and
   local browser storage. Media is not uploaded to a Nyrima server.
2. **Drive stays authoritative.** A user can only list, stream, copy, publish,
   or permission Drive data that Google Drive allows for that user and access
   mode.
3. **The browser owns playback.** Native video playback is preferred. The
   local MSE remux pipeline fills supported browser gaps without server-side
   transcoding.
4. **Sharing is opt-in metadata federation.** Public share metadata lives in
   app-created Drive files only when a user chooses to publish their
   `Shared/` folder.

## Runtime Topology

```text
                    drive.google.com
                          |
                    content script
                          |
             chrome.runtime messages / deep-links
                          v
popup ---------- background service worker ---------- Google OAuth consent
                          |
              OAuth token mediation and DNR rule
                          |
                          v
                 React extension app page
        lobby | library | player | social | settings
              |                 |
              |                 +-- local MSE/JASSUB playback work
              |
              +-- Google Drive API/media hosts
              +-- chrome.storage.local / session
              +-- IndexedDB Drive caches
              +-- optional GitHub raw share directory fetch
```

## Extension Surfaces

### Manifest

[`../src/manifest.config.ts`](../src/manifest.config.ts) builds the Manifest
V3 declaration. It defines the app action, service worker, Drive content
script, extension permissions, host permissions, and extension-page CSP.

There is intentionally no manifest `oauth2` block in the current build. OAuth
uses a user-provided Chrome Extension client ID at runtime.

### Background service worker

[`../src/background/service-worker.ts`](../src/background/service-worker.ts)
owns:

- Context-menu setup for Drive folder links/pages.
- Opening or focusing the main app page for a Drive folder.
- Recent-folder message handling.
- OAuth startup through `chrome.identity.launchWebAuthFlow`.
- Short-lived OAuth token caching in memory and `chrome.storage.session`.
- The last interactive-consent timestamp in `chrome.storage.local`.
- A Chrome alarm that attempts silent token refresh inside the current
  interactive-consent window.
- A dynamic declarativeNetRequest rule that stamps an `Authorization: Bearer`
  header on extension-initiated Drive media requests when OAuth playback needs
  direct `<video>` Range requests.

The service worker enforces the current 24-hour interactive-consent ceiling.
Past that wall-clock window, the user must consent again even if Google still
has a browser session.

### Drive content script

[`../src/content/drive-inject.tsx`](../src/content/drive-inject.tsx) runs on
`https://drive.google.com/*`. It mounts one Shadow-DOM-backed floating action
that can open the current Drive folder in Nyrima. It watches Drive SPA
navigation and detects stale extension contexts after extension reload.

It does not read Drive cookies. It extracts a folder ID from Drive URLs and
sends extension runtime messages.

### Main app page

[`../src/app/`](../src/app/) is a React extension page with hash routing:

- `/` for lobby/root onboarding.
- `/library/:folderId` for library browsing.
- `/play/:folderId/:fileId` for playback.
- `/social`, social tabs, and social shelves for Drive-native sharing.

The app page owns UI state, Drive listing calls, player orchestration, poster
resolution, subtitle setup, settings, and social stores. Heavy media work
stays here instead of in the MV3 service worker.

### Toolbar popup

[`../src/popup/`](../src/popup/) is a small entry surface that opens the app
or recent folder locations in tabs.

## Drive Access And Auth

Drive calls converge in [`../src/app/services/auth.ts`](../src/app/services/auth.ts)
and [`../src/app/services/drive-api.ts`](../src/app/services/drive-api.ts).

### API-key path

`dc.apiKey` stores a user-provided Google Drive API key locally. The key path
is for public Drive content where Drive accepts key-backed reads. URL helpers
append the key to Drive API/media requests.

An API key is not a user grant. It does not make private Drive data readable.

### BYOK OAuth path

`dc.oauthClientId` stores a user-provided Google OAuth Chrome Extension client
ID locally. The service worker requests the current scope set:

```text
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

The scopes serve different current features:

- `drive.readonly` lists and streams arbitrary Drive folders/files the user
  can read.
- `drive.file` creates and edits app-created `Shared/` and `Imports/` Drive
  data and permission changes on app-created share folders.
- User info scopes support profile-backed sharing identity.

`authedFetch` prefers OAuth when a live token is available and falls back to an
API key where that access path is configured and useful. Drive requests are
queued, retried, rate-limit-aware, and de-duplicated by the Drive service
layer.

## Drive Library Model

The paired root folder is the app entry point. Direct child folders become
library surfaces. File listing uses Google Drive v3 metadata fields for IDs,
names, MIME types, size, modified time, thumbnails, parents, copy/download
capabilities, and video metadata when Drive returns it.

The current model includes:

- Folder-local poster/backdrop discovery from `Poster.*` and `Backdrop.*`.
- Title parsing from folder and filename hints for season/episode grouping.
- External subtitle sibling matching by basename prefix.
- Root revalidation when the app refreshes.

There is no current external poster metadata provider. Legacy poster cache
entries are migrated away from the removed metadata path.

## Playback Pipeline

### Direct path

When Chrome can play the selected file directly, Nyrima builds a Drive media
URL and lets the browser media stack fetch it. For OAuth direct media requests,
the background service worker's DNR rule adds the bearer header to matching
extension-initiated Drive media requests.

### Range and MSE path

The MKV services under
[`../src/app/services/mkv-remux/`](../src/app/services/mkv-remux/) handle the
current supported remux fallback:

1. Probe EBML headers and tracks.
2. Range-fetch Drive bytes.
3. Parse clusters and selected tracks.
4. Produce fragmented MP4 fragments.
5. Append video/audio fragments to Media Source Extensions buffers.

The pipeline keeps split audio and video SourceBuffers for current track
switching behavior and can use the current AC-3 decode/render support where
implemented. Per-file playback strategy state avoids repeating some startup
work on reopen.

### Subtitle path

Subtitle services handle:

- External SRT, VTT, ASS, and SSA sibling subtitle files.
- Supported embedded MKV text subtitle extraction during playback.
- ASS/SSA handoff to JASSUB/libass for richer subtitle layout where supported.

## Sharing Topology

Sharing uses app-created Drive files rather than a Nyrima social backend:

```text
User A Drive root/
  Shared/
    index.json       v=2 share index with inline ShareEntry records
    comments.jsonl   User A outbound comments

User B follows A Shared folder URL
  -> read A Shared/index.json
  -> cache flattened inbox rows locally

User B comments on A share
  -> append one comment record to B Shared/comments.jsonl

User A activity view
  -> read followed users' comments.jsonl streams
  -> filter records targeting A Shared folder and share ID
```

The `Shared/` folder starts as an app-owned Drive folder. Nyrima changes it to
link-readable only when the user opts into publishing. A share manifest can be
public while the target file/folder stays private; target permissions remain a
separate Google Drive boundary.

Imports use Drive copy APIs. Video import can copy obvious companion poster and
subtitle files; library import can walk a folder tree. Copy permissions and
source-owner restrictions remain enforced by Drive.

## Storage And Data Placement

### Persistent local extension storage

`chrome.storage.local` is the primary persistent store for the app.

| Key | Current purpose |
| --- | --- |
| `dc.nyrimaRoot` | Verified paired Drive root. |
| `dc.recentFolders` | Recent library/folder data and lobby summaries. |
| `dc.userProfile` | Cached Google profile snapshot when OAuth yields it. |
| `dc.playbackState` | Local resume/progress records. |
| `dc.settings` | Theme, player, subtitle, and library preferences. |
| `dc.metadataCache.v3` | Current folder-art cache key after legacy poster migration. |
| `dc.playbackEngineCache` | Per-file native/MSE strategy cache. |
| `dc.libraryViewState` | Per-library search/collapse UI state. |
| `dc.apiKey` | User-provided Google Drive API key. |
| `dc.oauthClientId` | User-provided Google OAuth client ID. |
| `dc.oauthInteractiveAt` | Last successful interactive OAuth consent timestamp. |
| `dc.shareProfile` | Local share handle/name/avatar configuration. |
| `dc.sharedFolderId` | Cached ID of the user's app-created `Shared/` folder. |
| `dc.followedUsers` | Local list of followed public `Shared/` folder IDs. |
| `dc.socialInboxCache.v1` | Last-good flattened share inbox rows. |
| `dc.directoryCache.v1` | Optional public directory cache and fetch timestamp. |

Sharing permissions also keep a small local cached public/private state keyed
to the current `Shared/` folder.

### Session token cache

`chrome.storage.session` holds the short-lived OAuth access token entry so an
MV3 service-worker idle unload does not force immediate re-authentication. The
entry is removed on sign-out and expires on its token window.

### IndexedDB caches

[`../src/app/services/drive/idb.ts`](../src/app/services/drive/idb.ts) defines
cache stores for folder scans, file metadata, subtitles, thumbnails, media
segments, and watch-progress-related cache data. The account reset routine
clears Drive-account-bound cache stores when the paired account/root changes.

### Drive-created data

The app can create Drive content only through the current write features:

- `Shared/`, `index.json`, and `comments.jsonl`.
- `Imports/` destination folders and copied accessible Drive files.

Those writes require OAuth and are bound by Google Drive scope and permission
behavior.

## Remote Endpoints

The current manifest and code allow:

- `www.googleapis.com`, `content.googleapis.com`, Google Drive media
  redirects/thumbnail hosts, and Google OAuth endpoints used by Drive/OAuth
  flows.
- `drive.google.com` for content-script presence and Drive links.
- `raw.githubusercontent.com` for the optional sharing bootstrap directory.

The GitHub raw directory fetch uses `credentials: "omit"` and receives no
Google OAuth token.

## Trust Boundaries

| Boundary | Architectural treatment |
| --- | --- |
| Drive web page -> extension | Content script sends folder/deep-link messages; it is not the app authority for tokens. |
| App page -> service worker | Runtime messages request OAuth token work and tab/deep-link behavior. |
| Extension -> Google Drive | Drive API enforces scopes, permissions, quotas, copy restrictions, and media availability. |
| Followed public `Shared/index.json` -> UI | Public manifests are untrusted and sanitized before social-store use. |
| Public directory JSON -> UI | Directory entries are sanitized and cached with a TTL. |
| Same user on multiple devices | Drive JSON/JSONL writes can race because there is no backend arbiter. |

## Manifest Permission Rationale

The architecture uses these permission families:

- `identity` for OAuth web auth.
- `storage` for extension configuration and state.
- `contextMenus` and `tabs` for Drive/app entry flows.
- `alarms` for best-effort OAuth refresh cadence.
- `declarativeNetRequestWithHostAccess` for OAuth media Authorization header
  injection on allowed Drive media hosts.

See [`permissions-and-data-use.md`](./permissions-and-data-use.md) for the
full user-facing audit table.

## Current Limits

- Chrome/Chromium codec and MediaSource behavior still decide many playback
  outcomes.
- Some listed video extensions are intentionally rejected or fail at playback
  when the current browser/remux path cannot support them.
- Drive public API-key access can hit quota/rate limits independently of OAuth.
- Watch progress is local to the current browser profile today.
- Social manifest/comment writes are read-modify-write Drive operations;
  local queues reduce same-context collisions but cannot provide cross-device
  atomicity.
- Publishing share metadata cannot revoke a copy another user already imported
  or a cache they already saw.

## Code Map

| Area | Files |
| --- | --- |
| Manifest and extension contexts | `src/manifest.config.ts`, `src/background/service-worker.ts`, `src/content/`, `src/popup/` |
| React app | `src/app/App.tsx`, `src/app/pages/`, `src/app/components/` |
| Drive auth and API | `src/app/services/auth.ts`, `src/app/services/drive-api.ts`, `src/app/services/drive/` |
| Local state | `src/app/services/storage.ts`, `src/app/stores/`, `src/app/services/drive/idb.ts` |
| Playback | `src/app/pages/PlayerPage.tsx`, `src/app/components/DrivePlayer.tsx`, `src/app/services/mkv-remux/` |
| Subtitles | `src/app/services/subtitles.ts`, `src/app/services/mkv-subtitles.ts`, subtitle overlay components |
| Sharing | `src/app/services/sharing/`, `src/app/stores/sharing-store.ts`, `src/app/stores/social-store.ts` |
