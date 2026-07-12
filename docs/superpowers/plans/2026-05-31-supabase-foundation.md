# Supabase Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining mock-only account/data foundation with Supabase-ready auth, profile/settings persistence, SQL schema, and a Redis-safe cache boundary.

**Architecture:** Supabase Auth owns identity and Supabase Postgres owns durable account data. The browser may use only Supabase anon credentials and RLS-guarded tables; Redis/Upstash remains server-only through future Edge Functions or backend APIs.

**Tech Stack:** Vite, React, TypeScript, Supabase JS v2, Supabase SQL migrations, Vitest.

---

### Task 1: Supabase Repository Slice

**Files:**
- Create: `src/server/db/supabase-repository.ts`
- Modify: `src/server/db/repository.ts`
- Test: `src/server/db/supabase-repository.test.ts`

- [ ] **Step 1: Write tests for profile/settings/player preference mapping**

Verify that Supabase rows map to `User`, `UserSettings`, and `PlayerPreferences` and that repository writes use account-scoped `user_id`.

- [ ] **Step 2: Run the repository test and verify it fails**

Run: `npm test -- src/server/db/supabase-repository.test.ts`

- [ ] **Step 3: Implement the Supabase-backed repository slice**

Implement `users`, `settings`, and `cache` against Supabase tables, while delegating not-yet-migrated library/watch/social repositories to the existing local repository.

- [ ] **Step 4: Run the repository test and verify it passes**

Run: `npm test -- src/server/db/supabase-repository.test.ts`

### Task 2: Settings Storage Bridge

**Files:**
- Modify: `src/app/services/storage.ts`
- Test: `src/app/services/storage-settings-repository.test.ts`

- [ ] **Step 1: Write tests for account-aware settings persistence**

Verify that `getSettings()` and `saveSettings()` use the active account repository when Supabase is configured, and keep the chrome-storage fallback for guest/local mode.

- [ ] **Step 2: Run the storage test and verify it fails**

Run: `npm test -- src/app/services/storage-settings-repository.test.ts`

- [ ] **Step 3: Wire settings/profile first**

Bridge app settings to `Repository.settings` for signed-in accounts; leave other chrome-storage areas documented as remaining migration work.

- [ ] **Step 4: Run the storage test and verify it passes**

Run: `npm test -- src/app/services/storage-settings-repository.test.ts`

### Task 3: Supabase Schema And RLS

**Files:**
- Create: `supabase/migrations/20260531160000_initial_account_schema.sql`
- Create: `supabase/functions/README.md`
- Create/Modify: `docs/supabase-and-cache-architecture.md`
- Modify: `.env.example`

- [ ] **Step 1: Add initial tables**

Create the expected persistent tables from the pasted plan with `auth.users.id` as the identity source and `user_id` ownership columns.

- [ ] **Step 2: Add RLS policies**

Enable RLS and add `auth.uid()` policies so users can only access owned rows.

- [ ] **Step 3: Document Edge Function boundaries**

Document future server-only handling for Drive OAuth exchange/refresh, Redis access, rate limiting, metadata fetches, and cache locks.

### Task 4: Validation

**Files:**
- No direct source changes unless validation exposes a required fix.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 2: Run tests**

Run: `npm test`

- [ ] **Step 3: Run build**

Run: `npm run build`

- [ ] **Step 4: Report remaining migration work**

Report Supabase files added, auth/repository/cache changes, env variables, chrome/local storage still remaining, commands to run, and next phase recommendation.
