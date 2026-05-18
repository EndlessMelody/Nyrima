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
- [x] Replace placeholder PNG icons with the SVG-derived export
  - `scripts/make-icons.mjs` resamples `public/icons/Icon.png` via `sharp` into
    16/32/48/128 PNGs. The SVG path is kept as fallback documentation.
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

## Phase 3 — Library polish · **shipped**
_Last touched: 2026-05-16_

- [x] **P3.1** In-library search + sort (name / modified / size / duration)
  - Added search, watch-state filters, persisted sort, and view mode controls.
- [x] **P3.2** Season / episode grouping using the existing title parser
  - Added grouped library sections and a grouped player episode sidebar.
- [x] **P3.3** MAL/Jikan integration for posters + series metadata
  - Replaced TMDB on 2026-05-16. No API key required; cached 30 d / miss 7 d.
  - Folder-aware resolver: episodic filenames like `[GS]01.mkv` query the
    folder name instead of `"01"`, so a series of 12 episodes resolves to one
    shared MAL hit.
- [x] **P3.4** Virtualised library grid via `content-visibility: auto`
  - Browser-native virtualisation on `.ny-poster-card`, `.ny-video-row`, and
    `.ny-library-card`. Off-screen items skip layout + paint while
    `contain-intrinsic-size` reserves a placeholder so the scrollbar stays
    steady. Cheaper than react-virtual at this scale and dep-free.
- [x] **P3.5** Library-card upgrades
  - Persisted library stats on `RecentFolder` (videoCount / runtimeMs /
    watchedCount / coverPosterUrl) written by `LibraryPage` on visit. Lobby
    cards render the MAL cover as a backdrop, watched-ratio pill, and a
    `"12 eps · 4h 36m"` meta line. Empty stats fall back to the legacy
    `"N items"` until the user first visits the library.
  - Lobby gets a thin instrument-tape stats strip aggregating libraries /
    episodes / total runtime / watched count across the collection.
- [→] **P3.6** Multi-folder libraries — _deferred_ (data-model rewrite)

## Phase 4 — Sharing layer · **in progress**
_Last touched: 2026-05-18_

Drive-only social model. Each user gets a `Shared/` subfolder set to
"Anyone with the link → Viewer". Inside: `index.json` manifest,
`entries/{id}.json` per share, `comments/{shareId}.jsonl` for the user's
own comments on other users' shares. Comments are decentralized — each
commenter writes to their own folder; the share owner reconstructs threads
by scanning followers' Shared folders for matching `{shareId}.jsonl`.
This sidesteps Drive's binary view/edit permission model.

- [x] **P4.0** Foundation — schema + Shared/ bootstrap + Drive write helpers
  - Types: `ShareEntry`, `ShareIndex`, `ShareIndexEntry`, `ShareComment`,
    `ShareAuthor`, `ShareTarget`, `FollowedUser`, `ShareProfile` in
    `@shared/types`.
  - Constants: `SHARED_FOLDER_NAME` / `SHARED_ENTRIES_SUBFOLDER` /
    `SHARED_COMMENTS_SUBFOLDER` / `SHARED_INDEX_FILENAME`, caps
    (`MAX_SHARE_INDEX_ENTRIES`, comment + caption char limits),
    `SHARE_HANDLE_PATTERN`. Storage keys: `SHARE_PROFILE`,
    `SHARED_FOLDER_ID`, `SHARED_SUBFOLDER_IDS`, `FOLLOWED_USERS`.
  - Drive write helpers added to `drive-api.ts`: `createFolder`,
    `findChildByName`, `findOrCreateChildFolder`, `uploadJsonFile`,
    `updateJsonFile`, `downloadJsonFile`. All route through the existing
    `authedFetch` queue/retry/cooldown pipeline.
  - Sharing service module at `src/app/services/sharing/`:
    `share-folder.ts` (idempotent bootstrap of Shared/, entries/,
    comments/), `index-store.ts` (read/write `index.json`),
    `entry-store.ts` (read/write entry JSONs + id generation),
    `share-profile.ts` (handle picker + author projection).
  - OAuth: scope set expanded to include `drive.file` (narrowest write
    scope — only files the app creates). Existing users need to
    disconnect + reconnect once to pick up the new scope; their cached
    token lacks `drive.file` and writes will 403 until then.
  - Account-reset: drops `SHARED_FOLDER_ID` + `SHARED_SUBFOLDER_IDS` on
    root re-pair. Preserves `SHARE_PROFILE` + `FOLLOWED_USERS` (same
    person, just different Drive).
