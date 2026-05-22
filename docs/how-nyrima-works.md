# How Nyrima Works

Nyrima turns a Google Drive folder the user can access into a personal video
library inside Chrome. It is a Chrome extension, not a hosted streaming
website. The current app does not upload media to a Nyrima backend, transcode
files on a Nyrima server, or keep a cloud copy of a user's library outside
Google Drive.

## The Short Version

```text
Google Drive root folder
        |
        | files, folders, posters, subtitles, media bytes
        v
Nyrima Chrome extension page
        |
        | player state, settings, watch progress, caches
        v
Local extension storage in the browser
```

The user chooses a Drive folder as the Nyrima root. Direct child folders become
libraries. Nyrima lists those folders and files through Google Drive APIs,
builds a lobby, and opens videos in its own player page.

## What Lives Where

| Data | Where it lives today | Why |
| --- | --- | --- |
| Videos and folders | The user's Google Drive or a Drive folder they can access | Drive is the media source. |
| Posters and backdrops | Drive files placed in library folders | Artwork belongs to the library owner. |
| External subtitle files | Drive sibling files beside the video | Nyrima can match and load them during playback. |
| Settings, recent folders, watch progress, follows, share caches | Local extension storage | The browser needs quick local state. |
| Drive metadata and media/subtitle cache data | Local IndexedDB cache where used | Repeated Drive work should be lighter. |
| OAuth access token cache | Extension service-worker memory and Chrome session storage | Signed-in Drive calls need a short-lived token. |
| Shares and comments the user writes | App-created files under the user's Drive `Shared/` folder | Sharing stays Drive-native. |
| Imported shared content | The user's Drive under `Nyrima/Imports/` | Drive performs the copy into the recipient's account. |

## Drive Access

Nyrima can be configured in two ways.

### Public-file access with a Drive API key

A Google Drive API key is useful for public files that are already readable
with "Anyone with the link" style access. The user creates the API key in
their own Google Cloud project and stores it locally in Nyrima.

An API key does not make a private Drive folder readable. Google Drive quotas
and public-file restrictions still apply.

### Signed-in access with a BYOK OAuth client

For private folders and Drive write features, the user creates a Google Cloud
OAuth client for their extension ID and pastes that client ID into Nyrima.
When the user clicks the sign-in flow, the background service worker starts
Google OAuth with `chrome.identity.launchWebAuthFlow`.

The current OAuth scope set is:

- Drive read access for folders and media the user can access.
- `drive.file` write access for app-created Drive files such as share metadata
  and import destination folders.
- Google user info scopes used for profile-backed sharing identity.

The detailed setup is in [`oauth-setup.md`](./oauth-setup.md).

## Library Discovery

After the root is paired, Nyrima treats its direct child folders as library
entries. A child folder can hold a movie, a show, or season folders. The app
lists files through Drive metadata calls, recognizes video and subtitle
extensions, parses names for episodes and seasons, and builds library views.

Artwork is explicit:

- Put `Poster.jpg`, `Poster.png`, or `Poster.webp` in a Drive library folder
  for cover art.
- Put a `Backdrop.*` image in the folder when a separate background image is
  useful.
- A folder without artwork still works; it simply has less visual richness.

Nyrima does not currently call a third-party poster or media metadata provider
to fill those images.

## Playback

The player starts from Drive file metadata and a Drive media URL.

1. Browser-native playback is preferred when Chrome can play the media as-is.
2. For supported MKV cases that need conversion for the browser pipeline,
   Nyrima Range-fetches bytes from Drive and remuxes streams through Media
   Source Extensions.
3. The remux path feeds the video element without uploading the source to a
   Nyrima server.
4. Subtitles can come from matching Drive sibling files or supported embedded
   MKV text subtitle tracks.
5. ASS and SSA subtitle paths use JASSUB/libass where supported so richer
   subtitle layout survives better than plain browser text rendering.

The player stores resume positions locally and uses them for Continue Watching
and watched-state UI. It does not write watch progress to Drive in the current
app.

## Extension Surfaces

Nyrima is split into browser extension contexts:

- The main React app page is where the lobby, library, social hub, and player
  render.
- The background service worker handles OAuth token mediation, app-tab
  deep-links, recent-folder messages, a token refresh alarm, and the dynamic
  request rule used for OAuth media header injection.
- A Drive content script adds an "Open in Nyrima" action to Drive folder pages.
  It opens the app for the current Drive folder; it does not scrape cookies.
- The toolbar popup opens the app or recent locations.

See [`architecture.md`](./architecture.md) for the technical component map.

## Optional Sharing

Sharing is metadata federation through Drive.

When a user shares from Nyrima, the app can create:

```text
Nyrima root/
  Shared/
    index.json
    comments.jsonl
```

`index.json` contains share entries, author information, titles, and Drive
target references. `comments.jsonl` contains comments the user has posted.
The user can choose whether the `Shared/` folder is readable by anyone with
its Drive link.

Another user can follow that published `Shared/` folder URL. Their Nyrima app
reads the index from Drive and shows entries in an Inbox. A share entry does
not automatically grant access to the target video or library. Google Drive
permissions on the target still decide whether the follower can open or import
it.

Import uses Drive copy APIs. The browser asks Drive to copy accessible content
into the recipient's Drive rather than downloading and re-uploading video
bytes through a Nyrima server.

## Network Destinations

The current extension talks to a small set of destinations:

- Google Drive and related Google API/media hosts for Drive metadata, media,
  permissions, uploads, OAuth-related calls, and Google-hosted thumbnails.
- Google Accounts during OAuth consent.
- An optional public JSON directory on GitHub raw for discoverable sharing
  entries. That fetch is anonymous and does not receive a Google OAuth token.

The auditable endpoint and permission map is in
[`permissions-and-data-use.md`](./permissions-and-data-use.md).

## User Control

The user controls the important boundaries:

- Choose which Drive root to pair.
- Choose whether to configure an API key, OAuth client ID, or both.
- Remove stored access configuration and sign out from the extension UI.
- Choose whether to publish or privatize the app-created `Shared/` folder.
- Unshare entries from the share manifest.
- Keep target Drive files private unless they separately grant Drive access.

