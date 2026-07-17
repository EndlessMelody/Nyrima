/**
 * posts-discovery-api — the frontend link to `posts_index` / `post_likes`.
 *
 * Same shape as `social-api.ts`: a thin typed wrapper over
 * `getSupabaseClient()`, RLS does the authorization. This is the ONLY place
 * Posts content touches Supabase — everything else in `services/posts/` is
 * Drive-only by design (see that module's docs). `posts_index` rows are
 * pointers (title/excerpt/cover/author/like count) to a Drive-hosted post,
 * never the post body itself, mirroring how `folder_comments` points at a
 * Drive folder id rather than owning its contents.
 *
 * Both friends and public posts get indexed here now (`visibility` column) —
 * RLS scopes a friends row to accepted friends of the author, a public row to
 * any signed-in user (see the migration). Draft/private posts are never
 * indexed — callers (see `posts-store.ts`) upsert on publish and remove on
 * unpublish/make-private/delete.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import { SocialAuthRequiredError } from "./social-api";

export type PostIndexVisibility = "friends" | "public";

export interface PostIndexEntry {
  postId: string;
  folderId: string;
  authorUserId: string;
  authorHandle: string;
  authorName?: string;
  title: string;
  excerpt?: string;
  posterUrl?: string;
  tags: string[];
  visibility: PostIndexVisibility;
  likeCount: number;
  publishedAt: number;
  updatedAt: number;
}

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

function toIndexEntry(row: Record<string, unknown>): PostIndexEntry {
  const published = toEpoch(row.published_at);
  const author = asRow(row.author);
  return {
    postId: String(row.post_id),
    folderId: String(row.folder_id),
    authorUserId: String(row.author_user_id),
    authorHandle: typeof author.handle === "string" ? author.handle : "",
    authorName: optStr(author.display_name),
    title: String(row.title ?? ""),
    excerpt: optStr(row.excerpt),
    posterUrl: optStr(row.poster_url),
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [],
    visibility: row.visibility === "friends" ? "friends" : "public",
    likeCount: Number(row.like_count ?? 0),
    publishedAt: published,
    updatedAt: toEpoch(row.updated_at, published),
  };
}

// `author:profiles(...)` embeds the profile via the author_user_id FK, same
// pattern as `social-api.ts`'s COMMENT_SELECT.
const INDEX_SELECT =
  "post_id, folder_id, author_user_id, title, excerpt, poster_url, tags, visibility, like_count, published_at, updated_at, author:profiles(handle, display_name)";

/**
 * Upsert (create or update) the discovery-index row for a published PUBLIC
 * post. Called by `posts-store.ts` right after `publishPost()` succeeds with
 * `visibility === "public"`. Best-effort by convention at the call site —
 * Drive remains authoritative even if this fails.
 */
export async function upsertPostIndexEntry(input: {
  postId: string;
  folderId: string;
  title: string;
  excerpt?: string;
  posterUrl?: string;
  tags?: string[];
  visibility: PostIndexVisibility;
  publishedAt: string;
  updatedAt: string;
}): Promise<void> {
  const { client, userId } = await requireSession();
  const { error } = await client.from("posts_index").upsert(
    {
      post_id: input.postId,
      folder_id: input.folderId,
      author_user_id: userId,
      title: input.title,
      excerpt: input.excerpt ?? null,
      poster_url: input.posterUrl ?? null,
      tags: input.tags ?? [],
      visibility: input.visibility,
      published_at: input.publishedAt,
      updated_at: input.updatedAt,
    },
    { onConflict: "post_id" },
  );
  if (error) throw new Error(`Index post: ${error.message}`);
}

/** Drop a post from the discovery index (unpublish, delete, or downgrade to
 *  friends-only). Cascades the row's `post_likes`. */
export async function removePostIndexEntry(postId: string): Promise<void> {
  const { client } = await requireSession();
  const { error } = await client.from("posts_index").delete().eq("post_id", postId);
  if (error) throw new Error(`Unindex post: ${error.message}`);
}

/** Single-post lookup — used by `PostViewPage` to show a like count/state
 *  for a post opened directly by link rather than from the Popular tab. */
export async function getPostIndexEntry(postId: string): Promise<PostIndexEntry | null> {
  const { client } = await requireSession();
  const { data, error } = await client
    .from("posts_index")
    .select(INDEX_SELECT)
    .eq("post_id", postId)
    .maybeSingle();
  if (error) throw new Error(`Load post: ${error.message}`);
  return data ? toIndexEntry(asRow(data)) : null;
}

// Popular/Recent are explicitly public-only — RLS would also let friends
// rows the caller has access to through, but "Popular"/"Recent" mean the
// open discovery surface, not "everything I'm allowed to see."
export async function listPopularPosts(limit = 60): Promise<PostIndexEntry[]> {
  const { client } = await requireSession();
  const { data, error } = await client
    .from("posts_index")
    .select(INDEX_SELECT)
    .eq("visibility", "public")
    .order("like_count", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Load popular posts: ${error.message}`);
  return (data ?? []).map((r) => toIndexEntry(asRow(r)));
}

export async function listRecentPublicPosts(limit = 60): Promise<PostIndexEntry[]> {
  const { client } = await requireSession();
  const { data, error } = await client
    .from("posts_index")
    .select(INDEX_SELECT)
    .eq("visibility", "public")
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Load recent posts: ${error.message}`);
  return (data ?? []).map((r) => toIndexEntry(asRow(r)));
}

export async function likePost(postId: string): Promise<void> {
  const { client, userId } = await requireSession();
  const { error } = await client.from("post_likes").insert({ user_id: userId, post_id: postId });
  // A duplicate like (already-liked, e.g. a double-click race) is a benign
  // no-op — the unique(user_id, post_id) constraint is what caught it.
  if (error && error.code !== "23505") throw new Error(`Like post: ${error.message}`);
}

export async function unlikePost(postId: string): Promise<void> {
  const { client, userId } = await requireSession();
  const { error } = await client
    .from("post_likes")
    .delete()
    .eq("user_id", userId)
    .eq("post_id", postId);
  if (error) throw new Error(`Unlike post: ${error.message}`);
}

/** Which of `postIds` the caller has already liked — for hydrating heart
 *  state on a freshly-loaded feed. */
export async function getMyLikedPostIds(postIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(postIds.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const { client, userId } = await requireSession();
  const { data, error } = await client
    .from("post_likes")
    .select("post_id")
    .eq("user_id", userId)
    .in("post_id", unique);
  if (error) throw new Error(`Load liked posts: ${error.message}`);
  return new Set((data ?? []).map((r) => String(asRow(r).post_id)));
}
