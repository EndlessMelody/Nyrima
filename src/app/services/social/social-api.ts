/**
 * social-api — the frontend link to Nyrima's social database.
 *
 * The social layer talks to Supabase DIRECTLY through the browser client + Row
 * Level Security, NOT through the generic `Repository` boundary (which is
 * local-only by design — see docs/supabase-and-cache-architecture.md). This
 * module is that direct link: a thin, typed wrapper over `getSupabaseClient()`
 * for the three social tables (`profiles`, `friendships`, `folder_comments`)
 * and the `ensure_social_profile()` RPC.
 *
 * Every call rides the persisted session JWT, so RLS does the authorization:
 *   - reads require a signed-in user (`auth.uid()` not null);
 *   - writes can only ever touch the caller's own rows.
 * Guests ("Try Nyrima") have no Supabase session and get a clear
 * `SocialAuthRequiredError` before any request leaves the browser.
 *
 * Only the public anon key is involved (via the shared client) — no extra keys.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import type { Friendship, RelationshipStatus } from "@/server/db/schema";

// ---------------------------------------------------------------------------
// Types — camelCase domain shapes mapped from snake_case rows.
// ---------------------------------------------------------------------------

export interface SocialLink {
  label: string;
  url: string;
}

export type PinnedKind = "library" | "post";

export interface SocialProfile {
  id: string;
  handle: string | null;
  displayName: string;
  avatarUrl?: string;
  bio: string | null;
  genres: string[];
  socialLinks: SocialLink[];
  pinnedKind: PinnedKind | null;
  pinnedRef: string | null;
  pinnedLabel: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One row in `profile_stats` — client-computed lifetime aggregates only,
 *  never raw watch history. See the profile-dashboard migration header. */
export interface ProfileStats {
  userId: string;
  minutesWatched: number;
  completedCount: number;
  librariesOwned: number;
  postsCount: number;
  commentsGivenCount: number;
  commentsReceivedCount: number;
  friendsCount: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastActiveDay: string | null;
  computedAt: number;
  updatedAt: number;
}

/** One day of the contribution heatmap. `units` is an activity-touch count
 *  (distinct files touched that day), not real watch-minutes. */
export interface ActivityDay {
  day: string;
  units: number;
}

export interface BadgeDef {
  id: string;
  label: string;
  description: string;
  icon: string | null;
  tier: "bronze" | "silver" | "gold" | null;
  sortOrder: number;
}

export interface UserBadge {
  badgeId: string;
  earnedAt: number;
}

export interface FolderComment {
  id: string;
  /** Google Drive folder id the comment is attached to. */
  folderId: string;
  /** Specific share entry (`ShareEntry.id`) being discussed, when applicable. */
  shareId?: string;
  authorUserId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  /** Embedded author profile (from `profiles`), when selected. */
  author?: SocialProfile;
}

export type { Friendship, RelationshipStatus };

