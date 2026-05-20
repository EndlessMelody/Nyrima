# Nyrima — Architecture

This document is the single source of truth for the system shape. Update it
whenever a structural change lands. For phase / ticket status see
[`../PHASES.md`](../PHASES.md).

## Goals

1. **No backend.** Everything runs in the user's browser. Google Drive
   is the only remote dependency. Metadata is whatever the user places
   alongside their videos (`Poster.*`, `Backdrop.*`) — no external
   metadata service. The Phase 4.4 bootstrap directory is the only
   non-Drive endpoint, and it's a single anonymous JSON fetch.
2. **Parasitic UX.** The user should feel like Nyrima is an extension of
   Drive itself. The floating action on `drive.google.com` plus the
   right-click context entry are the primary entry points.
3. **Bring-your-own data.** Users only ever stream Drive content they can
   access. Sharing is opt-in: users publish a public `Shared/` manifest folder,
   but target videos/libraries still require their own Drive permissions.
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
  - `/social`, `/social/:tab`, `/social/shelf/:folderId` → Drive-only
    sharing hub (Inbox, My Shares, People, Activity, Privacy)
- Lives in its own tab so heavy WASM (libass) doesn't compete with the
  background worker's MV3 budget.

### 4. Popup — `src/popup/`

- Tiny mode-switch surface: jump straight into recent folders or open the
  full app.

### 5. MKV remux pipeline — `src/app/services/mkv-remux/*`

- EBML parser → demuxer → fMP4 fragment writer feeding MSE.
- `mse-controller.ts` owns the lifecycle: 4 MB header prelude + progressive
  Range-fetched stream → demuxed clusters → fragmented MP4 → SourceBuffer.
- **Split SourceBuffers.** Video and audio each have their own
  SourceBuffer on one MediaSource. Lets HEVC + FLAC files (typical of
  Blu-ray rips with multiple dubs) play without a multiplexed init
  segment, and unlocks `switchAudio(trackNumber)` for in-place dub
  swapping with no page reload — the video pipe is untouched while the
  audio SourceBuffer runs `changeType` + back-fill from the cluster
  covering `currentTime − 0.5 s`.
- **Lacing-aware demux.** `parseSimpleBlock` handles Xiph (1), fixed
  (2), and EBML (3) lacing so multi-frame FLAC blocks land as separate
  `DemuxedSample`s with PTS advanced by `defaultDurationNs × frame`.
- **Decode-order preserved.** `extractClusterSamples` does NOT sort by
  PTS — MKV SimpleBlocks are stored in decode order and B-frames break
  if reshuffled by display order.
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

[ Drive folder ] ─── Poster.{jpg,png,webp} / Backdrop.*
        │ metadata-service resolves a folder-local cover URL
        ▼
[ chrome.storage.local · dc.metadataCache.v3 ]
```

There is no third-party metadata API. The legacy MAL/Jikan path was
removed on 2026-05-18 in favour of user-placed cover files inside each
library folder. `METADATA_CACHE.v3` busted any stale `.v2` entries on
upgrade.

Sharing data is file-federated through Drive rather than centralized:

```
[ User A Nyrima root ]
        └─ Shared/                     public: anyone-with-link reader
             ├─ index.json             v=2, inline ShareEntry[]
             └─ comments.jsonl         User A's outbound comments

[ User B app ] ── follows A's Shared URL ──► read A/index.json → Inbox/Shelf
[ User B app ] ── comments on A share ─────► append B/comments.jsonl
[ User A app ] ── scans followed users ────► read B/comments.jsonl,
                                             filter by A sharedFolderId
[ User B app ] ── imports A share ─────────► Drive files.copy into
                                             B/Nyrima/Imports/<title>/
