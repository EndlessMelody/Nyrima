-- Nyrima profile dashboard — bio/genres/pinned fields, aggregate stats,
-- contribution heatmap, and badges. Additive to 20260531160000_social_schema.sql.
--
-- Same hard constraint as the base social schema: watch history, library
-- contents, and settings stay LOCAL. Nothing here stores raw per-episode
-- watch records — `profile_stats` and `activity_days` are CLIENT-COMPUTED
-- AGGREGATES ONLY (counts, streaks, day-buckets), pushed by the signed-in
-- user's own device. There is no server-side verification of these numbers,
-- the same trust boundary the social layer already accepts for comments and
-- friend requests (see that migration's header comment).

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- profiles — extend with public-profile fields (bio/genres/links/pinned).
-- Plain columns: writable via the existing `profiles_update_own` policy.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists bio text check (char_length(bio) <= 280),
  add column if not exists genres text[] not null default '{}'::text[],
  add column if not exists social_links jsonb not null default '[]'::jsonb,
  add column if not exists pinned_kind text
    check (pinned_kind is null or pinned_kind in ('library', 'post')),
  add column if not exists pinned_ref text,
  add column if not exists pinned_label text;

alter table public.profiles
  drop constraint if exists profiles_genres_len;
alter table public.profiles
  add constraint profiles_genres_len
  check (array_length(genres, 1) is null or array_length(genres, 1) <= 12);

alter table public.profiles
  drop constraint if exists profiles_social_links_size;
alter table public.profiles
  add constraint profiles_social_links_size
  check (pg_column_size(social_links) < 4000);

-- ───────────────────────────────────────────────────────────────────────────
-- profile_stats — one row per user, a snapshot of client-computed lifetime
-- totals (never raw watch history). Refreshed wholesale on every sync.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.profile_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minutes_watched integer not null default 0,
  completed_count integer not null default 0,
  libraries_owned integer not null default 0,
  posts_count integer not null default 0,
  comments_given_count integer not null default 0,
  comments_received_count integer not null default 0,
  friends_count integer not null default 0,
  current_streak_days integer not null default 0,
  longest_streak_days integer not null default 0,
  last_active_day date,
  computed_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists profile_stats_set_updated_at on public.profile_stats;
create trigger profile_stats_set_updated_at
before update on public.profile_stats
for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- activity_days — the heatmap. One row per user per calendar day; `units`
-- is a client-defined activity-touch count (distinct files touched that
-- day), not real watch-minutes. Retention is pruned to 365 days per caller
-- inside `upsert_activity_days`.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  units integer not null default 0,
  primary key (user_id, day)
);

create index if not exists activity_days_user_day_idx
  on public.activity_days(user_id, day desc);

-- ───────────────────────────────────────────────────────────────────────────
-- badge_defs — static catalog, seeded below. Nobody (not even the owner)
-- can write this table except via a migration.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.badge_defs (
  id text primary key,
  label text not null,
  description text not null,
  icon text,
  tier text check (tier is null or tier in ('bronze', 'silver', 'gold')),
  sort_order integer not null default 0
);

insert into public.badge_defs (id, label, description, icon, tier, sort_order) values
  ('streak-7', '7-Day Streak', 'Watched something 7 days in a row.', 'flame', 'bronze', 10),
  ('streak-30', '30-Day Streak', 'Watched something 30 days in a row.', 'flame', 'silver', 20),
  ('streak-100', '100-Day Streak', 'Watched something 100 days in a row.', 'flame', 'gold', 30),
  ('completed-10', 'Getting Started', 'Finished 10 episodes or movies.', 'clapperboard', 'bronze', 40),
  ('completed-100', 'Marathoner', 'Finished 100 episodes or movies.', 'clapperboard', 'silver', 50),
  ('completed-500', 'Completionist', 'Finished 500 episodes or movies.', 'clapperboard', 'gold', 60),
  ('libraries-5', 'Collector', 'Opened 5 different libraries.', 'library', 'bronze', 70),
  ('libraries-20', 'Archivist', 'Opened 20 different libraries.', 'library', 'silver', 80),
  ('social-butterfly', 'Social Butterfly', 'Made 5 friends on Nyrima.', 'users', 'bronze', 90),
  ('first-post', 'First Post', 'Published your first post.', 'pen-line', 'bronze', 100),
  ('commenter', 'Commenter', 'Left 10 comments on shared folders.', 'message-circle', 'bronze', 110)
