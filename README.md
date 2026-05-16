# Nyrima

A personal video cinema that lives **on top of Google Drive**. Built as a
Chrome Extension so that any folder on `drive.google.com` can be opened
"with Nyrima" — much like a native "Open with..." action.

## What it does (Phase 1, the part that's wired)

- Adds a floating **Open in Nyrima** action on `drive.google.com` for the
  folder you're currently looking at.
- Provides a context-menu entry _"Open with Nyrima"_ on right-click.
- Renders a beautiful library view (Once UI design system) with poster grid,
  durations, resolutions, and matched subtitles.
- Streams **MP4 / WebM / MKV** files with full quality directly from the
  user's Drive — nothing leaves the user's account.
- Auto-matches and renders **SRT / VTT / ASS / SSA** subtitle siblings.
- Extracts embedded subtitles from MKV containers.
- Remembers a per-user MRU list of folders + pin support.
- Resumes playback position across sessions.

## Getting Started

1. Create a folder named **"Nyrima"** in your Google Drive.
2. Share the folder as **"Anyone with the link" → Editor**.
3. Drop your video files into the folder.
4. Set up a Google API key in the extension's Setup Guide.

## Roadmap (forthcoming phases)

| Phase | Goal |
| ----- | ---- |
| **2** | MKV / HEVC support via FFmpeg.wasm or libmpv WASM + libass for ASS rendering |
| **3** | Library metadata (MyAnimeList via Jikan), poster wall, smart sort, search |
| **4** | Forum / sharing layer: shared index, per-user catalogs, comments-as-JSON |
| **5** | Watch parties (WebRTC sync), encrypted private rooms |

## Tech stack

- **Vite 5** + `@crxjs/vite-plugin` (MV3 bundler)
- **React 18** + **TypeScript 5**
- **Once UI** (`@once-ui-system/core`) for the visual system
- **Zustand** for state, **react-router-dom (hash)** for routing
- **chrome.identity** for OAuth (no backend, no secrets)

## Setup

```bash
npm install
npm run dev          # Vite dev server with HMR
npm run build        # Produces dist/, ready for chrome://extensions
npm run zip          # Packs dist/ for the Chrome Web Store
```

### Loading the unpacked extension

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked**, pick the `dist/` folder.
4. Open `chrome://extensions` again, copy the extension's id.
5. See `docs/oauth-setup.md` to create your own OAuth Client ID and paste it
   into `src/manifest.config.ts`. Rebuild.

## Architecture

See [`docs/architecture.md`](./docs/architecture.md) for diagrams and
trade-off discussion. TL;DR:

```
[ Content Script (drive.google.com) ]
              │
              │   chrome.runtime.sendMessage
              ▼
[ Background Service Worker ]──────┐
              │                    │
              │  chrome.identity   │  chrome.storage.local
              ▼                    ▼
[ Google Drive REST API ]    [ Recent folders MRU ]
              ▲
              │ authedFetch (Bearer + 401-retry)
              │
[ App page (React, Once UI) ]
```

## Security / privacy notes

- Tokens never leave the extension. The app never sees a raw token; it asks
  the background worker for one and the worker is the only origin holding it.
- The OAuth scope is `drive.readonly` for now. Phase 4 will move sharing to
  `drive.file` (per-file consent) instead.
- All Drive responses stay client-side. We have no server.

## License

MIT.
