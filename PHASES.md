# Nyrima — Phase Tracker

Living checklist of where the **web app** stands. Update on the same commit
that ships the work so this file never drifts.

- Mark `[x]` when shipped, `[~]` when started but not done, `[ ]` for pending.
- Each item carries a short note: what's in, what's still missing, or the
  decision that closed it out.
- `Last touched: <date>` at the top of every phase makes drift visible at a
  glance — bump it whenever you check an item in that phase.

---

## Extension era (shipped, retired to `legacy/`)
_2026-05-16 → 2026-06-10_

Nyrima began as a Chrome Manifest V3 extension. Phases 1–6 below shipped in
that form and are preserved for history; the extension-only surfaces
(manifest, background service worker, content script, popup) now live in
[`legacy/extension/`](./legacy/extension/) — see
[`legacy/extension/README.md`](./legacy/extension/README.md) for what moved
where and why it's kept.

- **Phase 1 — MVP**: Vite + CRX + React + TS + Once UI + Zustand scaffold, MV3
  manifest, background SW (OAuth via `launchWebAuthFlow`, context menu, MRU),
  "Open in Cinema" content-script FAB, lobby/library/player pages, storage
  layer, OAuth setup docs, managed icon export, sharing user guide.
- **Phase 2 — Real player**: EBML/MKV header probe, native-first MKV with MSE
  remux fallback, embedded subtitle extraction, per-file playback-mode memory,
  custom VLC-flavored player chrome, DNR-injected `Authorization: Bearer`,
  JASSUB/libass ASS/SSA rendering, MKV audio-track selector with split
  SourceBuffers + AC-3 external-audio lane. Deferred: timeline thumbnail
  sprite cache (→ **F.8**), PGS/image subtitles, SeekHead-following header
  sniff (→ **F.10**).
- **Phase 3 — Library polish**: search/sort/filter, season/episode grouping,
  MAL/Jikan poster + metadata integration, `content-visibility` virtualized
  grids, library-card stats (episode count, runtime, watched ratio). Deferred:
  multi-folder libraries.
- **Phase 4 — Sharing layer**: Drive-native `Shared/` folder model (inline
  `index.json` v=2 + flat `comments.jsonl`), share composer, Social hub
  (Inbox / My Shares / People / Activity / Privacy), follow + pull, comments,
  bootstrap discovery directory, Drive-to-Drive import.