/** Thrown when a social action is attempted without a signed-in account. */
export class SocialAuthRequiredError extends Error {
  readonly code = "social-auth-required";
  constructor(message = "Sign in to use social features.") {
    super(message);
    this.name = "SocialAuthRequiredError";
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const COMMENT_SELECT = "*, author:profiles(*)";

/** Resolve the client + the caller's user id, or throw `SocialAuthRequiredError`. */
async function requireSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = getSupabaseClient();
  if (!client) throw new SocialAuthRequiredError();
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(`Auth session: ${error.message}`);
  const userId = data.session?.user?.id;
  if (!userId) throw new SocialAuthRequiredError();
  return { client, userId };
}

function asRow(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toEpoch(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function optStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toSocialLinks(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  const out: SocialLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const label = (item as Record<string, unknown>).label;
    const url = (item as Record<string, unknown>).url;
    if (typeof label === "string" && typeof url === "string" && url) {
      out.push({ label, url });
    }
  }
  return out;
}

function toProfile(row: Record<string, unknown>): SocialProfile {
  const created = toEpoch(row.created_at);
  const pinnedKind =
    row.pinned_kind === "library" || row.pinned_kind === "post"
      ? row.pinned_kind
      : null;
  return {
    id: String(row.id),
    handle: typeof row.handle === "string" ? row.handle : null,
    displayName: String(row.display_name ?? ""),
    avatarUrl: optStr(row.avatar_url),
    bio: typeof row.bio === "string" ? row.bio : null,
    genres: Array.isArray(row.genres) ? row.genres.filter((g): g is string => typeof g === "string") : [],
    socialLinks: toSocialLinks(row.social_links),
    pinnedKind,
    pinnedRef: optStr(row.pinned_ref) ?? null,
    pinnedLabel: optStr(row.pinned_label) ?? null,
    createdAt: created,
    updatedAt: toEpoch(row.updated_at, created),
  };
}

function toProfileStats(row: Record<string, unknown>): ProfileStats {
  const computed = toEpoch(row.computed_at);
  return {
    userId: String(row.user_id),
    minutesWatched: Number(row.minutes_watched ?? 0),
    completedCount: Number(row.completed_count ?? 0),
    librariesOwned: Number(row.libraries_owned ?? 0),
    postsCount: Number(row.posts_count ?? 0),
    commentsGivenCount: Number(row.comments_given_count ?? 0),
    commentsReceivedCount: Number(row.comments_received_count ?? 0),
    friendsCount: Number(row.friends_count ?? 0),
    currentStreakDays: Number(row.current_streak_days ?? 0),
    longestStreakDays: Number(row.longest_streak_days ?? 0),
    lastActiveDay: typeof row.last_active_day === "string" ? row.last_active_day : null,
    computedAt: computed,
    updatedAt: toEpoch(row.updated_at, computed),
  };
}

function toActivityDay(row: Record<string, unknown>): ActivityDay {
  return {
    day: String(row.day),
    units: Number(row.units ?? 0),
  };
}

function toBadgeDef(row: Record<string, unknown>): BadgeDef {
  return {
    id: String(row.id),
    label: String(row.label ?? ""),
    description: String(row.description ?? ""),
    icon: optStr(row.icon) ?? null,
    tier:
      row.tier === "bronze" || row.tier === "silver" || row.tier === "gold"
        ? row.tier
        : null,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function toUserBadge(row: Record<string, unknown>): UserBadge {
  return {
    badgeId: String(row.badge_id),
    earnedAt: toEpoch(row.earned_at),
  };
}

function toComment(row: Record<string, unknown>): FolderComment {
  const created = toEpoch(row.created_at);
  const author =
    row.author && typeof row.author === "object"
      ? toProfile(asRow(row.author))
      : undefined;
  return {
    id: String(row.id),
    folderId: String(row.folder_id),
    shareId: optStr(row.share_id),
    authorUserId: String(row.author_user_id),
    body: String(row.body ?? ""),
    createdAt: created,
    updatedAt: toEpoch(row.updated_at, created),
    author,
  };
}

function toFriendship(row: Record<string, unknown>): Friendship {
  const created = toEpoch(row.created_at);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    friendUserId: String(row.friend_user_id),
    status: (row.status as RelationshipStatus) ?? "pending",
    createdAt: created,
    updatedAt: toEpoch(row.updated_at, created),
  };
}

// ---------------------------------------------------------------------------
// Profiles — social identity, lazy-created on first opt-in.
// ---------------------------------------------------------------------------

/**
 * Lazily create (or update) the caller's own social profile via the
 * `ensure_social_profile` RPC. Safe to call repeatedly; only ever writes the
 * caller's row. Pass whatever identity is already known (e.g. the signed-in
 * account's display name + Google avatar) so social users don't re-enter it.
 */
export async function ensureSocialProfile(
  input: { handle?: string; displayName?: string; avatarUrl?: string } = {},
): Promise<SocialProfile> {
  const { client } = await requireSession();
  const { data, error } = await client.rpc("ensure_social_profile", {
    p_handle: input.handle ?? null,
    p_display_name: input.displayName ?? null,
    p_avatar_url: input.avatarUrl ?? null,
  });
  if (error) throw new Error(`Ensure profile: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return toProfile(asRow(row));
}

/**
 * Update the caller's public-profile fields (bio, genres, social links,
 * pinned library/post). Plain `.update()` under `profiles_update_own` — the
 * row must already exist, so callers should `ensureSocialProfile({})` first.
 */
export async function updateMyProfile(input: {
  bio?: string | null;
  genres?: string[];
  socialLinks?: SocialLink[];
  pinnedKind?: PinnedKind | null;
  pinnedRef?: string | null;
  pinnedLabel?: string | null;
}): Promise<SocialProfile> {
  const { client, userId } = await requireSession();
  const patch: Record<string, unknown> = {};
  if ("bio" in input) patch.bio = input.bio || null;
  if ("genres" in input) patch.genres = input.genres ?? [];
  if ("socialLinks" in input) patch.social_links = input.socialLinks ?? [];
  if ("pinnedKind" in input) patch.pinned_kind = input.pinnedKind ?? null;
  if ("pinnedRef" in input) patch.pinned_ref = input.pinnedRef ?? null;
  if ("pinnedLabel" in input) patch.pinned_label = input.pinnedLabel ?? null;
  const { data, error } = await client
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw new Error(`Update profile: ${error.message}`);
  return toProfile(asRow(data));
}

export async function getMyProfile(): Promise<SocialProfile | null> {
  const { client, userId } = await requireSession();
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Load profile: ${error.message}`);
  return data ? toProfile(asRow(data)) : null;
}

export async function getProfileByHandle(handle: string): Promise<SocialProfile | null> {
  const { client } = await requireSession();
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error(`Find profile: ${error.message}`);
  return data ? toProfile(asRow(data)) : null;
}

/** Resolve many profiles at once, keyed by id — for labelling friend/comment rows. */
export async function getProfilesByIds(
  ids: string[],
): Promise<Record<string, SocialProfile>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const { client } = await requireSession();
  const { data, error } = await client.from("profiles").select("*").in("id", unique);
  if (error) throw new Error(`Load profiles: ${error.message}`);
  const out: Record<string, SocialProfile> = {};
  for (const raw of data ?? []) {
    const profile = toProfile(asRow(raw));
    out[profile.id] = profile;
  }
  return out;
}

export async function searchProfiles(query: string): Promise<SocialProfile[]> {
  const q = query.trim();
  if (!q) return [];
  const { client } = await requireSession();
  const pattern = `%${q}%`;
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .or(`handle.ilike.${pattern},display_name.ilike.${pattern}`)
    .limit(20);
  if (error) throw new Error(`Search profiles: ${error.message}`);
  return (data ?? []).map((r) => toProfile(asRow(r)));
}

// ---------------------------------------------------------------------------
// Friendships — the friend graph (foundation; UI lands in a later step).
// ---------------------------------------------------------------------------

export async function listFriendships(): Promise<Friendship[]> {
  const { client } = await requireSession();
  // RLS already narrows to relationships the caller is part of.
  const { data, error } = await client
    .from("friendships")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Load friendships: ${error.message}`);
  return (data ?? []).map((r) => toFriendship(asRow(r)));
}

export async function sendFriendRequest(friendUserId: string): Promise<Friendship> {
  const { client, userId } = await requireSession();
  const { data, error } = await client
    .from("friendships")
    .insert({ user_id: userId, friend_user_id: friendUserId, status: "pending" })
    .select("*")
    .single();
  if (error) throw new Error(`Send friend request: ${error.message}`);
  return toFriendship(asRow(data));
}

export async function respondToFriendRequest(
  id: string,
  status: "accepted" | "blocked",
): Promise<Friendship> {
  const { client } = await requireSession();
  const { data, error } = await client
    .from("friendships")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Update friend request: ${error.message}`);
  return toFriendship(asRow(data));
}

export async function removeFriendship(id: string): Promise<void> {
  const { client } = await requireSession();
  const { error } = await client.from("friendships").delete().eq("id", id);
  if (error) throw new Error(`Remove friendship: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Folder comments — comments on a shared Drive folder / share entry.
// ---------------------------------------------------------------------------

export async function listFolderComments(
  folderId: string,
  opts: { shareId?: string } = {},
): Promise<FolderComment[]> {
  const { client } = await requireSession();
  let query = client
    .from("folder_comments")
    .select(COMMENT_SELECT)
    .eq("folder_id", folderId);
  if (opts.shareId !== undefined) query = query.eq("share_id", opts.shareId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(`Load comments: ${error.message}`);
  return (data ?? []).map((r) => toComment(asRow(r)));
}

export async function listMyFolderComments(): Promise<FolderComment[]> {
  const { client, userId } = await requireSession();
  const { data, error } = await client
    .from("folder_comments")
    .select(COMMENT_SELECT)
    .eq("author_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Load your comments: ${error.message}`);
  return (data ?? []).map((r) => toComment(asRow(r)));
}

/**
 * Post a comment. Lazily ensures the caller's social profile first — it is the
 * `author_user_id` FK target and supplies the handle/name/avatar the UI renders.
 * Pass the caller's known identity (local share profile or signed-in account)
 * so a first-time commenter's profile is seeded in the same flow.
 */
export async function postFolderComment(input: {
  folderId: string;
  shareId?: string;
  body: string;
  profile?: { handle?: string; displayName?: string; avatarUrl?: string };
}): Promise<FolderComment> {
  const body = input.body.trim();
  if (!body) throw new Error("Comment can't be empty.");
  const { client, userId } = await requireSession();
  await ensureSocialProfile(input.profile ?? {});
  const { data, error } = await client
    .from("folder_comments")
    .insert({
      folder_id: input.folderId,
      share_id: input.shareId ?? null,
      author_user_id: userId,
      body,
    })
    .select(COMMENT_SELECT)
    .single();
  if (error) throw new Error(`Post comment: ${error.message}`);
  return toComment(asRow(data));
}

export async function editFolderComment(id: string, body: string): Promise<FolderComment> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comment can't be empty.");
  const { client } = await requireSession();
  const { data, error } = await client
    .from("folder_comments")
    .update({ body: trimmed })
    .eq("id", id)
    .select(COMMENT_SELECT)
    .single();
  if (error) throw new Error(`Edit comment: ${error.message}`);
  return toComment(asRow(data));
}

