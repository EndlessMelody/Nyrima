# Supabase Edge Functions Boundary

This folder is intentionally a placeholder for the trusted server layer. Do not
put Redis, Google OAuth client secrets, refresh-token handling, or service-role
queries in frontend code.

Future functions should own:

- Google Drive OAuth authorization-code exchange and refresh.
- Redis/Upstash cache reads and writes.
- OAuth state and PKCE verifier temporary state.
- Drive metadata fetches that need server-side rate limiting.
- Cache invalidation and background refresh locks.

Frontend code may call these functions through Supabase with the user's session.
The functions may use `SUPABASE_SERVICE_ROLE_KEY`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
`GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_OAUTH_CLIENT_SECRET` only in the server
runtime.
