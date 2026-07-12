# Nyrima Architecture

This document describes the current Nyrima **web app**. It is the technical
companion to [`how-nyrima-works.md`](./how-nyrima-works.md). Engineering
status and future work remain in [`../PHASES.md`](../PHASES.md).

> Nyrima started as a Chrome Manifest V3 extension. That implementation is
> retired and preserved in [`../legacy/extension/`](../legacy/extension/) —
> see [`../legacy/extension/README.md`](../legacy/extension/README.md) for
> what moved where. The "Legacy Extension Surfaces" section below documents
> how OAuth and Drive media auth worked there, since the web Drive-auth
> adapter (`src/platform/drive-auth-web.ts`) is still hardening against that
> reference.

## System Intent

Nyrima is designed around four current constraints:

1. **No Nyrima media backend.** The web app talks to Google Drive APIs, local
   disk (File System Access API), and browser storage. Media is not uploaded
   to a Nyrima server. A small Supabase backend exists for accounts and the
   social layer only (friend connections, folder comments) — never media or
   per-user library data.
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
                    Public marketing site (/)
                  login | terms | faq | guide
                          |
                   Google OAuth (PKCE) / guest session
                          v
              RequireAuth -> AppShell (/app)
        lobby | library | player | social | settings
              |                 |
              |                 +-- local MSE/JASSUB playback work
              |                 +-- local file playback (File System Access)
              |
              +-- Google Drive REST API / media hosts
              +-- src/platform/chrome-shim.ts (localStorage + IndexedDB)
              +-- IndexedDB Drive caches
              +-- Supabase (accounts + social-only data)
              +-- optional GitHub raw share directory fetch
```

## App Surfaces

[`src/App.tsx`](../src/App.tsx) is the route tree:

- `/`, `/login`, `/terms`, `/privacy`, `/faq`, `/contact`, `/guide` — public
  marketing site (no auth), see [`src/landing/`](../src/landing/).
- `/auth/callback`, `/auth/google/callback` — Supabase account OAuth return
  and Google Drive OAuth return.
- `/app` — lobby/dashboard, gated by `RequireAuth` + `AppShell`.
- `/library*`, `/play/:folderId/:fileId`, `/read/:folderId/:fileId`,
  `/music/player`, `/social*`, `/settings`, `/account` — the authenticated
  app, mirroring the prior extension page's routes (library browsing,
  playback, EPUB reading, music, Drive-native sharing).

The app owns UI state, Drive listing calls, player orchestration, poster
resolution, subtitle setup, settings, and social stores — unchanged from the
extension era, just running as a normal web page instead of an extension
page.

## Legacy Extension Surfaces (retired)

These surfaces are no longer part of the build. They're preserved under
[`../legacy/extension/`](../legacy/extension/) because they document how Drive
OAuth, token refresh, and the `Authorization: Bearer` media-request injection
worked, which the web Drive-auth adapter still needs to replicate (PKCE,
silent refresh, login hints).

- **Manifest** — [`../legacy/extension/manifest.config.ts`](../legacy/extension/manifest.config.ts)
  built the Manifest V3 declaration (app action, service worker, Drive content
  script, permissions, extension-page CSP). There was intentionally no
  manifest `oauth2` block; OAuth used a user-provided Chrome Extension client
  ID at runtime.
- **Background service worker** — [`../legacy/extension/background/service-worker.ts`](../legacy/extension/background/service-worker.ts)
  owned context-menu setup, OAuth via `chrome.identity.launchWebAuthFlow`,
  short-lived token caching in `chrome.storage.session`, the 72-hour
  interactive-consent ceiling, a silent-refresh alarm, and a
  declarativeNetRequest rule stamping `Authorization: Bearer` on Drive media
  requests for direct `<video>` Range playback.
- **Drive content script** — [`../legacy/extension/content/drive-inject.tsx`](../legacy/extension/content/drive-inject.tsx)
  ran on `https://drive.google.com/*`, mounting a floating action to open the
  current Drive folder in Nyrima.
- **Toolbar popup** — [`../legacy/extension/popup/`](../legacy/extension/popup/)
  was a small entry surface that opened the app or recent folder locations in
  tabs.

## Drive Access And Auth

