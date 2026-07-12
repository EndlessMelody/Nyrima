# Nyrima data model (`src/server/db`)

This folder defines Nyrima's **account-centric** data architecture. It now has
a first Supabase-backed slice for profiles, settings/player preferences, and
cache metadata, while the local implementation still carries the app areas that
have not been migrated yet.

## Files

| File | Role |
| --- | --- |
| `schema.ts` | Entity & relationship types (the data model). |
| `repository.ts` | The `Repository` boundary — every read/write goes through it. `getRepository()` resolves the active implementation. |
| `local-repository.ts` | Browser/localStorage implementation, partitioned by `userId`. The dev stand-in. |
| `supabase-repository.ts` | Supabase implementation for profiles, settings/player preferences, and cache metadata. |
| `cache.ts` | Account-aware cache *metadata* boundary (`CacheRecord`, `CacheBackend`). |

## Model overview

Everything is owned by a `User` (foreign key `userId`) so data is isolated per
account:

- **Account**: `User`, `UserSettings`, `PlayerPreferences`
- **Drive**: `DriveConnection` (a user's link to a Google Drive + paired root) —
  Drive data belongs to the owning user only.
- **Library/playback**: `LibraryItem`, `WatchHistoryEntry`, `Favorite`
- **Cache**: `CacheRecord` (user, key, source, timestamps, etag/expiry)
- **Relationships**: `Friendship`, `Follow`, `SharedLibrary`, `SharedPlaylist`,
  `Invitation`, `AccessPermission`

`AccountData` is the aggregate `/me` shape, also used for GDPR export/delete.

## Going to a real database

1. Apply the Supabase migration in `supabase/migrations`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the browser app.
3. Continue migrating callers table-by-table behind this repository boundary.
4. Keep service-role keys, Google client secrets, and Redis credentials in
   Supabase Edge Functions or another trusted backend only.

## Relationship to existing runtime storage

- Per-account settings now use `Repository.settings` when Supabase is
  configured and an account is active. Recents, playback, Drive credentials,
  root pairing, and social state still flow through the chrome-storage shim
  while their repository migrations are pending.
- The heavy byte cache (Drive listings, metadata, subtitles, media segments)
  lives in `src/app/services/drive/idb.ts`. `cache.ts` here is the *metadata*
  boundary a future backend owns, not a second byte store.

> Status: Supabase profiles/settings/cache metadata are wired. The remaining
> domain repositories intentionally delegate to local storage until migrated.
