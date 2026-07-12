# Deployment: Supabase + Vercel

This is the step-by-step, re-runnable walkthrough for standing up Nyrima's
social database on Supabase and deploying the web app to Vercel. It only
covers what the app actually reads today — see
[`supabase-and-cache-architecture.md`](./supabase-and-cache-architecture.md)
for why the scope stops where it does (no Edge Functions, no Redis, no
service-role key — none of that is wired into any code path yet).

## Part 1 — Create the Supabase project

1. At [supabase.com](https://supabase.com), create a new project (pick a name,
   region, and database password — save the password somewhere safe, you
   won't need it again unless you connect via `psql`).
2. Once it's provisioned, open **Project Settings → API** and copy:
   - **Project URL** → this is `VITE_SUPABASE_URL`.
   - **anon / publishable key** → this is `VITE_SUPABASE_ANON_KEY`.

   Do **not** copy the `service_role` key anywhere in this app — it bypasses
   Row Level Security and has no legitimate use here (no server code consumes
   it yet).

## Part 2 — Push the social schema

The full schema already lives in
[`supabase/migrations/20260531160000_social_schema.sql`](../supabase/migrations/20260531160000_social_schema.sql)
(`profiles`, `friendships`, `folder_comments`, all RLS-gated, plus the
`ensure_social_profile()` RPC). Apply it with the SQL Editor — no CLI install
or login required:

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Paste the entire contents of that migration file.
3. Run it. It's idempotent (`create table if not exists`, `drop ... if exists`
   guards throughout), so re-running it later is safe.
4. Confirm in **Table Editor** that `profiles`, `friendships`, and
   `folder_comments` exist, and that **Authentication → Policies** shows RLS
   enabled with the policies from the migration.

<details>
<summary>Optional: Supabase CLI alternative</summary>

If you'd rather manage migrations with the CLI instead of pasting SQL:

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

This isn't required — the SQL Editor method above does the same thing with
one less tool to install and authenticate.
</details>

## Part 3 — Enable Auth providers

1. **Authentication → Providers → Email**: leave enabled (default). This
   covers email/password sign-up handled by
   [`src/auth/providers/supabase-auth.ts`](../src/auth/providers/supabase-auth.ts).
2. **Authentication → Providers → Google**: enable it. This needs its own
   Google OAuth client — separate from the Drive-access client in
   [`oauth-setup.md`](./oauth-setup.md), because this one authenticates a
   Nyrima *account*, not Drive file access.
   - In Google Cloud Console, create another OAuth client of type
     **Web application**.
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (Supabase shows you this exact URL on the same settings page).
   - Paste the resulting Client ID and Client Secret into Supabase's Google
     provider config and save.
   - No env var is needed for this — it's Supabase-side configuration only.
3. **Authentication → URL Configuration**: set **Site URL** to your production
   domain (`https://nyrima.pldkhoa.io.vn`) once you know it, and add
   `http://localhost:5173/**` as an additional redirect URL for local dev.

## Part 4 — Production Drive OAuth redirect

Separately from Supabase Auth, the existing Drive-access Google OAuth client
(see [`oauth-setup.md`](./oauth-setup.md)) needs the production domain added:

1. Open the Drive-access OAuth client in Google Cloud Console.
2. Add to **Authorized JavaScript origins**: `https://nyrima.pldkhoa.io.vn`
3. Add to **Authorized redirect URIs**:
   `https://nyrima.pldkhoa.io.vn/auth/google/callback`

## Part 5 — Deploy to Vercel

The repo already has [`vercel.json`](../vercel.json) committed: it sets the
build command, output directory, and a SPA rewrite so client-routed pages
(`/auth/callback`, `/auth/google/callback`, etc.) don't 404 on a hard refresh.

1. On [vercel.com](https://vercel.com), **Add New → Project**, import the
   GitHub repo. Vercel auto-detects the Vite framework preset; the settings
   from `vercel.json` apply automatically.
2. Under **Settings → Environment Variables**, add exactly these (Production
   and Preview environments) — nothing else is read by the app:

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | from Part 1 |
   | `VITE_SUPABASE_ANON_KEY` | from Part 1 |
   | `VITE_PUBLIC_SITE_URL` | `https://nyrima.pldkhoa.io.vn` |
   | `VITE_GOOGLE_CLIENT_ID` | Drive-access client ID from Part 4 |
   | `VITE_GOOGLE_OAUTH_REDIRECT_URI` | `https://nyrima.pldkhoa.io.vn/auth/google/callback` |
   | `VITE_DEVELOPER_NAME` | e.g. `Khoa Phan` |
   | `VITE_DEVELOPER_EMAIL` | contact email shown on the landing page |
   | `VITE_NYRIMA_REPO_URL` | `https://github.com/EndlessMelody/Nyrima` |

   Skip `VITE_API_BASE_URL` (unused), the deprecated `VITE_GOOGLE_OAUTH_CLIENT_ID`
   alias, and everything in the `.env.example` "SERVER-ONLY" block
   (`SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_*`,
   `GOOGLE_OAUTH_CLIENT_ID/SECRET`) — none of it is consumed by any code path
   yet.
3. **Settings → Domains**: add `nyrima.pldkhoa.io.vn` and point its DNS
   (per Vercel's shown records) at the project.
4. Deploy.

## Part 6 — Verify

- Open the deployed site, sign up with email/password, and confirm a
  `profiles` row appears in Supabase only after you actually use a social
  feature (add a friend or comment on a shared folder) — not at signup, per
  the lazy-provisioning design.
- Try "Sign in with Google" and confirm it completes and lands back on the
  app.
- Connect Google Drive (the separate Drive OAuth flow) and confirm playback
  still works.
- Open the site in a private/incognito window and use "Try Nyrima" (guest
  mode) — confirm no Supabase requests fire (check the Network tab for
  `*.supabase.co`) and everything still works locally.
