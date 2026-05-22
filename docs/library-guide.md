# Library And Player Guide

This guide documents how the current Nyrima library and player surfaces read
Google Drive content.

## Folder Model

Nyrima pairs one Drive root folder. Direct child folders under that root are
libraries.

```text
Root folder/
  A Movie Folder/        -> one library
  A Show Folder/         -> one library
  Imports/               -> app import destination when sharing is used
  Shared/                -> app share metadata folder when sharing is used
```

Within a library folder, Nyrima can list videos directly and can group episode
files using filename and folder hints. Season-style subfolders can be useful
for shows.

## Files Nyrima Lists

Current video listing recognizes video MIME types and these filename
extensions:

```text
mp4 mkv webm mov avi m4v ts m2ts wmv flv
```

Listing a file does not guarantee Chrome can decode and play it. The current
player can use browser-native playback and a supported MKV remux path, but some
containers or codec combinations remain unsupported in practice.

Current external subtitle listing recognizes:

```text
srt vtt ass ssa sub
```

The active subtitle parser/player support is strongest for SRT, VTT, ASS, and
SSA. Keep a known-good subtitle file during testing before assuming a
particular upload is well formed.

## Artwork

Artwork belongs to the Drive folder owner.

Put a poster file in the library folder:

```text
Poster.jpg
Poster.png
Poster.webp
```

Optionally add a background image such as:

```text
Backdrop.jpg
Backdrop.webp
```

Nyrima resolves folder-local artwork. It does not currently query an external
movie/anime metadata service to guess posters.

## Subtitle Matching

External subtitle files should be siblings of the video and begin with the
same basename.

Examples:

```text
Film.mkv
Film.en.ass
Film.vi.srt

Example Show S01E01.mkv
Example Show S01E01.en.vtt
```

During supported MKV playback, Nyrima can also extract supported embedded text
subtitle tracks. Rich ASS/SSA rendering uses JASSUB/libass where the current
path supports it.

## Playback Path

At a user level, the playback path is:

1. Nyrima gets Drive metadata and a media path for the chosen file.
2. Chrome is asked to play directly when the file can be played natively.
3. Supported MKV files that need it can fall back to the MSE remux path.
4. The player mounts external or embedded subtitles that match the media.

The MSE path Range-fetches media bytes from Drive and produces browser-facing
fragments locally. It is not server-side transcoding.

## Library UI Behavior

Current library and lobby surfaces include:

- Continue Watching from locally stored playback positions.
- Library stats and recent/pinned shelves.
- In-library search and watched-state filters.
- Sort/view state for library pages.
- Grouped season/episode presentation for names the parser can understand.

Because progress is local today, another browser profile or device will not
automatically get the same resume positions.

## Good Folder Habits

- Keep one library topic per direct child folder under the root.
- Use readable filenames for episodes when you want grouping.
- Keep subtitle files beside their video with a matching basename.
- Put the poster at the library folder level when many episodes share it.
- Start with one known-good MP4 and one known-good MKV test file when checking
  a new Chrome environment.

## Practical Limits

- Google Drive permissions, quotas, copy restrictions, and rate limiting apply.
- Chrome codec support still matters, especially for containers outside the
  current MKV path.
- A Drive media request can fail even when the metadata list succeeds if
  access mode, permission, quota, or file restrictions differ.
- Nyrima does not currently sync watch progress into Drive.

For player failures, see [`troubleshooting.md`](./troubleshooting.md).

