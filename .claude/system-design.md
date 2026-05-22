# Nyrima System Design Guidance

This is the short project-memory version of the current architecture. Use
[`../docs/architecture.md`](../docs/architecture.md) as the detailed canonical
document.

## Design North Star

Nyrima is a personal Google Drive cinema inside a Chrome Manifest V3
extension.

Preserve these truths unless a design explicitly changes them:

- User media stays in Google Drive and plays in the browser.
- There is no Nyrima backend receiving video libraries or media bytes today.
- Signed-in access is BYOK OAuth through the extension service worker.
- Public API-key access and OAuth access are different paths with different
  permission and quota behavior.
- Sharing is opt-in Drive metadata federation, not a centralized social
  backend and not a Drive permission bypass.

## Extension Contexts

| Context | Current role |
| --- | --- |
| Manifest | Declares MV3 permissions, hosts, action, content script, worker, and CSP. |
| Background service worker | OAuth, token cache, refresh alarm, DNR media auth rule, Drive/app deep-link messages, context menu. |
| App page | Lobby, libraries, player, settings, Drive services, social hub, heavy media work. |
| Drive content script | Drive folder entry action and URL/folder deep-link bridge. |
| Popup | Quick app/recent-folder entry point. |

Do not push heavy media parsing, long UI state, or page rendering into the MV3
worker.

## Auth And Access Layers

### API-key path

- A user-provided Drive API key is local configuration.
- It can serve public Drive reads when Drive permits them.
- It does not grant private Drive access.

### BYOK OAuth path

- The user provides a Chrome Extension OAuth client ID for the loaded extension
  ID.
- The service worker starts OAuth with `launchWebAuthFlow`.
- Current scope set includes Drive read, app-created Drive writes through
  `drive.file`, and user-info scopes.
- The worker owns short-lived token cache and the dynamic bearer-header rule
  for direct OAuth media requests.

Avoid reintroducing a shared manifest OAuth client flow without a new design
and policy review.

## Data Placement

| Data family | Current placement |
| --- | --- |
| Videos, posters, subtitles, Drive target permissions | Google Drive |
| Settings, watch progress, Drive root, recents, credentials, follows, social caches | `chrome.storage.local` |
| Short-lived OAuth access-token entry | worker memory and `chrome.storage.session` |
| Folder/media/subtitle/thumbnail caches | IndexedDB cache stores |
| Shares/comments | app-created Drive `Shared/index.json` and `Shared/comments.jsonl` |
| Imports | app-created Drive `Imports/` copies |

When changing data placement, update architecture, permissions/data-use, and
policy docs together.

## Drive Library Model

- One paired root folder is the library entry point.
- Direct child folders become library surfaces.
- Folder artwork comes from user-placed `Poster.*` and `Backdrop.*`.
- Subtitle matching and title parsing are local app behavior over Drive files.
- Root validation and account resets protect caches from stale Drive-account
  assumptions.

Keep Drive IDs validated and query strings escaped at boundary helpers.

## Playback Boundaries

### Preferred path

Use browser-native media playback when Chrome can handle the file directly.

### MKV fallback path

The current remux boundary is:

```text
Drive Range bytes -> EBML/demux -> fMP4 fragments -> MSE SourceBuffers
```

The fallback is local browser work, not transcoding/upload.

Fragile areas that deserve tests and caution:

- SourceBuffer lifecycle and seek recovery.
- Decode order versus presentation timing.
- MKV lacing and track metadata.
- fMP4 box shape and codec-brand details.
- Split audio/video buffering and audio-track switching.
- AC-3 fallback behavior in Chromium.

### Subtitle boundary

External subtitle files and supported embedded MKV text tracks enter subtitle
services. JASSUB/libass handles rich ASS/SSA rendering where supported.

## Sharing Boundary

Current sharing topology:

```text
owner Shared/index.json -> follower Inbox
commenter Shared/comments.jsonl -> owner aggregate of followed comment streams
share target -> Drive permission boundary -> optional Drive copy import
```

Rules:

- Publishing `Shared/` exposes metadata files in that folder to people with
  the folder link.
- It does not automatically publish target files/folders.
- Drive copy/import respects source capabilities and owner restrictions.
- Public index and directory JSON are untrusted input and must be sanitized.
- Drive JSON/JSONL writes are read-modify-write; local queues do not create
  cross-device atomicity.

## Trust Boundaries

| Boundary | Rule |
| --- | --- |
| Drive page | Content script is a launcher, not a token/data authority. |
| Service worker | OAuth/token/DNR state lives here. |
| Google Drive | Google enforces permission, quota, copy, and media access. |
| Public share manifests | Sanitize before rendering/trusting. |
| Public GitHub directory JSON | Anonymous fetch, sanitize, TTL-cache. |
| Local device/profile | Local caches and watch state follow profile security. |

## Deliberate Redesign Triggers

Write a design and revisit docs/policy before:

- Adding a Nyrima backend.
- Syncing watch history or secrets to Drive or another remote store.
- Changing OAuth scopes, client strategy, or public permission behavior.
- Moving from Drive-only sharing to centralized or realtime social features.
- Replacing the media pipeline or extending codecs in a way that changes
  playback/data flow.
- Publishing new public promo-site claims about current behavior.

