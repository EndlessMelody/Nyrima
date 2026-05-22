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
- [x] Replace placeholder PNG icons with the managed extension icon export
  - `scripts/make-icons.mjs` resamples `public/icons/extension-icon.png` via `sharp` into
    16/32/48/128 PNGs for the Chrome extension manifest and toolbar action.
- [x] End-to-end smoke test playbook for the sharing layer
  - `docs/sharing-smoke-test.md` covers the fast loopback (own `Shared/` →
    self-follow) and a two-account variant. Used to validate P4.1–P4.5
    before each release tag.

## Phase 2 — Real player · **shipped**
_Last touched: 2026-05-22_

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
- [x] **P2.4** Audio-track selector for MKVs — _shipped 2026-05-20_
  - Split video + audio SourceBuffers on one MediaSource. New
    `controller.switchAudio(trackNumber)` re-parses the cached Tracks
    element, runs `changeType` on the audio SourceBuffer, appends the
    new audio init segment, and back-fills from `currentTime − 0.5 s`
    without touching the video pipe — picture never blinks during
    dub swap. Surfaced via `handlePickAudioTrackNumber` in PlayerPage
    with the route-reload-with-`?audio=N` path retained as fallback
    for native MKV mode. Backlog F.9 closed.
  - 2026-05-22 deploy pass adds the external AC-3 lane used when Chromium
    rejects a muxed AC-3 combo: AC-3 frames decode through the WASM fallback,
    backward external-audio seeks recover against an indexed video window,
    and the audio picker marks the experimental AC-3 route explicitly.
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
- [x] Keyboard-accessible pointer scrubbing that previews while dragging and
      commits the seek on release, so out-of-buffer jumps have one settled
      target instead of a stream of half-seeks
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

## Phase 4 — Sharing layer · **shipped**
_Last touched: 2026-05-20_

Drive-only social model. Each user gets a `Shared/` subfolder set to
"Anyone with the link → Viewer". Inside (flat, no subfolders):
`index.json` (schema v=2 inlines the full share-entry payloads — one
Drive read yields the whole feed for a follower) and `comments.jsonl`
(single JSONL stream of every comment the user has ever posted, each
line tagged with `sharedFolderId` + `shareId` so the owner can filter to
their own shares). Comments are decentralized — each commenter writes
to their own folder; the share owner reconstructs threads by reading
followers' single `comments.jsonl` files and filtering. This sidesteps
Drive's binary view/edit permission model.

- [x] **P4.0** Foundation — schema + Shared/ bootstrap + Drive write helpers
  - Types: `ShareEntry`, `ShareIndex`, `ShareComment`,
    `ShareAuthor`, `ShareTarget`, `FollowedUser`, `ShareProfile` in
    `@shared/types`.
  - Constants: `SHARED_FOLDER_NAME` / `SHARED_INDEX_FILENAME` /
    `SHARED_COMMENTS_FILENAME`, caps (`MAX_SHARE_INDEX_ENTRIES`, comment +
    caption char limits), `SHARE_HANDLE_PATTERN`. Storage keys:
    `SHARE_PROFILE`, `SHARED_FOLDER_ID`, `FOLLOWED_USERS`
    (`SHARED_SUBFOLDER_IDS` remains only as a legacy cache key to clear).
  - Drive write helpers added to `drive-api.ts`: `createFolder`,
    `findChildByName`, `findOrCreateChildFolder`, `uploadJsonFile`,
    `updateJsonFile`, `downloadJsonFile`. All route through the existing
    `authedFetch` queue/retry/cooldown pipeline.
  - Sharing service module at `src/app/services/sharing/`:
    `share-folder.ts` (idempotent bootstrap of flat `Shared/`),
    `index-store.ts` (read/write inline `index.json` + id generation),
    `comments-store.ts` (flat `comments.jsonl` append/read/aggregate),
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
    → readShareIndex → prependIndexEntry → writeShareIndex → (optional)
    publishSharedFolder, all in one transaction. Errors surface via
    `lastError` so the composer can inline-render them. Manifest mutations
    are locally queued per `Shared/` folder to avoid same-context overwrite
    races.
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
  - Unshare now prunes the inline entry from `Shared/index.json`; followers
    stop seeing it on their next sync.
  - MyShares + PrivacyPanel are fully wired (own index, public toggle). Inbox
    and People read through the social-store follow/pull pipeline. Activity
    renders the P4.3 comment strands.
