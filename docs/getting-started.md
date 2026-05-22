# Getting Started

This guide gets a developer, tester, or early user from a clean checkout to a
first video playing in the current Chrome extension.

## Before You Start

You need:

- Google Chrome or a compatible Chromium-based browser that can load Manifest
  V3 unpacked extensions.
- A Google Drive folder containing video files you are allowed to access.
- Node.js and npm for building from this repository.
- Either a Google Drive API key for public Drive media, a Google OAuth client
  ID for signed-in access, or both.

For private Drive folders and sharing/import features, use OAuth. See
[`oauth-setup.md`](./oauth-setup.md).

## 1. Build The Extension

From the repository root:

```bash
npm install
npm run build
```

The production extension output is written to `dist/`.

## 2. Load It In Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository `dist/` folder.
5. Pin Nyrima from the toolbar if you want quick access.

If Chrome reports a manifest or load error, do not start with OAuth debugging.
Fix the extension load error first and check
[`troubleshooting.md`](./troubleshooting.md).

## 3. Prepare A Drive Root

Choose one Google Drive folder as the Nyrima root. Its direct child folders
become library tiles.

Example:

```text
My Nyrima Root/
  Movie Night/
    Poster.jpg
    Film.mkv
    Film.en.ass
  Example Show/
    Poster.webp
    Season 01/
      Example Show S01E01.mkv
      Example Show S01E01.en.srt
```

The root does not have to be literally named `Nyrima`. A clear name helps
testers and future you recognize it.

## 4. Configure Access

Open Nyrima and use the setup or API settings UI.

### For public Drive files

Paste a Google Drive API key. This is for public files that Drive already
allows a key-backed request to read. It will not unlock a private folder.

### For private Drive files

Paste the Google OAuth client ID created for the loaded extension ID, then
connect Drive through the OAuth prompt. The extension stores the client ID
locally and starts the OAuth flow from the background service worker.

OAuth is also needed for:

- Google profile-backed sharing identity.
- Creating and updating app-owned sharing files.
- Importing shared targets into the user's Drive.
- Changing the app-created `Shared/` folder permission when the user opts in.

## 5. Pair The Root Folder

In Nyrima:

1. Paste or select the Drive folder URL/ID requested by the root setup flow.
2. Let the app validate that the ID resolves to a Drive folder.
3. Open a child library from the lobby.

If the folder is private and the app says access is not configured, complete
the OAuth flow before retrying.

## 6. Play A First Video

Open a library and choose a listed video.

Useful first checks:

- Put a small known-good MP4 in one test folder to prove Drive access and the
  basic player before diagnosing a difficult remux file.
- Use a matching subtitle basename if you want external subtitles on the first
  run, such as `Movie.mkv` and `Movie.en.ass`.
- Add `Poster.jpg` to the library folder if you want to confirm artwork
  discovery.

## 7. Know The Current Controls

Nyrima stores local watch progress and settings in the browser. Removing or
switching browser profiles changes that local state. Re-pairing the Drive root
clears Drive-account-specific caches while keeping user preferences and access
configuration where the app intends to keep them.

Sharing is optional. Do not publish the app-created `Shared/` folder until you
understand what metadata it exposes. Read
[`sharing-guide.md`](./sharing-guide.md) first.

## Next Docs

- Organize folders, posters, and subtitles:
  [`library-guide.md`](./library-guide.md)
- Configure OAuth clients and testers:
  [`oauth-setup.md`](./oauth-setup.md)
- Understand the data flow:
  [`how-nyrima-works.md`](./how-nyrima-works.md)
- Diagnose setup failures:
  [`troubleshooting.md`](./troubleshooting.md)