- **Pre-launch hardening**: version 0.1.0, `.gitignore` scratch coverage,
  security pass (CSP, DNR scoping, BYOK OAuth + 72h consent ceiling, manifest
  validation against followed users' Drive manifests), keyboard shortcut
  audit, docs refresh, TSC + Vitest green (112 tests / 17 files).
- **Phase 6 — Local file playback + security hardening**: File System Access
  API support for Movies / Light Novel / Music alongside Drive, path-derived
  `local-` ids, local MSE byte-source, quick-open + session-only folders,
  build-time CSP, OAuth CSRF nonce fallback, `npm audit` clean.

---

## Web app era

### Phase W1 — Web app migration · **shipped**
_Last touched: 2026-06-11_

`d:\Nyrima` itself became a unified web app: the extension shell was retired
to `legacy/extension/`, `chrome.*` APIs are now backed by
[`src/platform/chrome-shim.ts`](./src/platform/chrome-shim.ts), Drive OAuth
moved to a web PKCE flow, and a public marketing site + account system
(Supabase, social-only — friends and folder comments, never cloud-sync) sit
in front of the authenticated app at `/app`. Guest mode ("Try Nyrima") allows
playback without an account.

- [x] Route tree rebuilt around `/`, `/login`, `/app`, `/library*`, `/play`,
  `/read`, `/music`, `/social`, `/settings`, `/account` (`src/App.tsx`)
- [x] `chrome-shim` installed before any store/service loads (`src/main.tsx`)
- [x] Web Drive OAuth (PKCE) + guest session (`src/auth/`, `src/platform/drive-auth-web.ts`)
- [x] Local file playback (Movies / Light Novel / Music) carried over from
  Phase 6, web-compatible
- [x] `npm run check` green: typecheck + 303 tests across 48 files + docs:check

### Phase W2 — Smoothness + workspace cleanup · **in progress**
_Last touched: 2026-06-12_

First post-migration pass: make the app feel fast and the repo feel clean.

- [x] Workspace cleanup — removed orphaned root screenshots, dead pnpm
  lockfile pair (npm is canonical), stale `progress.txt`, 76 MB of
  extension-era release zips, dead `APP_PAGE` constant; `.gitignore` covers
  root-level dev screenshots
- [x] Doc refresh — README / architecture lead with the web app; extension
  specifics point to `legacy/extension/`
- [x] **F.1** Lazy-load `AllLibraryPage` / `MediaLibraryPage` / `LibraryPage` /
  `LibraryUtilityPage`, plus `PublicSite` and `SocialPage` (`src/App.tsx`),
  each behind its own `<Suspense>` boundary (`PublicSiteRoute` /
  `LibraryRoute` helpers)
- [x] Trim eager font payload — Comic Neue (subtitle fallback) now loads
  from `SubtitleOverlay.tsx`; dropped unused Geist Sans 300 (`src/main.tsx`)
- [x] Parallelize the media-library scan — `scanMediaFolderRecursive`
  (`media-library-index.ts`) now runs its BFS folder listings with bounded
  concurrency (4 in flight) instead of one at a time; `scanAllMediaFolders`
  already scanned the 4 top-level categories in parallel. The lobby's
  existing `useLibraryHub()` call warms the Drive folder-listing cache before
  the user opens `/library`
- [x] `React.memo` on `PosterCard` / `LibraryCard`
- [x] Skeleton grids replacing the library loading spinner — new
  `LibraryGridSkeleton` (4:5 cards, shimmer) replaces `LibraryLoadingState` in
  `AllLibraryPage` and is reused as the `Suspense` fallback for all lazy
  library routes in `App.tsx`, so chunk-load and data-load share one surface
- [x] View Transitions on route changes — `useViewTransitionLocation`
  (`App.tsx`) defers rendering the new route into
  `document.startViewTransition()` for a cross-fade (`global.scss`); no-ops
  without API support, on same-pathname navigation, or with
  `prefers-reduced-motion: reduce`

---

## Phase 5 — Realtime + privacy · **not started**
_Last touched: never_

- [ ] Watch parties via WebRTC datachannels (Drive signaling)
- [ ] AES-GCM encrypted libraries for private groups
- [ ] PWA / offline cache for recently watched chunks

---

## Cross-cutting backlog
_Last touched: 2026-06-12_

- [ ] **F.3** Generate real PNG icons from `NyrimaMark` SVG in `make-icons.mjs`
- [ ] **F.6** Replace ad-hoc inline styles with Once UI tokens
- [ ] **F.7** Swap the `AppProviders` shim for `<Providers>` from
      `@once-ui-system/core` once verified to work under Vite
- [ ] **F.8** Timeline thumbnail sprite cache (was P2.3) — generate a sprite
      sheet on first hover, persist in IndexedDB, reuse across sessions
- [ ] **F.10** Smarter MKV header sniff (was P2.5) — SeekHead-following
      Range fetches instead of the fixed 4 MB prelude
- [ ] **F.11** Timeline chapter markers — parse EBML Chapters → render ticks
      on the seek bar with hover tooltips
- [ ] **F.12** Unified Tracks panel — one popover with Subtitles + Audio
      tabs; rolls in with F.9 audio-track work
- [ ] **F.13** Once UI tree-shake / vendor-chunk audit — `once-ui-vendor` is
      the largest non-entry chunk; audit which exports are actually used and
      either tree-shake or replace the unused surface with local stubs