export async function deleteFolderComment(id: string): Promise<void> {
  const { client } = await requireSession();
  const { error } = await client.from("folder_comments").delete().eq("id", id);
  if (error) throw new Error(`Delete comment: ${error.message}`);
  return;
}

// ---------------------------------------------------------------------------
// Profile stats + activity heatmap — client-computed aggregates only. Writes
// go through security-definer RPCs scoped to the caller (see the profile
// dashboard migration); reads are open to any signed-in user.
// ---------------------------------------------------------------------------

export async function getProfileStats(userId: string): Promise<ProfileStats | null> {
  const { client } = await requireSession();
  const { data, error } = await client
    .from("profile_stats")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Load profile stats: ${error.message}`);
  return data ? toProfileStats(asRow(data)) : null;
}

export async function upsertMyProfileStats(input: {
  minutesWatched: number;
  completedCount: number;
  librariesOwned: number;
  postsCount: number;
  commentsGivenCount: number;
  commentsReceivedCount: number;
  friendsCount: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastActiveDay: string | null;
}): Promise<ProfileStats> {
  const { client } = await requireSession();
  const { data, error } = await client.rpc("upsert_profile_stats", {
    p_minutes_watched: input.minutesWatched,
    p_completed_count: input.completedCount,
    p_libraries_owned: input.librariesOwned,
    p_posts_count: input.postsCount,
    p_comments_given_count: input.commentsGivenCount,
    p_comments_received_count: input.commentsReceivedCount,
    p_friends_count: input.friendsCount,
    p_current_streak_days: input.currentStreakDays,
    p_longest_streak_days: input.longestStreakDays,
    p_last_active_day: input.lastActiveDay,
  });
  if (error) throw new Error(`Sync profile stats: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return toProfileStats(asRow(row));
}

