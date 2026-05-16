<div align="center">

<img src="public/icons/icon-128.png" width="120" alt="Nyrima logo" />

# Nyrima

### Personal Video Cinema on Google Drive

*Turn your Drive folder into a private streaming room — original quality, no backend, no uploads.*

[![Built with React](https://img.shields.io/badge/Built%20with-React%2018-61DAFB?logo=react&logoColor=white&style=flat-square)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5%2B-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Bundler-Vite%205-646CFF?logo=vite&logoColor=white&style=flat-square)](https://vitejs.dev)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-MV3-4285F4?logo=googlechrome&logoColor=white&style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro)
[![License](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](#license)
[![Tests](https://img.shields.io/badge/Vitest-26%20passing-86EFAC?logo=vitest&logoColor=white&style=flat-square)](#testing)

[Architecture](./docs/architecture.md) • [Roadmap](./PHASES.md) • [Living Plan](./docs/plan.md) • [OAuth Setup](./docs/oauth-setup.md) • [Report an issue](https://github.com/EndlessMelody/Nyrima/issues)

</div>

---

## About

Nyrima is a Chrome MV3 extension that turns a single Google Drive folder
into your personal cinema. Pair it with a folder you call your **Nyrima
root** and every child folder becomes a library tile in a cinematic lobby:
covers from MyAnimeList, season / episode grouping, watch-state filters,
continue-watching, and a custom VLC-flavored player that streams the
original bytes from Drive — no transcoding, no third-party server, your
tokens never leave the extension.

Phases 1 (MVP), 2 (real player), and 3 (library polish) are shipped. See
[`PHASES.md`](./PHASES.md) for the rolling status of every ticket.

## Why Nyrima?

Most "watch from Drive" workflows force a tradeoff that takes the cinema
out of personal media:

- **Lossy re-encodes** — Drive's web preview re-encodes to ~360p. Fan-edits
  and remuxed Blu-rays get mangled.
- **Broken fansub typesetting** — Drive's preview ignores embedded ASS.
  Signs, karaoke, and positioned credits disappear.
- **Lost progress across devices** — every fresh tab starts from frame 0.
- **No cinematic surface** — a `<video>` tag inside drive.google.com is
  not a movie night.

Nyrima keeps the bytes original, renders ASS through **libass** (JASSUB),
remembers playback positions, and frames the whole experience like a
private streaming app.

## Features

### Lobby & library
- **Nyrima root model** — pair with one Drive folder; its children become
  libraries. Re-validated on every refresh so renames surface clearly.
- **Lobby dashboard** with a Continue / Featured hero, an instrument-tape
  stats strip (libraries · episodes · total runtime · watched), pinned and
  random-pick shelves, plus a Continue-Watching horizontal scroll.
- **Library page** with in-folder search, watched-state filters, persisted
  sort (name / modified / size / duration), and three view modes
  (grouped seasons / poster grid / list).
- **Library cards** show a MAL/Jikan cover backdrop, episode count, total
  runtime, and a watched-ratio pill that turns solid at completion.
- **Season / episode grouping** built on a folder-aware title parser so
  `[GS]01.mkv` reads as *Gimai Seikatsu · S01 · Ep01*.
- **MAL/Jikan metadata** with folder-aware queries (episodic filenames
  query the folder name, not the bare episode number). 30-day cache for
  hits, 7-day for misses.
- **Background bulk-enrichment** — un-visited libraries get stats + covers
  fetched in the background on lobby load, so the UI fills in without
  the user clicking through each library.
- **Browser-native virtualisation** via `content-visibility: auto` on
  every grid and list surface — collections with hundreds of episodes
  stay smooth.

### Player
- **Native-first MKV** with an automatic MSE-remux fallback. EBML header
  probe reads codec + duration before decoding; per-file playback-mode
  cache so re-opening the same file skips the watchdog cost.
- **Custom Neon Cinema chrome** with mono timecodes, centered play/skip
  trio, auto-hiding HUD, hover preview bubble with a hairline tail, and
  four corner brackets.
- **Subtitles** — SRT / VTT / ASS / SSA auto-mount from siblings;
  embedded MKV subs extract live during playback; **JASSUB / libass**
  renders typesetting (positions, karaoke, fades, fonts). Embedded ASS
  hands off to libass on finalize, with the CSS overlay bridging the
  streaming window.
- **Smart resume pill** — *Resume at MM:SS / Restart*, auto-confirms
  after a draining 3.5 s timer.
- **Pre-roll Now-Playing card** — series · episode · runtime fades over
  the first frame for 3.4 s.
- **Ambient backdrop glow** sampled from the cached MAL poster, painted
  via box-shadow around the player frame; transitions smoothly between
  episodes.
- **Next-up autoplay card** with poster + countdown in the closing
  seconds. Auto-advance fires on the `<video>` `ended` event so you see
  the final frame first.
- **Theatre-mode toggle** hides the surrounding chrome and dims the app
  header without going fullscreen.
- **`?` keyboard cheatsheet** documenting every shortcut grouped by
  intent.
- **Subtitle styling panel** — font preset, custom font upload, weight,
  fill / outline color, shadow, letter spacing, vertical position.

### Platform
- **No backend.** Every byte of media flows from Drive to your browser.
  No Nyrima server, no analytics endpoint.
- **API-key-first auth** with optional OAuth (chrome.identity) only for
  files that need it. The `Authorization: Bearer` header is stamped on
  `<video>` Range fetches via a declarativeNetRequest rule.
- **One source of truth for filename parsing** — `@shared/title-parser`
  handles folder + filename → show / season / episode / specials, plus
  filename-only normalization for movies.

## Getting started

1. Pick a folder on Google Drive — call it whatever you want (the
   *default* is `Nyrima`). It becomes your library root.
2. Drop folders of videos into it. Each child folder of the root is one
   library in the lobby.
3. Install the extension (see [Loading the unpacked extension](#loading-the-unpacked-extension)).
4. On first launch, the welcome screen walks through:
   - Pairing the Nyrima root folder you just created.
   - Adding a Google API key (preferred) — the Setup dialog explains the
     minimum scopes. OAuth is optional and only needed for private files.

## Tech stack

- **Vite 5** + `@crxjs/vite-plugin` — MV3 bundler with HMR.
- **React 18** + **TypeScript 5.5+** — strict mode.
- **Once UI** (`@once-ui-system/core`) for typography and design tokens.
- **Zustand** for app state, **react-router-dom (Hash)** for routing.
- **MSE + EBML parser** for the MKV-remux pipeline
  ([`mkv-remux/`](src/app/services/mkv-remux)).
- **JASSUB / libass-wasm** for ASS / SSA rendering.
- **Jikan v4** (no API key) for MAL metadata.
- **chrome.declarativeNetRequest** for the `Authorization` header rule.
- **Vitest** for the unit-test suite.

## Setup

```bash
npm install
npm run dev          # Vite dev server with HMR
npm run build        # tsc --noEmit + production build → dist/
npm run zip          # Pack dist/ for the Chrome Web Store
npm test             # Run the Vitest suite once
npm run test:watch   # Re-run on save
```

### Loading the unpacked extension

1. `npm run build`.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked**, pick the `dist/` folder.
4. Open Nyrima (toolbar icon or the in-tab app at
   `chrome-extension://<id>/src/app/index.html`).
5. Pair your Nyrima root folder when prompted, then add a Google API key.
6. If you need OAuth (private folders), follow
   [`docs/oauth-setup.md`](./docs/oauth-setup.md).

## Testing

```bash
npm test
```

Covers the pure-logic modules the rest of the app leans on:

- `@shared/title-parser` — `parseTitle`, `normalizeMovieTitle`,
  `isEpisodicFilename`, `isSeasonFolderName`.
- `services/subtitles` — SRT / VTT / ASS parsers, `forceCenterDialogueInAss`,
  `detectLang`.

UI components stay out of the unit suite for now — the `chrome.*` surface
and the WebGL/canvas paths in the player are better covered by manual
smoke passes.

## Documentation

The repository keeps four living documents, each with a clear job:

| Document | Purpose |
| --- | --- |
| [`README.md`](./README.md) | This file. What Nyrima is, what's shipped, how to run it. |
| [`PHASES.md`](./PHASES.md) | The single source of truth for ticket status — what shipped, what's deferred, what's in the cross-cutting backlog. Updated on the same commit that lands the work. |
| [`docs/architecture.md`](./docs/architecture.md) | System shape — components, data flow, storage schema, trade-offs, open questions. |
| [`docs/plan.md`](./docs/plan.md) | The *why* behind each phase. Higher-level than PHASES.md; points readers there for status. |
| [`docs/oauth-setup.md`](./docs/oauth-setup.md) | Optional OAuth client setup for private folders. |

## Roadmap

Detailed status lives in [`PHASES.md`](./PHASES.md). Headlines:

- **Phase 1 — MVP** — shipped.
- **Phase 2 — Real player** — shipped (MKV, JASSUB, custom HUD, ambient,
  resume pill, next-up).
- **Phase 3 — Library polish** — shipped (search, grouping, MAL,
  virtualised grid, card upgrades, lobby stats, bulk-enrichment).
- **Phase 4 — Sharing layer** — not started. Per-folder share entries on
  Drive, follow + pull, comments-as-JSONL.
- **Phase 5 — Realtime + privacy** — not started. Watch parties via
  WebRTC datachannels (Drive signaling), AES-GCM encrypted libraries,
  PWA offline cache.

Cross-cutting backlog: audio-track selector for MKVs (F.9), smarter
SeekHead-following header sniff (F.10), timeline chapter markers (F.11),
unified Tracks panel (F.12), and a few code-hygiene items.

## Security & privacy

- **Tokens never leave the extension.** The background worker is the
  only origin that holds OAuth tokens; the app page asks via
  `chrome.runtime.sendMessage` and never owns one directly.
- **API-key auth is the default.** OAuth only kicks in when a file
  requires it; `drive.readonly` scope, narrow by design.
- **No server.** All Drive responses stay client-side; Jikan is the only
  external endpoint, used solely for poster/metadata lookups.
- **CSP-friendly.** WASM (libass) loads via `wasm-unsafe-eval` in the
  manifest CSP; nothing inline.

## License

MIT.
