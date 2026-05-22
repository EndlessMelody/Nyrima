# Troubleshooting

Use exact errors when debugging Nyrima. A Chrome extension load error, a
Google OAuth consent error, a Drive permission failure, and a playback decode
failure have different causes.

## First Checks

1. Run a fresh production build:

   ```bash
   npm run build
   ```

2. Reload the unpacked `dist/` extension from `chrome://extensions`.
3. Open the extension service worker/app console from the extension details
   page when Chrome shows an error.
4. Test one small known-good public or OAuth-readable MP4 before diagnosing a
   difficult MKV file.

## Extension Will Not Load

Check:

- `dist/` exists from a successful build.
- You loaded `dist/`, not the repository root.
- Chrome Developer mode is on.
- The error detail in `chrome://extensions` names the manifest, resource, or
  permission it dislikes.

Rebuild before reloading if source files changed.

## Drive Button Says Reload Tab

The Drive content script can become stale after the extension is reloaded or
updated while a Drive tab remains open. Refresh the Drive tab, then try the
"Open in Nyrima" button again.

## Linux Chrome Or Chromium Checks

If the extension behaves differently on Linux:

- Confirm the browser version and whether it is Google Chrome or another
  Chromium build.
- Confirm Manifest V3 extensions and `chrome.identity` APIs are available in
  that build/profile.
- Rebuild and reload `dist/` on that machine.
- Capture the exact error from `chrome://extensions`, the app console, and the
  background service worker console.
- Test whether the failure happens while loading the extension, connecting
  Drive, listing files, opening a media URL, or remuxing playback.

Those stages narrow the issue faster than "Linux Chrome error" alone.

## OAuth Problems

### OAuth client is invalid or redirect/client ID is rejected

Check:

- The OAuth client is a **Chrome Extension** client.
- Its configured extension ID matches the ID of the unpacked extension you
  loaded from `chrome://extensions`.
- The client ID was pasted into Nyrima UI, not into an obsolete manifest block.
- You rebuilt/reloaded only when needed; reloading a different unpacked
  directory can change the extension ID.

### Access denied during consent

Check:

- The OAuth app is configured for the right audience in Google Cloud.
- If it is in Testing, the Google account used for consent is added as a test
  user.
- The requested scopes in the OAuth consent setup match the current app scope
  set described in [`oauth-setup.md`](./oauth-setup.md).

### Connect Drive works, then expires later

Nyrima intentionally keeps a 24-hour interactive-consent ceiling. Sign in again
when the app reports the signed-in session needs consent again.

## API Key And Drive Access Problems

### Private folder will not open with an API key

That is expected. An API key is not a private Drive grant. Configure OAuth and
connect Drive for private folders.

### Public key path returns quota, 403, or rate-limit errors

Try signed-in OAuth access if the media belongs to the user/test account.
Also confirm:

- Google Drive API is enabled for the Cloud project that owns the key.
- The key value is correct and allowed by its restrictions.
- The target file is actually public enough for key-backed Drive reads.

### Metadata lists but media does not play

The list call and media request can fail differently. Check target permission,
quota/copy/download restrictions, access mode, and the player error for the
specific file.

## Playback Problems

### A file appears but fails quickly

Try a known-good MP4. If that works, the Drive access path is probably alive
and the failing file may be a container/codec/remux-path issue.

### MKV behaves differently from MP4

Nyrima has a supported MKV remux path, but not every MKV codec combination is
guaranteed. Capture:

- Container and track information for the file.
- Whether direct/native playback was attempted.
- The player console error and whether the failure happens on start, seek, or
  audio-track/subtitle changes.

### Subtitles are missing

Check:

- External subtitle files are in the same Drive folder as the video.
- Their basenames start with the video basename.
- The subtitle extension and content are valid.
- For embedded subtitles, the track is a supported embedded text subtitle
  case.

## Sharing And Import Problems

### Follow cannot read a Shared folder

The owner must publish the app-created `Shared/` folder with link-readable
Drive permission. A target video being public is not enough if the share
manifest folder itself is still private.

### Inbox shows a share but Open or Import fails

The share metadata can be readable while the target video/library is private
or copy-restricted. Check Drive target permission and source-owner copy rules.

### Owner does not see a comment

Received comments are aggregated from followed users' comment streams. Confirm
the owner can read and follows the commenter surface that contains the comment
stream Nyrima scans.

## Useful Bug Report Details

Include:

- OS and Chrome/Chromium version.
- Nyrima commit/build source if testing from the repository.
- Whether the extension was loaded unpacked from `dist/`.
- Exact error text and where it appeared.
- Whether API key, OAuth, or both were configured.
- Whether the problem is load, sign-in, Drive listing, playback, sharing, or
  import.
- For playback, the container/codec/subtitle situation and whether a simple
  MP4 test file works.
