-- Nyrima SOCIAL database — social features ONLY.
--
-- Scope (product decision): this database exists solely to back Nyrima's
-- OPT-IN social layer — adding friends and commenting on shared Drive folders.
-- It is NOT a system of record for every Nyrima user.
--
--   * Guests ("Try Nyrima") never touch this database at all.
--   * Watch history, player settings, the library list, and the Drive
--     connection stay LOCAL on each device (localStorage). They are NEVER
--     synced here. There are deliberately no cloud-sync tables.
--   * A `profiles` row is created LAZILY — the first time a signed-in user
--     opts into social (picks a handle / posts the first comment / sends the
--     first friend request), via `ensure_social_profile()`. It is NOT created
--     on signup, so the table only ever holds users who actually use social.
--
-- Identity still comes from Supabase Auth (auth.users). These tables simply
-- attach social data to that identity once the user opts in. Every row is
-- guarded by RLS keyed on auth.uid(); an unauthenticated request (i.e. a
-- guest, who has no Supabase session) can never read or write anything here.

begin;

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────────────────────
-- Migrate away from the earlier "account schema" draft, if it was ever applied.
-- Those per-user cloud tables (settings/history/library/etc.) and the signup
-- auto-provisioning trigger contradict the social-only + local-first model, so
-- we drop them here. Safe no-ops on a fresh database.
-- ───────────────────────────────────────────────────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop table if exists public.access_permissions cascade;
drop table if exists public.invitations cascade;
drop table if exists public.shared_playlists cascade;
drop table if exists public.shared_libraries cascade;
drop table if exists public.cache_records cascade;
drop table if exists public.favorites cascade;
drop table if exists public.watch_history cascade;
drop table if exists public.library_items cascade;
drop table if exists public.drive_connections cascade;
drop table if exists public.player_preferences cascade;
drop table if exists public.user_settings cascade;
drop table if exists public.follows cascade;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- profiles — social identity. Lazy-created on first social use (NOT on signup).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ───────────────────────────────────────────────────────────────────────────
-- friendships — the friend graph (add friend).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);

-- ───────────────────────────────────────────────────────────────────────────
-- folder_comments — comments on a shared Drive folder (comment on sharing folder).
-- `folder_id` is the Google Drive folder id being discussed; comments are tied
-- to the Drive resource, not to a Nyrima-owned "library" row.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.folder_comments (
  id uuid primary key default gen_random_uuid(),
  folder_id text not null,
  -- The specific share entry (ShareEntry.id) the comment targets, when it is
  -- about one share rather than the folder as a whole. Null = a folder-level
  -- comment (future-proofs the shelf/directory view).
  share_id text,
  -- References profiles(id) (NOT auth.users) so PostgREST can embed the author
  -- profile in a single query, and so every commenter is guaranteed a social
  -- profile — created lazily via ensure_social_profile() right before the first
  -- insert. RLS still keys on auth.uid() (profiles.id = auth.uid()).
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists friendships_friend_idx on public.friendships(friend_user_id);
create index if not exists folder_comments_folder_idx on public.folder_comments(folder_id, share_id, created_at);
create index if not exists folder_comments_author_idx on public.folder_comments(author_user_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
before update on public.friendships
for each row execute function public.set_updated_at();

drop trigger if exists folder_comments_set_updated_at on public.folder_comments;
create trigger folder_comments_set_updated_at
before update on public.folder_comments
for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- ensure_social_profile — lazy, caller-scoped profile creation. The client
-- calls this (RPC) the first time the signed-in user opts into social. It only
-- ever writes the CALLER'S own row (auth.uid()), so it cannot be used to
-- provision other users. Guests have no session → auth.uid() is null → raises.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.ensure_social_profile(
  p_handle text default null,
  p_display_name text default null,
  p_avatar_url text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'A Nyrima account is required to use social features.';
  end if;

  insert into public.profiles (id, handle, display_name, avatar_url)
  values (
    auth.uid(),
    p_handle,
    coalesce(p_display_name, ''),
    p_avatar_url
  )
  on conflict (id) do update set
    handle = coalesce(excluded.handle, public.profiles.handle),
    display_name = coalesce(nullif(excluded.display_name, ''), public.profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = timezone('utc', now())
  returning * into result;

  return result;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Row Level Security — every table is auth.uid()-gated. No anon/guest access.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.folder_comments enable row level security;

-- profiles: any signed-in user may read the social directory (to find friends
-- and label comment authors); you may only write your OWN profile row.
drop policy if exists profiles_select_authed on public.profiles;
create policy profiles_select_authed on public.profiles
for select using (auth.uid() is not null);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert with check (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
for delete using (id = auth.uid());

-- friendships: a user sees + manages relationships they are part of.
drop policy if exists friendships_select_related on public.friendships;
create policy friendships_select_related on public.friendships
for select using (user_id = auth.uid() or friend_user_id = auth.uid());
drop policy if exists friendships_insert_own on public.friendships;
create policy friendships_insert_own on public.friendships
for insert with check (user_id = auth.uid());
drop policy if exists friendships_update_related on public.friendships;
create policy friendships_update_related on public.friendships
for update using (user_id = auth.uid() or friend_user_id = auth.uid())
with check (user_id = auth.uid() or friend_user_id = auth.uid());
drop policy if exists friendships_delete_own on public.friendships;
create policy friendships_delete_own on public.friendships
for delete using (user_id = auth.uid());

-- folder_comments: any signed-in user may read comments on a shared folder;
-- you may only create comments as yourself and edit/delete your own.
drop policy if exists folder_comments_select_authed on public.folder_comments;
create policy folder_comments_select_authed on public.folder_comments
for select using (auth.uid() is not null);
drop policy if exists folder_comments_insert_own on public.folder_comments;
create policy folder_comments_insert_own on public.folder_comments
for insert with check (author_user_id = auth.uid());
drop policy if exists folder_comments_update_own on public.folder_comments;
create policy folder_comments_update_own on public.folder_comments
for update using (author_user_id = auth.uid()) with check (author_user_id = auth.uid());
drop policy if exists folder_comments_delete_own on public.folder_comments;
create policy folder_comments_delete_own on public.folder_comments
for delete using (author_user_id = auth.uid());

commit;