- [x] **P4.2** Follow + pull — paste a friend's Shared/ URL, scan their
      index, populate the Inbox surface — _completed 2026-05-19_
  - Core follow/pull/unfollow/mark-read landed inside the Social hub
    alongside **P4.UI**: `useSocialStore.follow()` parses the URL, pulls
    their `index.json`, dedupes, and computes per-follow unread counts.
  - **View their shelf**: new `/social/shelf/:folderId` route + read-only
    `FollowedShelf` view. Owner header (avatar / handle / share count /
    last pull), filter input, table of their inlined entries with the
    same Open / Comment / Copy row affordances as the inbox. The People
    tab's "View shelf" now stays in Nyrima instead of bouncing to Drive.
  - **Error-state polish**: errored follow cards render an inline pill
    with the failure message + a per-card Retry button (calls `syncInbox`
    so all follows refresh together — bounded-concurrency already gates
    the pull). The Drive-folder link survives as a secondary action.
  - Last-good inbox rows are cached in chrome.storage, so `/social` can
    render the previous feed immediately and keep stale rows visible when
    a single followed folder fails to sync.
  - Suggested follows now arrive through the P4.4 bootstrap directory.
- [x] **P4.2a** Inline-entries refactor (schema v=2) — _2026-05-19_
  - `ShareIndex.entries` now carries full `ShareEntry` payloads instead
    of slim `ShareIndexEntry` pointers; `Shared/entries/{id}.json` is
    gone. One Drive read = full feed per follower. `readShareIndex`
    returns null for legacy v=1 manifests (treated as "fresh user" —
    no migration code; pre-release, OK to break).
  - Open/Copy actions now point at the *target* Drive URL (the video file
    or library folder) instead of the manifest file. The user lands on
    the thing they want, not its metadata.
  - **ShelfLinkCard** mounted above the tab strip on `/social`: avatar +
    handle + Drive URL with Copy/Open + clickable Public/Private chip.
    Auto-ensures the `Shared/` folder once a profile exists so the URL
    is available without sharing first.
- [x] **P4.3** Comments — append + aggregate, rendered on Activity tab —
      _2026-05-19_
  - Single flat `Shared/comments.jsonl` per user (no per-shareId files,
    no `comments/` subfolder). Each line carries the share owner's
    `sharedFolderId` + the target `shareId`, so the aggregator filters
    one stream per follower instead of fanning out to N files.
  - `comments-store.ts` ships `appendComment` (read-modify-write JSONL),
    `readComments` (parse + skip malformed lines), and
    `aggregateComments` (bounded-concurrency pull across followers).
    Comment appends are locally queued per writer `Shared/` folder to avoid
    dropping lines when two comment dialogs submit close together.
  - `useSocialStore` gains `receivedComments` (bucketed by `shareId`,
    only counts comments from people I follow targeting my own folder),
    `myComments` (own stream), and the actions `postComment` /
    `loadMyComments` / `loadReceivedComments`.
  - UI: `CommentComposerDialog` opens from a "Comment" button on every
    inbox row; `ActivityFeed` shows Received vs Sent strands with chip
    switcher + refresh control, grouped by share. Tab badge counts
    received-comment volume.
  - Discovery caveat: only people the owner follows can surface here —
    Drive's flat permission model doesn't give us "this stranger commented
    on you" without an owner-side list of folders to scan.
- [x] **P4.4** Bootstrap index — public opt-in directory of discoverable
      users — _2026-05-19_
  - **Source**: single JSON array hosted at
    `raw.githubusercontent.com/nyrima/directory/main/users.json` (URL
    constants in `@shared/constants`). Cached in chrome.storage on a 24h
    TTL; 404s degrade gracefully to "empty directory" so the rail still
    renders before the registry repo is published.
  - **Schema**: `DirectoryEntry` (v=1) carries handle, name, folderId,
    avatarUrl, optional bio + tags + addedAt. Sanitized on read to drop
    malformed entries silently.
  - **Service**: `src/app/services/sharing/directory.ts` —
    `fetchDirectory`, `getCachedDirectory`, `clearDirectoryCache`. Pulls
    once per session by default; force-refresh available from the
    Discover rail's Refresh button.
  - **Discover rail**: People tab's `DiscoverRail` filters directory
    entries down to people the user isn't already following, surfaces
    cards with avatar / bio / tag chips / "NEW" pill (14-day window),
    one-click Follow that reuses the existing paste-by-URL path with a
    synthetic Drive URL.
  - **Opt-in**: `RequestListingDialog` (mounted from PrivacyPanel)
    pre-fills a `DirectoryEntry` JSON from the user's profile + folder
    id, lets them tweak bio + tags, and produces both a copy-paste
    snippet and a one-click GitHub-issue link (title + body pre-filled
    via URL params). Manual PR-style moderation is the spam filter.
    Gated on having a profile AND the Shared/ folder being public.