on conflict (id) do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- user_badges — earned badges, self-insert (same trust model as
-- folder_comments: the client asserts its own achievement, no server
-- verification beyond "you can only insert your own row").
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null references public.badge_defs(id) on delete cascade,
  earned_at timestamptz not null default timezone('utc', now()),
  unique (user_id, badge_id)
);

-- ───────────────────────────────────────────────────────────────────────────
-- upsert_profile_stats — security-definer RPC, scoped to auth.uid(). The
-- only way to write profile_stats (no plain insert/update policy exists).
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.upsert_profile_stats(
  p_minutes_watched integer default 0,
  p_completed_count integer default 0,
  p_libraries_owned integer default 0,
  p_posts_count integer default 0,
  p_comments_given_count integer default 0,
  p_comments_received_count integer default 0,
  p_friends_count integer default 0,
  p_current_streak_days integer default 0,
  p_longest_streak_days integer default 0,
  p_last_active_day date default null
)
returns public.profile_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profile_stats;
begin
  if auth.uid() is null then
    raise exception 'A Nyrima account is required to sync profile stats.';
  end if;

  insert into public.profile_stats (
    user_id, minutes_watched, completed_count, libraries_owned, posts_count,
    comments_given_count, comments_received_count, friends_count,
    current_streak_days, longest_streak_days, last_active_day, computed_at
  )
  values (
    auth.uid(), p_minutes_watched, p_completed_count, p_libraries_owned, p_posts_count,
    p_comments_given_count, p_comments_received_count, p_friends_count,
    p_current_streak_days, p_longest_streak_days, p_last_active_day, timezone('utc', now())
  )
  on conflict (user_id) do update set
    minutes_watched = excluded.minutes_watched,
    completed_count = excluded.completed_count,
    libraries_owned = excluded.libraries_owned,
    posts_count = excluded.posts_count,
    comments_given_count = excluded.comments_given_count,
    comments_received_count = excluded.comments_received_count,
    friends_count = excluded.friends_count,
    current_streak_days = excluded.current_streak_days,
    longest_streak_days = excluded.longest_streak_days,
    last_active_day = excluded.last_active_day,
    computed_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  returning * into result;

  return result;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- upsert_activity_days — bulk RPC so a first-time sync can backfill ~365
-- days in one round trip. Prunes anything older than 365 days for the
-- caller in the same call. p_days is a JSON array of {day, units}.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.upsert_activity_days(p_days jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'A Nyrima account is required to sync activity.';
  end if;

  insert into public.activity_days (user_id, day, units)
  select
    auth.uid(),
    (elem->>'day')::date,
    coalesce((elem->>'units')::integer, 0)
  from jsonb_array_elements(p_days) as elem
  on conflict (user_id, day) do update set
    units = excluded.units;

  delete from public.activity_days
  where user_id = auth.uid()
    and day < (current_date - interval '365 days');
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Avatar storage — public-read bucket, owner-scoped writes at
-- avatars/{userId}/avatar.jpg.
-- ───────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists avatars_select_public on storage.objects;
create policy avatars_select_public on storage.objects
for select using (bucket_id = 'avatars');

drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects
for insert with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
for update using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
for delete using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);

-- ───────────────────────────────────────────────────────────────────────────
-- Row Level Security — public-ish read (any signed-in user), same pattern
-- as profiles/folder_comments: `auth.uid() is not null`.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.profile_stats enable row level security;
alter table public.activity_days enable row level security;
alter table public.badge_defs enable row level security;
alter table public.user_badges enable row level security;

drop policy if exists profile_stats_select_authed on public.profile_stats;
create policy profile_stats_select_authed on public.profile_stats
for select using (auth.uid() is not null);
-- No insert/update/delete policy — writes only via upsert_profile_stats().

drop policy if exists activity_days_select_authed on public.activity_days;
create policy activity_days_select_authed on public.activity_days
for select using (auth.uid() is not null);
-- No insert/update/delete policy — writes only via upsert_activity_days().

drop policy if exists badge_defs_select_authed on public.badge_defs;
create policy badge_defs_select_authed on public.badge_defs
for select using (auth.uid() is not null);
-- No write policy at all — catalog is migration-managed only.

drop policy if exists user_badges_select_authed on public.user_badges;
create policy user_badges_select_authed on public.user_badges
for select using (auth.uid() is not null);
drop policy if exists user_badges_insert_own on public.user_badges;
create policy user_badges_insert_own on public.user_badges
for insert with check (user_id = auth.uid());
drop policy if exists user_badges_delete_own on public.user_badges;
create policy user_badges_delete_own on public.user_badges
for delete using (user_id = auth.uid());

commit;
