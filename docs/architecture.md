# Nyrima — Architecture

This document is the single source of truth for the system shape. Update it
whenever a structural change lands. For phase / ticket status see
[`../PHASES.md`](../PHASES.md).

## Goals

1. **No backend.** Everything runs in the user's browser. Google Drive is
   the only remote dependency; metadata enrichment goes to Jikan v4 (no
   API key, public endpoint).
2. **Parasitic UX.** The user should feel like Nyrima is an extension of
   Drive itself. The floating action on `drive.google.com` plus the
   right-click context entry are the primary entry points.
3. **Bring-your-own data.** Users only ever stream their own Drive content.
   Sharing (Phase 4) will be opt-in and per-folder.
4. **Quality first.** Subtitle accuracy and original-bitrate playback matter
   more than fast feature growth.

## Components

### 1. Background service worker — `src/background/service-worker.ts`

- Registers the context menu (`contextMenus`) and toolbar action.
- Optional OAuth holder via `chrome.identity.launchWebAuthFlow` for the
  rare files that require it. API-key auth is the default path.
- Persists the recent-folders MRU and the Nyrima root pairing.
- Routes deep-links: "open the app pre-navigated to folder X".

### 2. Content script — `src/content/drive-inject.tsx`

- Runs on `https://drive.google.com/*`.
- Mounts a single Shadow-DOM-hosted floating button at bottom-right.
- Resilient to Drive's SPA navigation via a MutationObserver on
  `location.href`.
- Only side effect: appending one host element to `document.body`.

### 3. App page — `src/app/`