export async function getActivityDays(
  userId: string,
  sinceDays = 365,
): Promise<ActivityDay[]> {
  const { client } = await requireSession();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await client
    .from("activity_days")
    .select("day, units")
    .eq("user_id", userId)
    .gte("day", since)
    .order("day", { ascending: true });
  if (error) throw new Error(`Load activity: ${error.message}`);
  return (data ?? []).map((r) => toActivityDay(asRow(r)));
}

export async function upsertMyActivityDays(
  days: { day: string; units: number }[],
): Promise<void> {
  if (days.length === 0) return;
  const { client } = await requireSession();
  const { error } = await client.rpc("upsert_activity_days", { p_days: days });
  if (error) throw new Error(`Sync activity: ${error.message}`);
}

export async function listBadgeDefs(): Promise<BadgeDef[]> {
  const { client } = await requireSession();
  const { data, error } = await client
    .from("badge_defs")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Load badges: ${error.message}`);
  return (data ?? []).map((r) => toBadgeDef(asRow(r)));
}

export async function listUserBadges(userId: string): Promise<UserBadge[]> {
  const { client } = await requireSession();
  const { data, error } = await client
    .from("user_badges")
    .select("badge_id, earned_at")
    .eq("user_id", userId);
  if (error) throw new Error(`Load earned badges: ${error.message}`);
  return (data ?? []).map((r) => toUserBadge(asRow(r)));
}

export async function awardBadge(badgeId: string): Promise<UserBadge> {
  const { client, userId } = await requireSession();
  const { data, error } = await client
    .from("user_badges")
    .insert({ user_id: userId, badge_id: badgeId })
    .select("badge_id, earned_at")
    .single();
  if (error) throw new Error(`Award badge: ${error.message}`);
  return toUserBadge(asRow(data));
}

/** Server-verified count — `folder_comments` read RLS is open to any signed-
 *  in user, so this is a live query rather than a self-reported number. */
export async function getCommentsGivenCount(userId: string): Promise<number> {
  const { client } = await requireSession();
  const { count, error } = await client
    .from("folder_comments")
    .select("id", { count: "exact", head: true })
    .eq("author_user_id", userId);
  if (error) throw new Error(`Count comments: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Avatar upload — Supabase Storage, replacing the local-only data URL so
// other users can actually see the picture on the public-ish dashboard.
// ---------------------------------------------------------------------------

const AVATAR_BUCKET = "avatars";

export async function uploadAvatar(blob: Blob): Promise<string> {
  const { client, userId } = await requireSession();
  const path = `${userId}/avatar.jpg`;
  const { error: uploadError } = await client.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (uploadError) throw new Error(`Upload avatar: ${uploadError.message}`);
  const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const cacheBusted = `${data.publicUrl}?v=${Date.now()}`;
  await ensureSocialProfile({ avatarUrl: cacheBusted });
  return cacheBusted;
}

export async function clearMyAvatarUrl(): Promise<void> {
  const { client, userId } = await requireSession();
  const { error } = await client
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", userId);
  if (error) throw new Error(`Remove avatar: ${error.message}`);
}
