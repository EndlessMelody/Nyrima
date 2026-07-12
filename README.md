<div align="center">

<img src="public/icons/app-icon.png" width="120" alt="Nyrima logo" />

# Nyrima

### Personal Video Cinema on Google Drive

*Turn a Drive folder you can access into a private web cinema: original media
bytes, folder-owned artwork, rich subtitles, and no Nyrima backend.*

[![Built with React](https://img.shields.io/badge/Built%20with-React%2018-61DAFB?logo=react&logoColor=white&style=flat-square)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Bundler-Vite%206-646CFF?logo=vite&logoColor=white&style=flat-square)](https://vite.dev)
[![Web App](https://img.shields.io/badge/Platform-Web%20App-4285F4?logo=googlechrome&logoColor=white&style=flat-square)](#quick-start)
[![License](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](#license)
[![Tests](https://img.shields.io/badge/Vitest-303%20passing-86EFAC?logo=vitest&logoColor=white&style=flat-square)](#testing)

[Documentation](./docs/index.md) | [How It Works](./docs/how-nyrima-works.md) |
[Architecture](./docs/architecture.md) | [OAuth Setup](./docs/oauth-setup.md) |
[Privacy Policy](./docs/privacy-policy.md) |
[Report an issue](https://github.com/EndlessMelody/Nyrima/issues)

</div>

---

## What Nyrima Is

Nyrima is a web app for watching personal video libraries stored in Google
Drive. You pair one Drive folder as the Nyrima root, and each child folder
becomes a library in the lobby. Nyrima finds videos, sibling subtitles, and
artwork files you place in those folders, then plays the media in the
browser. Movies, Light Novels, and Music can also be played directly from a
local folder via the File System Access API, alongside Drive.

Nyrima is not a hosted video service. The app has no Nyrima media backend,
transcoding server, analytics endpoint, or ad network. Media stays in Drive
(or on disk) and streams to the browser when the user opens it. A small
Supabase backend exists, but it is **social-only** — friend connections and
folder comments — and never sees or stores media or per-user library data.

Nyrima also has a public marketing site, account sign-in, and a guest mode
("Try Nyrima") that lets you explore playback without creating an account.

> Nyrima started life as a Chrome extension. That implementation is retired
> and preserved in [`legacy/extension/`](./legacy/extension/) for reference;
> it is not part of the current build.

## How It Works

1. The web app lists folders and files from Google Drive using either a
   user-provided Drive API key for public files or a Google OAuth (PKCE)
   sign-in for private Drive access.
2. The lobby turns child folders under the paired root into libraries with
   poster art from files such as `Poster.jpg` and `Backdrop.webp`.
3. The player prefers browser-native playback. For MKV files that need help,
   Nyrima can Range-fetch Drive (or local) bytes, remux supported streams to
   fragmented MP4 through Media Source Extensions, and render ASS subtitles
   with JASSUB.
4. Settings, watch progress, recent folders, credential values, and caches are
   stored locally (`localStorage`/IndexedDB via `src/platform/chrome-shim.ts`,
   a web-backed shim of the old extension storage API).
5. Sharing is optional. When the user publishes a Drive-created `Shared/`
   folder, followers can read share metadata from Drive, comment through their
   own Drive comment stream, and import accessible targets into their own
   Drive with Drive server-side copy operations.

For the plain-language version of the full data flow, see
[`docs/how-nyrima-works.md`](./docs/how-nyrima-works.md). For implementation
boundaries and storage details, see
[`docs/architecture.md`](./docs/architecture.md).

## Current Features

### Library

- Pair one Google Drive root folder; each direct child folder becomes a
  library tile.
- Browse a cinematic lobby with recent libraries, pinned items, Continue
  Watching, stats, library search, filters, sort order, grouped seasons, grid
  mode, and list mode.
- Use folder-owned artwork: `Poster.{jpg,png,webp}` and optional
  `Backdrop.*` inside Drive folders. Nyrima does not fetch poster metadata
  from a third-party media database.
- Parse episode-style filenames and season folders for show grouping while
  still supporting movie folders.

### Player

- Play Drive media from the extension player with resume state, next-up
  autoplay, theatre mode, shortcuts, subtitle settings, audio-track controls,
  and a custom HUD.
- Prefer direct browser playback, then use the current MKV remux path for
  supported MKV video/audio combinations that need MSE.
- Support supported external sibling subtitles including SRT, VTT, ASS, and
  SSA, plus supported embedded MKV text subtitles.
- Render ASS/SSA typesetting through JASSUB/libass where the current subtitle
  path supports it.

### Sharing

- Create an app-owned Drive `Shared/` folder with `index.json` share metadata
  and `comments.jsonl` outbound comments.
- Publish that folder only when the user opts into "Anyone with the link"
  read access.
- Follow another user's published `Shared/` folder URL and sync entries into
  an Inbox.
- Import accessible shared videos or folders into
  `Nyrima/Imports/<share title - timestamp>/` with Drive copy APIs.

## Access Modes

Nyrima has two current Google Drive access modes:

| Mode | Best for | Notes |
| --- | --- | --- |
| Drive API key | Public "Anyone with the link" Drive media | The user creates and stores the key locally. Public Drive quotas and file privacy still apply. |
| Google OAuth (PKCE) | Private Drive folders, profile-backed sharing, Drive writes, and more reliable signed-in access | Browser-based OAuth authorization-code-with-PKCE flow; no extension client ID needed. |

Follow [`docs/oauth-setup.md`](./docs/oauth-setup.md) for development and
tester setup of the Google Cloud OAuth client used by the web flow.

## Quick Start

```bash
npm install
npm run dev
```

Open the printed local URL in a browser. For a production build:

```bash
npm run build
npm run preview
```

### Prepare a first library

1. Create or choose a Google Drive folder to be the Nyrima root.
2. Put one child folder inside it for a movie or show.
3. Put videos inside that child folder.
4. Optionally add `Poster.jpg`, `Backdrop.webp`, and subtitle files with a
   matching basename such as `Episode 01.mkv` and `Episode 01.en.ass`.
5. Pair the root folder in Nyrima and configure access.

For the full first-run path, see
[`docs/getting-started.md`](./docs/getting-started.md).

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type-check and write the production web app to `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run typecheck` | Run the TypeScript check without writing a build. |
| `npm test` | Run the full Vitest suite once. |
| `npm run test:watch` | Keep Vitest running while editing. |
| `npm run check` | Type-check, test, and verify local Markdown links. |
| `npm run docs:check` | Check local links in README, docs, phases, and `.claude` Markdown. |
| `npm run probe:mkv -- "<file.mkv>"` | Inspect MKV tracks, first audio blocks, and Nyrima audio-switch diagnostics. |

## Tech Stack

| Layer | Current stack |
| --- | --- |
| Build | Vite 6, React 18, TypeScript 5.6 |
| UI runtime | React Router (path-based routing), Zustand |
| UI system | Once UI token CSS and React contexts, Nyrima Sass surfaces, custom font assets |
| Local state | Zustand stores, `localStorage`/IndexedDB via `src/platform/chrome-shim.ts`, IndexedDB caches |
| Accounts | Supabase (social-only — friends + folder comments; no media or per-user library data) |
| Drive/media | Google Drive REST APIs (OAuth PKCE), Media Source Extensions, EBML/MKV services, Mediabunny AC-3 support |
| Local files | File System Access API (Movies / Light Novel / Music) |
| Subtitles | JASSUB/libass plus Nyrima subtitle parsing/extraction |
| Verification | Vitest, TypeScript build checks |

## Public Marketing Site

The public marketing site (`/`, `/login`, `/terms`, `/privacy`, `/faq`,
`/contact`, `/guide`) is part of this same app — see
[`src/landing/`](./src/landing/). It covers product info, FAQ, privacy
policy, terms, and account sign-in/sign-up, and routes into the authenticated
app at `/app` after login (or via guest mode).

## Testing

```bash
npm test
```

The current Vitest suite (303 tests across 48 files) covers title parsing,
subtitles, sharing stores, Drive import helpers, EBML/remux logic, AC-3
playback helpers, fragmented MP4 generation, MSE controller behavior, local
file playback, and the music/reader services. Google OAuth consent, real
Drive permissions, and media playback against real files still need manual
verification in a browser.

## Documentation

Start at [`docs/index.md`](./docs/index.md).

| Document | Purpose |
| --- | --- |
| [`docs/how-nyrima-works.md`](./docs/how-nyrima-works.md) | What the app is and how the current flows work. |
| [`docs/getting-started.md`](./docs/getting-started.md) | Install, pair Drive, configure access, and play the first file. |
| [`docs/library-guide.md`](./docs/library-guide.md) | Folder layout, artwork, subtitles, and player behavior. |
| [`docs/sharing-guide.md`](./docs/sharing-guide.md) | Current Drive-only sharing model and privacy choices. |
| [`docs/troubleshooting.md`](./docs/troubleshooting.md) | Setup, Chrome, OAuth, Drive, playback, and sharing diagnosis. |
| [`docs/architecture.md`](./docs/architecture.md) | Detailed developer architecture and trust boundaries. |
| [`docs/oauth-setup.md`](./docs/oauth-setup.md) | Google Cloud OAuth setup for developers and testers. |
| [`docs/deployment.md`](./docs/deployment.md) | Set up the Supabase social database and deploy the web app to Vercel. |
| [`docs/permissions-and-data-use.md`](./docs/permissions-and-data-use.md) | Permission, scope, endpoint, and storage audit. |
| [`docs/privacy-policy.md`](./docs/privacy-policy.md) | Privacy policy for the web app. |
| [`docs/terms-of-use.md`](./docs/terms-of-use.md) | Terms for using the web app. |

Engineering phase status stays in [`PHASES.md`](./PHASES.md).

## Contributor Project Memory

Future contributor and agent guidance lives in
[.claude/README.md](./.claude/README.md): workflow, artifacts, system
boundaries, reusable patterns, Nyrima styling, and Once UI integration notes.
It complements the deploy docs above; it does not replace them.

## Security And Privacy Summary

- Media bytes flow from Google Drive (or local disk) to the browser. Nyrima
  does not upload media to a Nyrima server.
- Nyrima does not read browser cookies from Drive or other websites.
- OAuth tokens are handled by the web PKCE flow in `src/platform/` and are not
  sent to the optional GitHub raw directory endpoint.
- Publishing a `Shared/` folder makes share metadata readable by anyone with
  that folder link. It does not automatically grant access to the underlying
  target file or library folder.
- The detailed permission and data-use map is in
  [`docs/permissions-and-data-use.md`](./docs/permissions-and-data-use.md).

## License

MIT.
