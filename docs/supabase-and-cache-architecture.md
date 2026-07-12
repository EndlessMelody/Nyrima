# Supabase And Cache Architecture

## Source Of Truth

Supabase Auth is the source of truth for Nyrima account identity. Supabase
Postgres is the durable source of truth for the **opt-in social layer only** —
adding friends and commenting on shared Drive folders.

It is NOT a system of record for every Nyrima user, and it does NOT cloud-sync
general app data. Watch history, player settings, the library list, the Drive
connection, and cache metadata stay **local on each device** for all users.
Guests ("Try Nyrima") have no Supabase session and never touch the database.

The browser uses only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUBLIC_SITE_URL`

The anon key is public by design. Data isolation comes from Row Level Security
in `supabase/migrations/20260531160000_social_schema.sql`; every table is gated
on `auth.uid()`, so an unauthenticated (guest) request can neither read nor
write anything.

## Tables (social-only)

The schema creates exactly three tables, plus one helper:

- `profiles` — social identity (handle, display name, avatar). Created
  **lazily** the first time a signed-in user opts into social (via the
  `ensure_social_profile()` RPC), NOT on signup — so the table only ever holds
  people who actually use social.
- `friendships` — the friend graph (add friend).
- `folder_comments` — comments on a shared Drive folder, keyed by the Drive
  `folder_id` (comment on the sharing folder).

There are deliberately no cloud-sync tables for settings/history/library/etc.
RLS policies use `auth.uid()` so a user reads the social directory + comments
but writes only their own profile, friendships, and comments.

## Repository Boundary

`src/server/db/repository.ts` is **local-only** by design (`getRepository()`
always returns the local repository). Settings, player preferences, watch
history, libraries, favorites, and cache metadata persist through the
chrome-storage shim for every user — they are never written to Supabase.

`src/server/db/supabase-repository.ts` is retained for reference + its unit
test but is intentionally not selected; re-wiring it would reintroduce per-user
cloud sync, which this model avoids.

The social layer (friends + folder comments) talks to Supabase directly through
the client + RLS, not through this generic repository boundary.

## Redis Boundary

Redis is cache-only. It must never become the durable source of truth for:

- Profiles
- Settings
- Refresh tokens
- Drive permissions
- Watch history
- Favorites
- Relationships
- Library ownership

Redis is appropriate later for:

- Short-lived Drive folder metadata
- Short-lived Drive file metadata
- OAuth state / PKCE temporary state
- Short-lived access token cache when needed
- Rate limiting
- Cache invalidation locks
- Background refresh locks
- Expensive API response cache

Redis credentials must not use `VITE_*` names and must never be imported by
frontend code. Access should go through Supabase Edge Functions or a future
backend API. Cache metadata (ownership, keys, ETags, expiry, invalidation)
lives locally today via the chrome-storage shim — there is no durable cache
table in the social-only database.

## Server-Only Variables

These belong only in Supabase Edge Functions or another trusted backend:

- `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

Do not prefix these with `VITE_`.

## Not In This Phase

This phase does not implement production Google Drive OAuth, token refresh,
Redis access, or a full repository migration. The current Drive connection
flow remains the existing browser/BYOK path until a server function owns the
authorization-code exchange and token storage.