Drive calls converge in [`../src/app/services/auth.ts`](../src/app/services/auth.ts)
and [`../src/app/services/drive-api.ts`](../src/app/services/drive-api.ts).

### API-key path

`dc.apiKey` stores a user-provided Google Drive API key locally. The key path
is for public Drive content where Drive accepts key-backed reads. URL helpers
append the key to Drive API/media requests.

An API key is not a user grant. It does not make private Drive data readable.

### OAuth (PKCE) path

[`src/platform/drive-auth-web.ts`](../src/platform/drive-auth-web.ts) drives a
browser-based authorization-code-with-PKCE flow against
`/auth/google/callback`, requesting the current scope set:

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

When the browser can play the selected file directly, Nyrima builds a Drive
media URL and lets the browser media stack fetch it. For OAuth direct media
requests, `authedFetch` attaches the `Authorization: Bearer` header itself
(the prior extension build used a declarativeNetRequest rule for this; the web
app does it in-app).

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

### Persistent local storage

`chrome.storage.local` calls are the primary persistent store for the app,
now backed by `localStorage` via
[`src/platform/storage-adapter.ts`](../src/platform/storage-adapter.ts) (see
[`src/platform/chrome-shim.ts`](../src/platform/chrome-shim.ts)), with
cross-tab propagation through the native `storage` event. Stores and services
were written against `chrome.storage.local` during the extension era and were
not rewritten — the adapter keeps every existing call working.

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

`chrome.storage.session` calls hold the short-lived OAuth access token entry,
backed by `sessionStorage` via the same storage adapter (the "session" area).
The entry is removed on sign-out and expires on its token window.

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

The app's CSP and code allow:

- `www.googleapis.com`, `content.googleapis.com`, Google Drive media
  redirects/thumbnail hosts, and Google OAuth endpoints used by Drive/OAuth
  flows.
- `*.supabase.co` for account auth and the social-only backend (friends,
  folder comments).
- `raw.githubusercontent.com` for the optional sharing bootstrap directory.

The GitHub raw directory fetch uses `credentials: "omit"` and receives no
Google OAuth token.

## Trust Boundaries

| Boundary | Architectural treatment |
| --- | --- |
| App -> Google Drive | Drive API enforces scopes, permissions, quotas, copy restrictions, and media availability. |
| App -> Supabase | Social-only data (friends, folder comments, account identity); no media or per-user library data ever leaves the browser. |
| Followed public `Shared/index.json` -> UI | Public manifests are untrusted and sanitized before social-store use. |
| Public directory JSON -> UI | Directory entries are sanitized and cached with a TTL. |
| Same user on multiple devices | Drive JSON/JSONL writes can race because there is no backend arbiter. |

See [`permissions-and-data-use.md`](./permissions-and-data-use.md) for the
full user-facing data-use audit, and
[`supabase-and-cache-architecture.md`](./supabase-and-cache-architecture.md)
for the Supabase/cache split.

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
| Legacy extension contexts (retired) | `legacy/extension/manifest.config.ts`, `legacy/extension/background/service-worker.ts`, `legacy/extension/content/`, `legacy/extension/popup/` |
| Route tree, auth, marketing site | `src/App.tsx`, `src/auth/`, `src/landing/`, `src/pages/`, `src/platform/` |
| App pages/components | `src/app/pages/`, `src/app/components/` |
| Drive auth and API | `src/app/services/auth.ts`, `src/app/services/drive-api.ts`, `src/app/services/drive/`, `src/platform/drive-auth-web.ts` |
| Local state | `src/app/services/storage.ts`, `src/app/stores/`, `src/app/services/drive/idb.ts`, `src/platform/storage-adapter.ts` |
| Playback | `src/app/pages/PlayerPage.tsx`, `src/app/components/DrivePlayer.tsx`, `src/app/services/mkv-remux/`, `src/app/services/local-library/` |
| Subtitles | `src/app/services/subtitles.ts`, `src/app/services/mkv-subtitles.ts`, subtitle overlay components |
| Sharing | `src/app/services/sharing/`, `src/app/stores/sharing-store.ts`, `src/app/stores/social-store.ts` |
| Server/Supabase | `src/server/db/`, `supabase/` |
