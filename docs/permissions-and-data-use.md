# Permissions And Data Use

This page maps the current Nyrima extension permissions, Google OAuth scopes,
network destinations, storage surfaces, and user controls to the features that
need them. It is the technical audit companion to
[`privacy-policy.md`](./privacy-policy.md).

## Single Purpose

Nyrima's current purpose is to let a user browse and watch Google Drive video
libraries inside a Chrome extension, with optional Drive-native share metadata
and Drive-to-Drive imports the user chooses.

## Manifest Permissions

| Permission | Current use |
| --- | --- |
| `identity` | Start Google OAuth consent from the extension background service worker with `chrome.identity.launchWebAuthFlow`. |
| `storage` | Store local settings, paired Drive root, watch state, Drive access configuration, cache metadata, and social state. |
| `contextMenus` | Add "Open with Nyrima" entry points for Drive folder pages/links. |
| `tabs` | Open or focus the Nyrima app tab for toolbar, popup, and Drive deep-link actions. |
| `declarativeNetRequestWithHostAccess` | Add the OAuth bearer header to matching extension-initiated Google Drive media requests so `<video>` Range requests can stream signed-in media. |
| `alarms` | Run best-effort OAuth token refresh cadence inside the current interactive-consent window. |

## Host Permissions

| Host permission | Current use |
| --- | --- |
| `https://drive.google.com/*` | Run the Drive content script entry action and open Drive folder/file links. |
| `https://www.googleapis.com/*` | Google Drive v3 metadata, media, permission, copy, create, and upload requests. |
| `https://content.googleapis.com/*` | Google content/media paths Drive may use. |
| `https://raw.githubusercontent.com/*` | Optional anonymous bootstrap-directory JSON fetch for discoverable sharing entries. |

The extension CSP also permits relevant Google media/thumbnail hosts used by
Drive redirects and folder artwork thumbnails.

## Google OAuth Scopes

| Scope | Data touched | Current purpose |
| --- | --- | --- |
| `drive.readonly` | Drive folders/files the signed-in user can read | List libraries, read metadata, fetch posters/subtitles, stream media, read accessible share manifests/comment streams. |
| `drive.file` | Files Nyrima creates or opens through this app scope | Create/update app-owned `Shared/` metadata, app-created import folders and copies, and permission updates for app-created share folders. |
| `userinfo.email` | Google account email where returned | Profile-backed identity in the extension/sharing surfaces. |
| `userinfo.profile` | Google profile name/photo where returned | Profile-backed sharing identity and avatar defaults. |

## Network Destinations

| Destination family | Sent data | Purpose |
| --- | --- | --- |
| Google Accounts/OAuth endpoints | OAuth client ID, redirect URL, scope request, Google consent flow data handled by Google | User authorization. |
| Google Drive API/media endpoints | Drive IDs, list/query parameters, API key when configured, OAuth bearer token when needed, media Range requests, app-created JSON/text/upload bodies for write features | Browse, play, share, permission, and import features. |
| Google-hosted Drive thumbnail/media redirect hosts | Browser media/image requests derived from Drive data | Render folder artwork/thumbnails or play media returned by Drive. |
| GitHub raw directory JSON URL | Anonymous public JSON request with credentials omitted | Optional sharing Discover directory cache. |

Nyrima does not send a Google OAuth bearer token to the GitHub raw directory
fetch.

## Local Storage

### `chrome.storage.local`

Current local categories include:

- Paired Drive root and recent Drive folders.
- Playback positions and library view state.
- User settings and subtitle style configuration, including a user-uploaded
  subtitle font data URL if the user chooses one.
- User-provided Drive API key and OAuth client ID.
- Cached Google profile data, share profile, followed public share folders,
  last-good inbox rows, and directory cache.
- Cached poster/playback-strategy metadata and share-folder/public-state IDs.

### `chrome.storage.session`

The service worker keeps a short-lived OAuth access-token cache entry in
Chrome session storage so MV3 service-worker unloads do not immediately break
signed-in Drive calls. The token cache expires and is cleared by sign-out.

### IndexedDB

Nyrima uses IndexedDB cache stores for folder scans, file metadata, subtitle
content, thumbnails, media segments, and related cache state. Cache data is
local to the browser profile.

## Drive-Written Data

When sharing/import features are used with OAuth, Nyrima can create Drive data
under the paired root.

### Sharing

```text
Shared/
  index.json
  comments.jsonl
```

- `index.json` contains share metadata such as share IDs, titles, captions,
  target Drive IDs, share profile snapshots, poster URLs, and timestamps.
- `comments.jsonl` contains comments that user has posted, including target
  share references, text, author snapshot, and timestamps.

When the user publishes the `Shared/` folder, anyone with that Drive folder
link may read the metadata files exposed by that folder permission. Target
videos and libraries keep their own Drive permissions.

### Imports

```text
Imports/
  <share title - timestamp>/
    copied accessible files...
```

Import uses Google Drive copy/create operations. The recipient gets content in
their own Drive only when Drive permits source read/copy access and destination
writes.

## Content Script Data Use

The content script on Drive folder pages:

- Reads the Drive page URL to identify the current folder.
- Looks for visible folder-title text to improve a deep-link label.
- Adds one Nyrima action UI.
- Sends extension messages for opening the app.

It does not need to read Drive cookies or export browsing history.

## User Controls

Current controls include:

- Pair or re-pair the Drive root.
- Choose API key, OAuth client ID, or both.
- Remove stored key configuration from API settings.
- Connect Drive or sign out.
- Clear watch history and clear local caches from the user center.
- Publish or make private the app-created `Shared/` folder.
- Unshare entries from the user's current share manifest.
- Keep target Drive video/library permissions private unless separately
  changed in Google Drive.

## What Nyrima Does Not Do Today

- It does not upload media to a Nyrima backend.
- It does not read browser cookies from Drive or unrelated websites.
- It does not sell Drive data, profile data, or watch data.
- It does not use Drive or extension user data for personalized advertising.
- It does not run a Nyrima analytics endpoint in the current codebase.

