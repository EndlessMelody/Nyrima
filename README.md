<div align="center">

<img src="public/icons/app-icon.png" width="120" alt="Nyrima logo" />

# Nyrima

### Personal Video Cinema on Google Drive

*Turn a Drive folder you can access into a private Chrome-extension cinema:
original media bytes, folder-owned artwork, rich subtitles, and no Nyrima
backend.*

[![Built with React](https://img.shields.io/badge/Built%20with-React%2018-61DAFB?logo=react&logoColor=white&style=flat-square)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Bundler-Vite%206-646CFF?logo=vite&logoColor=white&style=flat-square)](https://vite.dev)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-MV3-4285F4?logo=googlechrome&logoColor=white&style=flat-square)](https://developer.chrome.com/docs/extensions)
[![License](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](#license)
[![Tests](https://img.shields.io/badge/Vitest-112%20passing-86EFAC?logo=vitest&logoColor=white&style=flat-square)](#testing)

[Documentation](./docs/index.md) | [How It Works](./docs/how-nyrima-works.md) |
[Architecture](./docs/architecture.md) | [OAuth Setup](./docs/oauth-setup.md) |
[Privacy Policy](./docs/privacy-policy.md) |
[Report an issue](https://github.com/EndlessMelody/Nyrima/issues)

</div>

---

## What Nyrima Is

Nyrima is a Chrome Manifest V3 extension for watching personal video
libraries stored in Google Drive. You pair one Drive folder as the Nyrima
root, and each child folder becomes a library in the lobby. Nyrima finds
videos, sibling subtitles, and artwork files you place in those folders,
then plays the media inside an extension page.

Nyrima is not a hosted video service. The current app has no Nyrima backend,
transcoding server, analytics endpoint, or ad network. Media stays in Drive
and streams from Google Drive APIs to the browser when the user opens it.

## How It Works

1. The extension page lists folders and files from Google Drive using either a
   user-provided Drive API key for public files or a user-provided Google
   OAuth client for signed-in Drive access.
2. The lobby turns child folders under the paired root into libraries with
   poster art from files such as `Poster.jpg` and `Backdrop.webp`.
3. The player prefers browser-native playback. For MKV files that need help,
   Nyrima can Range-fetch Drive bytes, remux supported streams to fragmented
   MP4 through Media Source Extensions, and render ASS subtitles with JASSUB.
4. Settings, watch progress, recent folders, credential values, and caches are
   stored locally in extension storage or IndexedDB. OAuth access tokens are
   mediated by the background service worker.
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
| BYOK OAuth client ID | Private Drive folders, profile-backed sharing, Drive writes, and more reliable signed-in access | The user creates a Google Cloud OAuth client for the extension ID and pastes the client ID into Nyrima. |

The OAuth flow is current BYOK behavior. Nyrima uses
`chrome.identity.launchWebAuthFlow` from the background service worker; it
does not require editing an `oauth2` block into the manifest. Follow
[`docs/oauth-setup.md`](./docs/oauth-setup.md) for development and tester
setup.

## Quick Start

### Build the unpacked extension

```bash
npm install
npm run build
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose `dist/`.
4. Open Nyrima from the toolbar popup or the app tab.

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

```bash
npm install
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite extension development output. |
| `npm run build` | Type-check and write the production extension to `dist/`. |
| `npm run typecheck` | Run the TypeScript check without writing a build. |
| `npm test` | Run the full Vitest suite once. |
| `npm run test:watch` | Keep Vitest running while editing. |
| `npm run check` | Type-check, test, and verify local Markdown links. |
| `npm run docs:check` | Check local links in README, docs, phases, and `.claude` Markdown. |
| `npm run probe:mkv -- "<file.mkv>"` | Inspect MKV tracks, first audio blocks, and Nyrima audio-switch diagnostics. |

Load `dist/` unpacked after a production build when checking extension
permissions, OAuth extension ID behavior, and Chrome loading errors.

### Release scripts

| Command | Purpose |
| --- | --- |
| `npm run inspect:manifest` | Print the generated manifest entry points, permissions, hosts, and icons from `dist/`. |
| `npm run verify:extension` | Validate the generated manifest and required extension files in `dist/`. |
| `npm run release:check` | Build, test, check docs links, and verify generated extension output. |
| `npm run package` | Build, verify, and write `dist-zip/nyrima-<version>.zip` with a SHA-256 report. |
| `npm run package:dist` | Package an already-built and verified `dist/` tree. |
| `npm run zip` | Compatibility alias for packaging the current `dist/` tree as a real ZIP. |

## Tech Stack

| Layer | Current stack |
| --- | --- |
| Extension build | Chrome Manifest V3, Vite 6, `@crxjs/vite-plugin` |
| UI runtime | React 18, TypeScript 5.6, hash routing with React Router |
| UI system | Once UI token CSS and React contexts, Nyrima Sass surfaces, custom font assets |
| Local state | Zustand, `chrome.storage`, IndexedDB caches |
| Drive/media | Google Drive REST APIs, Media Source Extensions, EBML/MKV services, Mediabunny AC-3 support |
| Subtitles | JASSUB/libass plus Nyrima subtitle parsing/extraction |
| Verification | Vitest, TypeScript build checks, Chrome unpacked-extension checks |

## Public Promo Site

Nyrima also has a separate public promo website. That site is the public
distribution and information surface for the package upload/download path,
installation help, product Q&A/FAQ, privacy policy, terms, support/contact,
and reviewer/store-facing links.

The promo site is separate from the extension runtime. Public copy there should
match the currently packaged extension and the policy/docs in this repository.

## Testing

```bash
npm test
```

The current Vitest suite covers title parsing, subtitles, sharing stores,
Drive import helpers, EBML/remux logic, AC-3 playback helpers, fragmented MP4
generation, MSE controller behavior, and the Node release-script toolkit.
Browser extension integration, Google OAuth consent, real Drive permissions,
and media playback against real files still need manual verification in Chrome.

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
| [`docs/permissions-and-data-use.md`](./docs/permissions-and-data-use.md) | Permission, scope, endpoint, and storage audit. |
| [`docs/privacy-policy.md`](./docs/privacy-policy.md) | Privacy policy for the current extension. |
| [`docs/terms-of-use.md`](./docs/terms-of-use.md) | Terms for using the current extension. |

Engineering phase status stays in [`PHASES.md`](./PHASES.md).

## Contributor Project Memory

Future contributor and agent guidance lives in
[.claude/README.md](./.claude/README.md): workflow, artifacts, system
boundaries, reusable patterns, Nyrima styling, and Once UI integration notes.
It complements the deploy docs above; it does not replace them.

## Security And Privacy Summary

- Media bytes flow from Google Drive to the browser. Nyrima does not upload
  media to a Nyrima server.
- Nyrima does not read browser cookies from Drive or other websites.
- OAuth tokens are handled through the background service worker and are not
  sent to the optional GitHub raw directory endpoint.
- Publishing a `Shared/` folder makes share metadata readable by anyone with
  that folder link. It does not automatically grant access to the underlying
  target file or library folder.
- The detailed permission and data-use map is in
  [`docs/permissions-and-data-use.md`](./docs/permissions-and-data-use.md).

## License

MIT.