- A normal extension page (`chrome-extension://<id>/src/app/index.html`).
- React + react-router (`HashRouter` — file:// has no History API).
- Routes:
  - `/` → `LandingPage` (lobby: hero + stats strip + shelves)
  - `/library/:folderId` → `LibraryPage` (grid / list / grouped views)
  - `/play/:folderId/:fileId` → `PlayerPage`
- Lives in its own tab so heavy WASM (libass) doesn't compete with the
  background worker's MV3 budget.

### 4. Popup — `src/popup/`

- Tiny mode-switch surface: jump straight into recent folders or open the
  full app.

### 5. MKV remux pipeline — `src/app/services/mkv-remux/*`

- EBML parser → demuxer → fMP4 fragment writer feeding MSE.
- `mse-controller.ts` owns the lifecycle: 4 MB header prelude + progressive
  Range-fetched stream → demuxed clusters → fragmented MP4 → SourceBuffer.
- Piggybacks the same byte stream on the subtitle feeder so embedded MKV
  subs extract without a second network roundtrip.

### 6. Subtitle pipeline — `src/app/services/{mkv-subtitles, subtitles}.ts`

- External `.srt` / `.vtt` / `.ass` / `.ssa` siblings auto-mount.
- Embedded MKV `S_TEXT/UTF8 | ASS | SSA` extract live during streaming.
- ASS routes through **JASSUB** (libass-wasm) for typesetting; embedded
  reconstituted scripts hand off on finalize once the extractor flips
  `assSourceComplete`. The CSS overlay bridges the streaming window.
- A `forceCenterDialogueInAss` pass rewrites Dialogue Alignment to 2
  (bottom-center) — positioned signs with `\pos` / `\move` are left alone.

## Data flow

```
[ Content script (drive.google.com) ]
        │   chrome.runtime.sendMessage (deep-link / open-folder)
        ▼
[ Background service worker ]
        │   chrome.storage.local                  optional OAuth
        ▼                                          via launchWebAuthFlow
[ chrome.storage.local ]                        [ Drive REST ]
        ▲
        │
[ App page · React · Once UI ]
        │                              ┌─────────────────────────┐
        │ authedFetch (API key first,  │  declarativeNetRequest  │
        │  Bearer fallback)            │  rule on googleapis      │
        ▼                              │  stamps Authorization    │
[ Drive REST: files.list, files.get,   │  on <video> Range fetches│
  alt=media ]                          └──────────┬───────────────┘
        │                                         │
        │   Range bytes                           │
        ▼                                         ▼
[ MSE controller ] ─── demux ─── fMP4 frags ─── [ <video> ]
        │                                         ▲
        │   subtitle bytes (piggyback)             │ JASSUB canvas
        ▼                                         │
[ extractMkvSubtitles ] ── cues / ASS source ─── [ SubtitleOverlay ]

[ Jikan v4 (api.jikan.moe) ] ─── posters / scores / synopses
        ▲
        │ resolvePoster (folder-aware query, throttled to ~1 req/s)
[ App page ] ─── persisted in chrome.storage.local under METADATA_CACHE.v2
```

Tokens flow: app → background (`AUTH_GET_TOKEN`) → cached chrome.identity
→ token. The app never touches `chrome.identity` directly; this keeps the
surface tight.

## Drive API conventions

- All requests through `services/auth.ts → authedFetch`, which retries
  once on HTTP 401 with `interactive=true` (OAuth path only).
- Listing is `listFolderAll`, paginating until exhausted (`pageSize=200`),
  fronted by a request queue + dedup layer (`services/drive/*`).
- Streaming is `googleapis.com/.../alt=media&key=...` for the API-key
  path, or `Authorization: Bearer …` stamped via a DNR rule for OAuth.

## Theming

Once UI provides a token-based theming system driven by `data-*`
attributes on `<html>`. Nyrima sets these in `src/app/index.html` and
flips `data-theme` from `AppProviders` to switch dark/light. Because
Once UI is designed for Next.js, we deliberately do **not** import its
`<Providers>` wrapper — that pulls `next/navigation`. Instead
`AppProviders` carries the minimum subset we need (theme state).

The player chrome uses its own dark-first "Neon Cinema" tokens; the rest
of the app uses the Once UI tokens.

## Storage schema

`chrome.storage.local` is the only persistent store.

| Key                          | Type                              | Notes                                                                                                    |
| ---------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `dc.nyrimaRoot`              | `NyrimaRoot`                      | The verified root folder. Re-validated on every refresh; renames surface as a `rootError`.               |
| `dc.recentFolders`           | `RecentFolder[]`                  | MRU + per-library stats (videoCount / runtimeMs / watchedCount / coverPosterUrl). Capped at 20.          |
| `dc.userProfile`             | `UserProfile`                     | Optional OAuth-only profile; populated lazily.                                                           |
| `dc.playbackState`           | `Record<fileId, PlaybackPosition>`| Resume positions; throttled writes (≥4 s apart) to avoid storage churn.                                  |
| `dc.settings`                | `AppSettings`                     | Preferred sub language, autoplay-next, default volume, theme, subtitle styling, skip seconds, list view. |
| `dc.metadataCache.v2`        | `Record<fileId, MovieMetadata>`   | Jikan results. 30 d TTL on hits, 7 d on misses. `v2` busted the broken pre-folder-aware entries.         |
| `dc.playbackEngineCache`     | `Record<fileId, "native"|"mse">`  | Per-file MKV playback-mode LRU so re-opening skips the watchdog.                                         |
| `dc.apiKey` / `dc.oauthClientId` | `string`                      | User-configured auth credentials, set from the Setup dialog.                                             |

## Trade-offs & known limits

- **MSE memory.** The remux path appends fragments to a SourceBuffer.
  We cap accumulated buffered audio+video to ~64 MB and trim behind the
  current playhead to keep memory steady on multi-hour files.
- **CORS on video frames.** Drive's media endpoint doesn't send CORS, so
  we can't sample the live `<video>` frame for the ambient glow. We
  sample the cached MAL poster (CORS-friendly) instead.
- **Jikan rate limits.** Public Jikan caps at ~3 req/sec and ~60/min. The
  resolver throttles to one concurrent request with a ≥1100 ms gap so a
  freshly opened large library doesn't earn a temporary IP ban.
- **OAuth scope.** `drive.readonly` is broad. Phase 4 will reconsider
  with `drive.file` + a Google Picker flow for explicit per-folder
  consent.
- **Browser support.** `content-visibility: auto` (P3.4 virtualisation)
  and `:has()` (theatre-mode header dimming) are Chromium-only; this is
  a Chrome extension so the assumption is safe.

## Open questions to revisit

- **Audio-track switching.** F.9 needs the demuxer to surface *all*
  audio tracks and the MSE controller to support a track swap (reset
  audio SourceBuffer, re-stream from a keyframe). Non-trivial; deferred.
- **Cross-device sync.** Writing playback positions + library stats to a
  hidden `Nyrima/state.json` on the user's Drive would unlock multi-
  device resume. Bridges naturally into Phase 4.
- **Live-frame ambient glow.** Would require either a CORS-friendly Drive
  proxy or a server. Not worth the complexity right now.
