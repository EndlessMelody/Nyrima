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

export interface SocialProfile {
  id: string;
  handle: string | null;
  displayName: string;
  avatarUrl?: string;
  createdAt: number;
  updatedAt: number;
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

function toProfile(row: Record<string, unknown>): SocialProfile {
  const created = toEpoch(row.created_at);
  return {
    id: String(row.id),
    handle: typeof row.handle === "string" ? row.handle : null,
    displayName: String(row.display_name ?? ""),
    avatarUrl: optStr(row.avatar_url),
    createdAt: created,
    updatedAt: toEpoch(row.updated_at, created),
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
}