- [x] **P4.1** "Share this video" UX — handle picker on first use, share
      composer, write entry + bump index, surface "make Shared/ public"
      confirmation
  - `SharingHost` (mounted at App root) hydrates `ShareProfile` from
    chrome.storage and listens for the topbar's `nyrima:topbar` CustomEvent
    (scope: "share"). Decouples the topbar from the sharing store so
    Phase 4.2 surfaces can hang off the same event channel.
  - `HandlePickerDialog` — first-use onboarding. Prefills handle / display
    name / avatar from the connected Google profile (Drive About API),
    enforces `SHARE_HANDLE_PATTERN`, persists via `setShareProfile`.
  - `ShareComposerDialog` — infers target from the current route
    (`/play/x/y` → video, `/library/x` → library), resolves title + poster
    from cached metadata, accepts an optional caption (capped at
    `MAX_SHARE_CAPTION_CHARS = 600`), and offers a "make Shared/ public"
    checkbox the first time (gated on probed permission state). Success
    state surfaces the Drive folder URL with a copy-to-clipboard button.
  - `useSharingStore.submitShare()` is the integration seam: ensureFolders
    → readShareIndex → writeShareEntry → prependIndexEntry → writeShareIndex
    → (optional) publishSharedFolder, all in one transaction. Errors
    surface via `lastError` so the composer can inline-render them.
  - Drive permissions API helpers (`getFolderIsPublic`, `setFolderPublic`,
    `setFolderPrivate`) added to drive-api.ts. `share-permissions.ts`
    wraps them with a chrome.storage cache so the composer reads the
    public state without burning a roundtrip per open.
- [x] **P4.UI** Social hub — `/social` route with five tabs (Inbox, My
      Shares, People, Activity, Privacy). Nyaa-flavored dense table rows
      filtered through the Atelier tokens; topbar collapses the old
      Search/Friends/Inbox stubs into a single Social link with an
      unread-count badge fed by `useSocialStore`. Share stays in chrome
      because the composer is page-contextual.
  - New: `pages/SocialPage`, `pages/SocialPage.scss`, `stores/social-store`,
    `components/social/{SocialToolbar,SocialTabs,InboxList,MyShares,
    PeopleSearch,ActivityFeed,PrivacyPanel}`.
  - Drive: added `deleteFile` to `drive-api.ts` + `deleteShareEntry` to the
    sharing barrel so unshare can prune index + entry file atomically.
  - MyShares + PrivacyPanel are fully wired today (own index, public toggle).
    Inbox and People are wired to the social-store follow/pull pipeline but
    won't surface third-party data until **P4.2** ships discovery + sync UX
    polish. Activity is a placeholder pending **P4.3**.
- [~] **P4.2** Follow + pull — paste a friend's Shared/ URL, scan their
      index, populate the Inbox surface
  - Core follow/pull/unfollow/mark-read landed inside the Social hub
    alongside **P4.UI**: `useSocialStore.follow()` parses the URL, pulls
    their `index.json`, dedupes, and computes per-follow unread counts.
    Remaining 4.2 scope: error-state polish, suggested follows, "view
    their shelf" deep-link to a read-only library view in Nyrima (today it
    opens the Drive folder in a new tab).
- [ ] **P4.3** Comments — append-only JSONL writer + owner aggregator
      that reads followers' `Shared/comments/`. Renders in the Social
      hub's Activity tab.
- [ ] **P4.4** Bootstrap index — public opt-in directory of discoverable
      users. Opt-in toggle lives in the Privacy tab; discovered users feed
      a "Suggested" rail in the People tab.

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
- [x] **F.4** Vitest setup + parser unit tests
  - 26 tests covering `parseTitle`, `normalizeMovieTitle`, `isEpisodicFilename`,
    `isSeasonFolderName`, SRT / VTT / ASS converters, `forceCenterDialogueInAss`.
  - Surfaced a real bug: years inside `(parens)` were stripped before the
    year regex ran. Fixed.
  - Scripts: `npm test` (single run) / `npm run test:watch`.
- [x] **F.5** De-duplicate the two title parsers
  - Removed `src/app/services/title-normalizer.ts`. `normalizeMovieTitle`
    and `isEpisodicFilename` now live alongside `parseTitle` in
    `@shared/title-parser`. All call sites updated; `buildDisplayTitle`
    callers switched to `parseTitle`.
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