```

The share manifest is metadata plus Drive target ids/links. It does not grant
access to the underlying video file or library folder. Import is not a torrent
swarm: it is Drive's server-side copy path. Recipients avoid a browser
download/re-upload round trip, but Drive still enforces source permissions and
owner copy/download restrictions.

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
- Share import uses `files.copy` for each source file and creates folders with
  `files.create`. Single-video imports also copy obvious companions from the
  source folder (`Poster.*` plus same-basename subtitle files). Library imports
  recurse through the folder tree sequentially to stay gentle on Drive quota.

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
| `dc.metadataCache.v3`        | `Record<fileId, MovieMetadata>`   | Folder-placed `Poster.*` / `Backdrop.*` URLs. `v3` busted the legacy MAL/Jikan entries from `.v2`.       |
| `dc.playbackEngineCache`     | `Record<fileId, "native"|"mse">`  | Per-file MKV playback-mode LRU so re-opening skips the watchdog.                                         |
| `dc.apiKey` / `dc.oauthClientId` | `string`                      | User-configured auth credentials, set from the Setup dialog.                                             |
| `dc.shareProfile`            | `ShareProfile`                    | User's share handle/name/avatar, stamped into entries and comments.                                      |
| `dc.sharedFolderId`          | `string`                          | Cached Drive id of the user's flat `Shared/` folder.                                                     |
| `dc.followedUsers`           | `FollowedUser[]`                  | Local follow graph; each row points at another user's public `Shared/` folder.                           |
| `dc.socialInboxCache.v1`     | `{ v, items, lastSyncedAt }`      | Last-good flattened inbox rows so `/social` can render before the next Drive pull.                       |
| `dc.directoryCache.v1`       | `{ source, fetchedAt, entries }`  | Cached public bootstrap directory from GitHub raw, refreshed on a 24 h TTL.                              |

Drive-created import folders live under `Nyrima/Imports/`. They are ordinary
Drive folders, not a separate chrome.storage schema.

## Trade-offs & known limits

- **MSE memory.** The remux path appends fragments to a SourceBuffer.
  We cap accumulated buffered audio+video to ~64 MB and trim behind the
  current playhead to keep memory steady on multi-hour files.
- **CORS on video frames.** Drive's media endpoint doesn't send CORS, so
  we can't sample the live `<video>` frame for the ambient glow. We
  sample the user's folder-placed `Poster.*` / `Backdrop.*` (served via
  Drive's thumbnail CDN, CORS-friendly) instead.
- **OAuth scope.** The current scope set is `drive.readonly` (browsing)
  + `drive.file` (Shared/ writes and Imports/ copies) +
  `userinfo.{email,profile}` (share handle). `drive.file` only grants
  access to files the extension itself creates, which keeps the
  blast radius of a stolen token small. A future Google Picker flow
  could narrow `drive.readonly` further but is not gated on Phase 5.
- **Drive social writes.** `index.json` and `comments.jsonl` use Drive
  read-modify-write. Nyrima queues mutations locally per `Shared/` folder so
  same-context share/comment actions do not overwrite each other, but two
  devices can still race because there is no backend arbiter.
- **Share semantics.** Publishing `Shared/index.json` exposes metadata and
  target links only. Recipients still need Drive permission on the actual
  video or library to open it or import it. If the owner disables copying,
  Nyrima surfaces that as an import failure rather than falling back to local
  download/re-upload.
- **Browser support.** `content-visibility: auto` (P3.4 virtualisation)
  and `:has()` (theatre-mode header dimming) are Chromium-only; this is
  a Chrome extension so the assumption is safe.

## Open questions to revisit

- **Cross-device sync.** Writing playback positions + library stats to a
  hidden `Nyrima/state.json` on the user's Drive would unlock multi-
  device resume. Could ride alongside the Phase 5 privacy work since
  both write user-owned state to Drive.
- **Live-frame ambient glow.** Would require either a CORS-friendly Drive
  proxy or a server. Not worth the complexity right now.
- **WebCodecs audio pipeline.** Decoupling the audio side onto an
  `AudioDecoder` + `AudioWorklet` would let us cover DTS/TrueHD and
  drop the SourceBuffer `changeType` dance during dub swaps. Tradeoff:
  manual A/V sync via `video.currentTime`, plus losing PiP/Cast for
  audio. Defer until the current MSE path can't be made to behave on
  a specific class of files.
