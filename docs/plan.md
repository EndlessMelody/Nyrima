# Nyrima — Living Plan

Update this file as we go. Keep one in-progress item; commit small.

## Phase 1 — MVP (current)

- [x] Workspace scaffold (Vite + CRX plugin + TS + Once UI + Zustand + react-router)
- [x] Manifest v3 with context menu, content script, background SW, popup, app page
- [x] Background SW: OAuth via `chrome.identity`, context menu, folder MRU
- [x] Content script: floating "Open in Cinema" FAB on `drive.google.com`
- [x] App shell with Once UI (header, theme switch)
- [x] Landing page: pinned + recent folders, "Open a folder" dialog
- [x] Library page: folder grid + video tiles + subtitle badges
- [x] Player page: native MP4/WebM playback, SRT/VTT/ASS auto-mount, resume position
- [x] Storage layer (recent folders, playback positions, settings)
- [x] Generate PNG icons (placeholder via scripts/make-icons.mjs)
- [x] First clean `npm run build` (Once UI alias + stub workarounds documented in progress.txt)
- [ ] First end-to-end manual smoke test with a real Drive folder
- [ ] Document OAuth client setup steps for the maintainer (done — docs/oauth-setup.md)
- [ ] Replace placeholder icons with real SVG-derived export

## Phase 2 — Real player

- [ ] Probe MKV/EBML headers in JS to read codec + duration before decoding
- [ ] Integrate FFmpeg.wasm for MKV→fMP4 remux (no transcode) into MSE
- [ ] OR integrate libmpv WASM as a richer alternative
- [ ] libass / JASSUB for ASS/SSA subtitle rendering with full styling
- [ ] MSE-driven streaming via Range fetches (replace blob URL approach)
- [ ] Seekable timeline with thumbnails (sprite generated client-side)

## Phase 3 — Library polish

- [ ] `files.get(folderId)` to read the real folder name on load
- [ ] Lazy / incremental file listing for huge libraries
- [x] MAL/Jikan integration to fetch posters + summaries by filename
- [ ] Search within a library; sort by date/size/duration
- [ ] Multi-folder libraries (a library is a set of Drive folders)

## Phase 4 — Sharing layer ("P2P on Drive")

- [ ] Schema for share entries (JSON in a `Shared/` subfolder)
- [ ] Central bootstrap index (we host a public Drive folder with `index.json`)
- [ ] User-to-user follow + pull
- [ ] Comments-as-JSONL append-only
- [ ] Sharing UX: "Share this video" → produces a viewable Drive link + entry

## Phase 5 — Realtime + privacy

- [ ] Watch parties via WebRTC datachannels (Drive signaling)
- [ ] AES-GCM encrypted libraries for private groups
- [ ] PWA / offline cache for recently watched chunks

## Cross-cutting / debt

- [ ] Replace ad-hoc inline styles with Once UI tokens consistently
- [ ] Unit tests for `extractFolderId` and subtitle converters (ASS→VTT)
- [ ] Decide if `<Providers>` from `@once-ui-system/core` works in Vite once
      installed; if yes, swap our `AppProviders` shim.
- [ ] Replace `scripts/zip.mjs` tar.gz fallback with `adm-zip` for real `.zip`
