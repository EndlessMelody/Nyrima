# Nyrima Privacy Policy

**Effective date:** Add the public release effective date before publishing.

**Publisher/contact:** Add the publisher name and support email or support
contact URL before publishing this policy outside the repository.

This policy describes the current Nyrima Chrome extension. Nyrima lets a user
browse and watch Google Drive video libraries inside Chrome and optionally use
Drive-native sharing metadata and imports.

## Summary

- Nyrima currently has no Nyrima backend that receives user media or Drive
  library contents.
- Nyrima does not read or steal browser cookies from Google Drive or other
  websites.
- Nyrima does not sell user data and does not use user data for personalized
  advertising.
- Google Drive data is accessed only to provide user-facing Nyrima features
  the user chooses, such as listing a Drive library, playing a video, loading
  artwork/subtitles, publishing share metadata, reading followed share
  metadata, commenting, or importing accessible Drive content.
- Optional sharing can make the user's app-created `Shared/` Drive metadata
  folder readable to anyone with its Drive link when the user chooses that
  permission change.

## Data Nyrima Accesses

Depending on configuration and features used, Nyrima may access:

### Google Drive library data

- Drive folder and file IDs.
- Folder/file names and metadata returned by Drive.
- Video media bytes and media Range responses for playback.
- Poster, backdrop, thumbnail, and subtitle files the user can access.
- Drive permission/capability information needed to show or perform current
  share/import operations.

### Google profile data

When the user connects OAuth scopes that return user information, Nyrima may
read profile fields such as email address, display name, and profile image for
current signed-in and sharing surfaces.

### User-provided access configuration

Nyrima stores locally:

- A user-provided Google Drive API key, when configured.
- A user-provided Google OAuth Chrome Extension client ID, when configured.

### Local app state

Nyrima stores local state such as:

- Paired Drive root and recent folders.
- Watch progress/resume positions.
- Player, subtitle, library, and theme preferences.
- Local Drive metadata/media/subtitle/thumbnail caches.
- Sharing handle/profile configuration, followed share folders, inbox cache,
  and public directory cache when those features are used.

## How Nyrima Uses Data

Nyrima uses accessed data only for current extension features:

- Validate and browse a Drive root and its libraries.
- Render library titles, posters, subtitles, thumbnails, and playback UI.
- Stream or locally remux supported video bytes in the browser.
- Save local settings and watch progress.
- Connect signed-in Drive access through Google OAuth.
- Create and update app-owned sharing metadata/comment files in the user's
  Drive when sharing is used.
- Read published share metadata/comment streams that the user follows or owns.
- Copy accessible shared Drive targets into the user's Drive when the user
  requests import.

## Where Data Is Stored

### In the browser

Persistent application state is stored in Chrome extension storage and local
IndexedDB caches in the user's browser profile. Short-lived OAuth token cache
data is held by the extension background service worker and Chrome session
storage for current signed-in operation.

### In Google Drive

User media already lives in Google Drive. If the user uses write features,
Nyrima may create:

- An app-owned `Shared/` folder containing `index.json` share metadata and
  `comments.jsonl` outbound comments.
- An app-owned `Imports/` destination with Drive copies the user requests.

## Optional Public Sharing

Sharing has separate metadata and media permissions.

If the user publishes the app-created `Shared/` folder as link-readable in
Drive, people with that folder link may be able to read the share metadata and
comment-stream files exposed by that Drive permission. Share metadata can
include handle/profile snapshots, titles, captions, poster URLs, Drive target
references, comments, and timestamps.

Publishing `Shared/` does **not** automatically make the target Drive video or
library public. Google Drive target permissions still control whether another
person can open or import the target.

If another user already cached share metadata or imported a permitted Drive
copy before an unshare/private change, changing future visibility does not
remove those already received copies or caches.

## Network Destinations

Nyrima currently contacts:

- Google Drive and Google API/media/thumbnail hosts required for Drive access
  and playback.
- Google OAuth/Accounts flows required for user authorization.
- An optional public GitHub raw JSON directory for sharing discovery. That
  fetch omits credentials and does not receive a Google OAuth token.

The current auditable map is in
[`permissions-and-data-use.md`](./permissions-and-data-use.md).

## Cookies And Browsing Activity

Nyrima does not require reading browser cookies from Google Drive or other
websites. The Drive content script uses the Drive page URL and limited visible
page context to open a Drive folder in Nyrima; it is not used to collect
general browsing activity.

## Sale, Advertising, And Human Access

Nyrima does not sell user data. The current extension does not use Drive data,
profile data, watch progress, or share data for personalized advertising.

Because the current app has no Nyrima backend receiving user library data,
Nyrima does not provide a developer dashboard for humans to browse a user's
Drive media or local watch history. Google Drive sharing choices still matter:
people granted Drive access by the user or by Drive permissions may read what
those permissions allow.

## Google API Limited Use

Nyrima's use and transfer of information received from Google APIs will adhere
to the Google API Services User Data Policy, including the Limited Use
requirements. Nyrima uses Google API user data only to provide or improve the
user-facing features described in this policy and does not use it for
personalized advertising or sell it to data brokers or information resellers.

Nyrima also affirms that use of information received from Google APIs will
adhere to the Chrome Web Store User Data Policy, including the Limited Use
requirements.

## Security Notes

Nyrima is designed to keep media flow between Google Drive and the browser and
to store extension state locally unless the user chooses Drive write/sharing
features. No extension can eliminate risks from:

- Google Drive permissions chosen by the user or target owner.
- Public share metadata the user publishes.
- Device/browser-profile compromise.
- Third-party browser extensions or local software with their own access.

## User Choices

The user can:

- Choose which Drive root to pair.
- Choose whether to configure API key or OAuth access.
- Sign out and remove stored access configuration from the extension UI.
- Clear watch history and local caches where the current UI provides it.
- Publish or make private the app-created `Shared/` folder.
- Unshare future manifest entries and manage target Drive permissions in Drive.

## Changes To This Policy

Update this policy when the deployed extension changes how it accesses, uses,
stores, transfers, or exposes data. The public effective date should be updated
for externally published policy revisions.

## Contact

Add the final publisher support contact before publishing:

```text
Publisher:
Support email or URL:
```

