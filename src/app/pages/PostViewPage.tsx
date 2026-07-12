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
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@once-ui-system/core/components";
import { readPost } from "../services/posts";
import type { PostDoc } from "@shared/post-types";
import { PostRenderer } from "../components/posts/renderer/PostRenderer";
import { formatAgo } from "../components/social/InboxList";
import "./PostViewPage.scss";

export function PostViewPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const [doc, setDoc] = useState<PostDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <div className="ny-post-view-page">
        <Text variant="body-default-s" onBackground="neutral-weak">
          Loading…
        </Text>
      </div>
    );
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
      <header className="ny-post-view-page__header">
        <h1>{doc.title}</h1>
        <div className="ny-post-view-page__meta">
          <span>{doc.author.name ?? `@${doc.author.handle}`}</span>
          <span aria-hidden="true">·</span>
          <span>{formatAgo(doc.publishedAt ?? doc.updatedAt)}</span>
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
      <PostRenderer blocks={doc.blocks} />
    </article>
  );
}
