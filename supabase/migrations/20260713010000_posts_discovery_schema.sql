-- Nyrima posts discovery — a friends+public post index + likes, so "Popular"
-- can surface posts from users you don't follow, and a friends-only post can
-- be opened by direct link with a real permission check. Additive to
-- 20260531160000_social_schema.sql / 20260713000000_profile_dashboard_schema.sql.
--
-- Same trust boundary as the rest of the social schema: this table stores
-- POINTERS to Drive-hosted content (title/excerpt/cover snapshot + the Drive
-- folder id), never the post body itself — `post.json` and its block tree
-- stay on Drive, exactly like `folder_comments` points at a Drive folder id
-- rather than owning the folder's contents.
--
-- Both friends and public posts get a row here (`visibility` column). RLS
-- is what actually enforces "friends" — a friends row is only readable by
-- an accepted friend of the author (or the author themself); a public row
-- is readable by any signed-in user. `Shared/posts.json` (pulled by
-- followers) keeps working unchanged alongside this — this table's job is
-- permission-checked direct-link access, not a replacement for that feed.

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- posts_index — one row per published friends/public post (never draft or
-- private — see `visibility` below).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.posts_index (
  id uuid primary key default gen_random_uuid(),
  -- Matches PostDoc.id (src/shared/post-types.ts). Upsert target.
  post_id text not null unique,
  -- Drive folder id of the post — the /posts/view/:folderId routing key.
  folder_id text not null,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  excerpt text check (excerpt is null or char_length(excerpt) <= 500),
  poster_url text,
  tags text[] not null default '{}'::text[],
  visibility text not null default 'public' check (visibility in ('friends', 'public')),
  like_count integer not null default 0,
  published_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists posts_index_popular_idx
  on public.posts_index(like_count desc, published_at desc);
create index if not exists posts_index_recent_idx
  on public.posts_index(published_at desc);
create index if not exists posts_index_author_idx
  on public.posts_index(author_user_id);
create index if not exists posts_index_visibility_idx
  on public.posts_index(visibility);

drop trigger if exists posts_index_set_updated_at on public.posts_index;
create trigger posts_index_set_updated_at
before update on public.posts_index
for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- post_likes — self-insert, same trust model as folder_comments/user_badges.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id text not null references public.posts_index(post_id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, post_id)
);

create index if not exists post_likes_post_idx on public.post_likes(post_id);

-- ───────────────────────────────────────────────────────────────────────────
-- bump_post_like_count — keeps posts_index.like_count server-truthful
-- without a live count() per feed card.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.bump_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.posts_index
      set like_count = like_count + 1
      where post_id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.posts_index
      set like_count = greatest(0, like_count - 1)
      where post_id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists post_likes_bump_count on public.post_likes;
create trigger post_likes_bump_count
after insert or delete on public.post_likes
for each row execute function public.bump_post_like_count();

-- ───────────────────────────────────────────────────────────────────────────
-- Row Level Security — public rows are readable by any signed-in user;
-- friends rows only by an accepted friend of the author (or the author);
-- writes are author/liker-only.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.posts_index enable row level security;
alter table public.post_likes enable row level security;

-- Superseded by posts_index_select_visible below — dropped so a re-run of
-- this migration doesn't leave both policies (OR'd together) in place.
drop policy if exists posts_index_select_authed on public.posts_index;
drop policy if exists posts_index_select_visible on public.posts_index;
create policy posts_index_select_visible on public.posts_index
for select using (
  author_user_id = auth.uid()
  or (visibility = 'public' and auth.uid() is not null)
  or (visibility = 'friends' and exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and (
        (f.user_id = auth.uid() and f.friend_user_id = author_user_id)
        or (f.friend_user_id = auth.uid() and f.user_id = author_user_id)
      )
  ))
);
drop policy if exists posts_index_insert_own on public.posts_index;
create policy posts_index_insert_own on public.posts_index
for insert with check (author_user_id = auth.uid());
drop policy if exists posts_index_update_own on public.posts_index;
create policy posts_index_update_own on public.posts_index
for update using (author_user_id = auth.uid()) with check (author_user_id = auth.uid());
drop policy if exists posts_index_delete_own on public.posts_index;
create policy posts_index_delete_own on public.posts_index
for delete using (author_user_id = auth.uid());

drop policy if exists post_likes_select_authed on public.post_likes;
create policy post_likes_select_authed on public.post_likes
for select using (auth.uid() is not null);
drop policy if exists post_likes_insert_own on public.post_likes;
create policy post_likes_insert_own on public.post_likes
for insert with check (user_id = auth.uid());
drop policy if exists post_likes_delete_own on public.post_likes;
create policy post_likes_delete_own on public.post_likes
for delete using (user_id = auth.uid());

commit;
