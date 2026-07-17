/**
 * PostViewPage — `/posts/view/:folderId`. Read-only. No `canAccess` gate:
 * guests reach this page fine (`RequireAuth` lets guest sessions through),
 * and `readPost` itself works for them via `authedFetchRaw`'s API-key
 * fallback on link-public files — the same mechanism that makes any
 * "Anyone with the link" Drive file readable without an OAuth session.
 *
 * Renders through `PostRenderer` only — this file and everything it
 * imports must stay free of BlockNote so opening a post never pays the
 * editor's bundle cost.
 *
 * The like control is the one part of this page that touches Supabase
 * (`posts_index`/`post_likes`), and only for public posts viewed by a
 * signed-in (non-guest) account — guests keep reading the post itself via
 * the Drive link-public path above, untouched.
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@once-ui-system/core/components";
import cn from "classnames";
import { useAuth } from "@/auth/AuthProvider";
import { PageLoader } from "../components/PageLoader";
import { readPost } from "../services/posts";
import type { PostDoc } from "@shared/post-types";
import { PostRenderer } from "../components/posts/renderer/PostRenderer";
import { TableOfContents } from "../components/posts/renderer/TableOfContents";
import { resolveColor } from "../components/posts/renderer/colors";
import { formatAgo } from "../components/social/InboxList";
import {
  getMyLikedPostIds,
  getPostIndexEntry,
  likePost,
  unlikePost,
} from "../services/social/posts-discovery-api";
import { usePostsDiscoveryStore } from "../stores/posts-discovery-store";
import "./PostViewPage.scss";

export function PostViewPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const { canAccess } = useAuth();
  const [doc, setDoc] = useState<PostDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [likeCount, setLikeCount] = useState<number | null>(null);
  const [likedByMe, setLikedByMe] = useState(false);

  useEffect(() => {
    if (!folderId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    readPost(folderId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setError(
            "This post is unavailable — it may have been unpublished or deleted.",
          );
          setLoading(false);
          return;
        }
        setDoc(loaded);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load this post.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  useEffect(() => {
    // Both friends and public posts have a discovery-index pointer now
    // (posts-discovery-api.ts) — RLS returns null for a friends post the
    // viewer isn't an accepted friend of, so this degrades gracefully.
    const indexed = doc?.visibility === "friends" || doc?.visibility === "public";
    if (!doc || !indexed || !canAccess("social:profile")) return;
    let cancelled = false;
    Promise.all([
      getPostIndexEntry(doc.id).catch(() => null),
      getMyLikedPostIds([doc.id]).catch(() => new Set<string>()),
    ]).then(([entry, liked]) => {
      if (cancelled) return;
      setLikeCount(entry?.likeCount ?? 0);
      setLikedByMe(liked.has(doc.id));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, doc?.visibility]);

  function handleToggleLike() {
    if (!doc || likeCount === null) return;
    const postId = doc.id;
    const wasLiked = likedByMe;
    setLikedByMe(!wasLiked);
    setLikeCount((c) => Math.max(0, (c ?? 0) + (wasLiked ? -1 : 1)));
    const nextLiked = new Set(usePostsDiscoveryStore.getState().likedPostIds);
    if (wasLiked) nextLiked.delete(postId);
    else nextLiked.add(postId);
    usePostsDiscoveryStore.setState({ likedPostIds: nextLiked });
    const request = wasLiked ? unlikePost(postId) : likePost(postId);
    request.catch(() => {
      setLikedByMe(wasLiked);
      setLikeCount((c) => Math.max(0, (c ?? 0) + (wasLiked ? 1 : -1)));
    });
  }

  if (loading) {
    return <PageLoader />;
  }

  if (error || !doc) {
    return (
      <div className="ny-post-view-page">
        <Text
          variant="body-default-s"
          style={{ color: "var(--danger-on-background-strong, #ff8a8a)" }}
        >
          {error ?? "Not found."}
        </Text>
      </div>
    );
  }

  return (
    <article className="ny-post-view-page">
      <header
        className="ny-post-view-page__header"
        style={
          doc.accent
            ? { borderTop: `3px solid ${resolveColor(doc.accent, "text")}`, paddingTop: 14 }
            : undefined
        }
      >
        <h1>{doc.title}</h1>
        <div className="ny-post-view-page__meta">
          <span>{doc.author.name ?? `@${doc.author.handle}`}</span>
          <span aria-hidden="true">·</span>
          <span>{formatAgo(doc.publishedAt ?? doc.updatedAt)}</span>
          {likeCount !== null && (
            <button
              type="button"
              className={cn("ny-post-view-page__like", { "is-liked": likedByMe })}
              onClick={handleToggleLike}
              aria-pressed={likedByMe}
              aria-label={likedByMe ? "Unlike" : "Like"}
            >
              <span aria-hidden>{likedByMe ? "♥" : "♡"}</span>
              <span>{likeCount}</span>
            </button>
          )}
        </div>
        {doc.tags && doc.tags.length > 0 && (
          <div className="ny-post-view-page__tags">
            {doc.tags.map((tag) => (
              <span key={tag} className="ny-post-view-page__tag">
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>
      {doc.showToc && <TableOfContents blocks={doc.blocks} />}
      <PostRenderer blocks={doc.blocks} blockFonts={doc.blockFonts} />
    </article>
  );
}
