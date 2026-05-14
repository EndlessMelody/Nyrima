# Nyrima — Architecture

This document is the single source of truth for the system shape. Update it
whenever a structural change lands.

## Goals

1. **No backend.** Everything runs in the user's browser. Google Drive is the
   only remote dependency.
2. **Parasitic UX.** The user should feel like Nyrima is part of Drive.
   The right-click "Open with Nyrima" entry plus the floating action on
   `drive.google.com` is the central interaction.
3. **Bring-your-own data.** Users only ever stream their own Drive content.
   Sharing (Phase 4) will be opt-in and per-folder.
4. **Quality first.** Subtitle accuracy and original-bitrate playback matter
   more than fast feature growth.

## Components

### 1. Background service worker — `src/background/service-worker.ts`

- Registers the context menu (`contextMenus`) and toolbar action.
- Owns OAuth: `chrome.identity.getAuthToken({ interactive })`, caches & refreshes.
- Sole holder of access tokens. Other contexts ask via `chrome.runtime.sendMessage`.
- Persists the recent-folders MRU.
- Routes deep-links: "open the app pre-navigated to folder X".

### 2. Content script — `src/content/drive-inject.tsx`

- Runs on `https://drive.google.com/*`.
- Mounts a single Shadow-DOM-hosted floating button at bottom-right.
- Resilient to Drive's SPA navigation via a MutationObserver on `location.href`.
- Only side effect: appending one host element to `document.body`.

### 3. App page — `src/app/`

- A normal extension page (`chrome-extension://<id>/src/app/index.html`).
- React + react-router (`HashRouter` because file:// has no history API).
- Three primary routes:
  - `/` → `LandingPage` (recent + pinned folders)
  - `/library/:folderId` → `LibraryPage` (grid of videos)
  - `/play/:folderId/:fileId` → `PlayerPage`
- Lives in its own tab so it can run heavy WASM in the future without
  jeopardizing the background worker's MV3 budget.

### 4. Popup — `src/popup/`

- Tiny mode-switch surface for power users: jump straight into recent folders
  or open the full app.

## Data flow

```
                                     ┌───────────────────────┐
                                     │ chrome.identity       │
                                     │ getAuthToken          │
                                     └──────────▲────────────┘
                                                │ background only
[ Content script ] ──sendMessage──► [ Background SW ] ──storage─► chrome.storage.local
        ▲                                       ▲
        │                                       │ sendMessage
        │                              ┌────────┴────────┐
        │                              │ App page (React) │
        │                              └────────┬────────┘
        │                                       │ authedFetch
        │                                       ▼
        │                              ┌──────────────────────┐
        │                              │ Google Drive REST    │
        │                              └──────────────────────┘
```

Tokens flow: app → background (`AUTH_GET_TOKEN`) → cached chrome.identity → token.
The app never touches `chrome.identity` directly; this keeps the surface tight.

## Drive API conventions

- All requests through `services/auth.ts → authedFetch`, which retries once on
  HTTP 401 with `interactive=true`.
- Listing is `listFolderAll`, which paginates until exhausted (`pageSize=200`).
- Streaming is `buildMediaUrl(fileId) + Authorization: Bearer …`.

## Theming

Once UI provides a token-based theming system driven by `data-*` attributes on
`<html>`. Nyrima sets these in `src/app/index.html` and flips
`data-theme` from `AppProviders` to switch dark/light. Because Once UI is
designed for Next.js, we deliberately do **not** import its `<Providers>`
wrapper — that pulls `next/navigation`. Instead `AppProviders` carries the
minimum subset we need (theme state).

## Storage schema

`chrome.storage.local` is the only persistent store.

| Key                    | Type                              | Notes                                |
| ---------------------- | --------------------------------- | ------------------------------------ |
| `dc.recentFolders`     | `RecentFolder[]`                  | MRU, capped at 20                    |
| `dc.userProfile`       | `UserProfile`                     | optional; reserved for Phase 3       |
| `dc.playbackState`     | `Record<fileId, PlaybackPosition>`| resume positions                     |
| `dc.settings`          | `AppSettings`                     | preferred sub language, autoplay etc.|

## Tradeoffs & known limits

- **Browser container support.** Phase 1 only plays MP4 / WebM. MKV requires
  WASM decoding, which is Phase 2.
- **Quota.** Drive enforces ~750 GB/day per file for public download. If we
  later make folders shareable, popular files can hit the cap.
- **CSP.** WASM is enabled via `wasm-unsafe-eval` in the manifest CSP. The
  background SW does not need WASM; only the app page does.
- **OAuth scope.** `drive.readonly` is broad. Phase 4 will reconsider with
  `drive.file` + a Google Picker flow for explicit per-folder consent.

## Open questions to revisit

- Folder name on first load: we currently read it from the first file's
  `parents` join; instead we should call `files.get(folderId)` once. Trivial
  to add in `LibraryPage` once we hit the API quota / latency budget.
- Should `LibraryPage` lazy-list (incremental render) instead of waiting for
  `listFolderAll`? For libraries above a few thousand files, yes.