- [x] **P4.5** Drive-to-Drive import — _2026-05-20_
  - Inbox and followed-shelf rows now have **Import**. It creates
    `Nyrima/Imports/<share title - timestamp>/` and copies the shared
    target into the recipient's own Drive using Drive's server-side
    `files.copy` endpoint.
  - Video imports copy the source video plus same-folder companions:
    `Poster.{jpg,jpeg,png,webp}` and subtitles whose basename matches the
    video. Library imports recursively mirror folder structure and files.
  - Import is Drive-native, not BitTorrent/P2P: no browser download/re-upload,
    but it still respects source access and owner copy/download restrictions.
    Partial library failures are collected so copy-blocked files do not abort
    the entire folder.

## Pre-launch hardening · **shipped**
_Last touched: 2026-05-22_

Cleanup pass run on the road to v0.1.0. No new product surface — this
section is the evidence that the extension is shippable today.

- [x] **L.1** Version bump: `0.0.1` → `0.1.0` (manifest follows
  automatically via `pkg.version`).
- [x] **L.2** `.gitignore` covers local-only scratch (`example/` test
  MKVs, `.playwright-mcp/` debug logs, `NOTES_*.txt`, `.mcp.json`).
  Nothing personal can be accidentally committed.
- [x] **L.3** Security pass:
  - `npm audit --production`: 0 vulnerabilities.
  - OAuth tokens never logged; the only string-templated `Bearer ${…}`
    sites are the DNR rule and `authedFetch` Authorization header.
  - `innerHTML` used once (the content-script FAB), bound to a constant
    label — no user input reaches it.
  - CSP locked down: `script-src 'self' 'wasm-unsafe-eval'`, no inline.
    `connect-src` / `media-src` / `img-src` enumerate only Drive,
    `googleapis.com`, `raw.githubusercontent.com`,
    `avatars.githubusercontent.com`, `googleusercontent.com`.
  - DNR auth rule scoped to extension-initiated requests against
    `googleapis.com/drive/v3/files/` (`initiatorDomains: [runtime.id]`).
  - BYOK OAuth + 24 h interactive consent ceiling caps stolen-device
    blast radius (`NEEDS_RECONSENT` resurfaces the consent screen).
  - Public `Shared/index.json` reads validate owner, timestamps, Drive IDs,
    optional image URL hosts, and entry shape before the Social store trusts a
    followed user's Drive manifest.
- [x] **L.4** Keyboard shortcut audit: cheatsheet matches the bound
  handler 1:1 (Playback, Audio & View, Subtitles, Playlist groups). No
  conflicts with browser-default chords; modifier keys deliberately
  bypass the digit-jump handler so `Ctrl+0..9` still works.
- [x] **L.5** Docs refresh: README / architecture / plan / PHASES all
  reflect the shipped Phase 4 + folder-poster pivot. Stale references
  to MAL/Jikan and `METADATA_CACHE.v2` removed.
- [x] **L.6** TSC + Vitest green: `tsc --noEmit` exits 0, 107 tests
  pass across 14 files (parser, subtitle converters, MKV remux, EBML,
  sharing services).

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
- [x] **F.9** MKV audio-track selector (was P2.4) — _shipped 2026-05-20_
  - Closed by the P2.4 rework: split SourceBuffers + `switchAudio()`
    + cluster-indexed catch-up fetch. See PHASES P2.4 for the gotchas
    list (hev1, trun field order, decode-order sort, lacing, dfLa).
- [ ] **F.10** Smarter MKV header sniff (was P2.5) — SeekHead-following
      Range fetches instead of the fixed 4 MB prelude
- [ ] **F.11** Timeline chapter markers — parse EBML Chapters → render ticks
      on the seek bar with hover tooltips
- [ ] **F.12** Unified Tracks panel — one popover with Subtitles + Audio
      tabs; rolls in with F.9 audio-track work
