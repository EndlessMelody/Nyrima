# Nyrima — Phase Tracker

Living checklist of where the extension stands. Update on the same commit that
ships the work so this file never drifts.

- Mark `[x]` when shipped, `[~]` when started but not done, `[ ]` for pending.
- Each item carries a short note: what's in, what's still missing, or the
  decision that closed it out.
- `Last touched: <date>` at the top of every phase makes drift visible at a
  glance — bump it whenever you check an item in that phase.

---

## Phase 1 — MVP · **shipped**
_Last touched: 2026-05-16_

- [x] Vite + CRX + React + TS + Once UI + Zustand scaffold
- [x] MV3 manifest (context menu, content script, background SW, popup, app)
- [x] Background SW: OAuth via launchWebAuthFlow, context menu, MRU
- [x] Content script: floating "Open in Cinema" FAB on drive.google.com
- [x] App shell with Once UI (header, theme switch)
- [x] Landing page: Nyrima root + pinned + recents + setup dialogs
- [x] Library page: folder grid + poster cards + subtitle badges
- [x] Player page: native MP4/WebM + MKV native-first; SRT/VTT/ASS auto-mount
- [x] Storage layer (recents, playback positions, settings)
- [x] First clean `npm run build` (Once UI alias + stubs in vite.config.ts)
- [x] OAuth client setup docs (`docs/oauth-setup.md`)
- [ ] Replace placeholder PNG icons with the SVG-derived export
- [ ] End-to-end smoke test on a real shared folder, recorded somewhere

## Phase 2 — Real player · **shipped**
_Last touched: 2026-05-16_

- [x] EBML / MKV header probe to read codec + duration before decoding
- [x] Native-first MKV with MSE remux fallback (force-native strategy)
- [x] MSE-driven streaming via Range fetches (mkv-remux/mse-controller)
- [x] Embedded MKV subtitle extraction (text-based codecs)
- [x] Per-file playback-mode memory (`PLAYBACK_ENGINE_CACHE`)
- [x] Custom VLC-flavored player chrome with full keyboard shortcuts
- [x] DNR rule injects `Authorization: Bearer` on `<video>` Range fetches
- [x] **P2.1** JASSUB / libass for ASS/SSA rendering with full typesetting
  - External `.ass`/`.ssa` route through JASSUB.
  - Embedded MKV `S_TEXT/ASS`/`S_TEXT/SSA` reconstituted ASS now routes
    through JASSUB once the extractor flips `assSourceComplete`. CSS overlay
    handles the streaming window; libass takes over in one clean transition
    on finalize, fixing the prior seek-blank/blink regression.
- [~] **P2.3** Seekable timeline thumbnails — _partial; sprite cache deferred_
  - On-demand hover frame preview ships from a hidden preview video where a
    direct media `src` exists; MSE still falls back to time-only.
  - Sprite generation + IndexedDB cache moved to cross-cutting backlog.
- [→] **P2.4** Audio-track selector for MKVs — _deferred to backlog_
  - MSE pipeline only; needs demuxer to expose all audio tracks, MSE
    controller to support track switching (re-init audio SourceBuffer),
    plus UI. Native-mode `videoEl.audioTracks` is too patchy to lean on.
- [→] **P2.5** Smarter MKV header sniff — _deferred to backlog_
  - Bandwidth optimization (3–4 MB saved per video open). No user-observable
    defect today; 4 MB also seeds the MSE cluster prelude for fast first
    frame, so shrinking has a TTFF cost.
- [→] **P2.2** PGS / image-based subtitles — _deferred_ (picker shows "IMG"
      disabled)

### Player UI polish — 2026-05-16 cinema pass

Ships extra to Phase 2 to make the player feel less like a debug surface.

- [x] Remove the stacked dimming overlay on pause; centre the play/skip trio
- [x] Hover preview bubble: hairline tail, brighter timestamp pill
- [x] `?` keyboard shortcuts cheatsheet (Esc / click-out closes)
- [x] Theatre-mode toggle in the bottom-right cluster — hides info card +
      playlist sidebar and dims the app-shell header via `:has()`
- [x] Next-up autoplay card with poster + countdown, last 20 s of the episode
- [→] Timeline chapter markers — _deferred_ (needs EBML Chapters parsing,
      tracked as F.11)
- [→] Unified Tracks panel (Subtitles + Audio tabs) — _deferred_ (rolls in
      with F.9 audio-track work, tracked as F.12)

## Phase 3 — Library polish · **not started**
_Last touched: 2026-05-16_

- [x] **P3.1** In-library search + sort (name / modified / size / duration)
  - Added search, watch-state filters, persisted sort, and view mode controls.
- [x] **P3.2** Season / episode grouping using the existing title parser
  - Added grouped library sections and a grouped player episode sidebar.
- [x] **P3.3** MAL/Jikan integration for posters + series   metadata
  - Replaced TMDB on 2026-05-16. No API key required; cached 30 d / miss 7 d.
- [ ] **P3.4** Virtualised library grid for huge libraries
- [ ] **P3.5** Library-card upgrades (counts, total runtime, watched badge,
      best-matched poster as cover)
- [ ] **P3.6** Multi-folder libraries — _deferred_ (data-model rewrite)

## Phase 4 — Sharing layer · **not started**
_Last touched: never_

- [ ] Schema for share entries (JSON in a `Shared/` subfolder)
- [ ] Central bootstrap index (public Drive folder with `index.json`)
- [ ] User-to-user follow + pull
- [ ] Comments-as-JSONL append-only
- [ ] "Share this video" UX → produces a viewable Drive link + share entry

## Phase 5 — Realtime + privacy · **not started**
_Last touched: never_

- [ ] Watch parties via WebRTC datachannels (Drive signaling)
- [ ] AES-GCM encrypted libraries for private groups
- [ ] PWA / offline cache for recently watched chunks

---

## Cross-cutting backlog
_Last touched: 2026-05-16_

- [ ] **F.1** Lazy route splitting (`React.lazy` for Library + Player pages)
- [ ] **F.2** Replace `scripts/zip.mjs` tar.gz fallback with `adm-zip`
- [ ] **F.3** Generate real PNG icons from `NyrimaMark` SVG in `make-icons.mjs`
- [ ] **F.4** Vitest setup + parser unit tests
  - `title-normalizer`, `@shared/title-parser`, `@shared/parse-folder-url`
  - SRT/VTT/ASS converters
- [ ] **F.5** De-duplicate the two title parsers (`title-normalizer` vs
      `@shared/title-parser`)
- [ ] **F.6** Replace ad-hoc inline styles with Once UI tokens
- [ ] **F.7** Swap the `AppProviders` shim for `<Providers>` from
      `@once-ui-system/core` once verified to work under Vite
- [ ] **F.8** Timeline thumbnail sprite cache (was P2.3) — generate a sprite
      sheet on first hover, persist in IndexedDB, reuse across sessions
- [ ] **F.9** MKV audio-track selector (was P2.4) — surface all audio tracks
      from demuxer, support switching in MSE pipeline
- [ ] **F.10** Smarter MKV header sniff (was P2.5) — SeekHead-following
      Range fetches instead of the fixed 4 MB prelude
- [ ] **F.11** Timeline chapter markers — parse EBML Chapters → render ticks
      on the seek bar with hover tooltips
- [ ] **F.12** Unified Tracks panel — one popover with Subtitles + Audio
      tabs; rolls in with F.9 audio-track work
