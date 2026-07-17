/**
 * PostCard — feed/grid card for a post announcement. Same thumbnail-load
 * pattern as `PosterCard` (skeleton shimmer, lazy `<img>`, `is-loaded`
 * fade-in) so the Posts feed reads as part of the same visual system as
 * the library grid, just for text-first content instead of video.
 */

import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import { NyrimaMark } from "../NyrimaMark";
import { formatAgo } from "../social/InboxList";
import "./PostCard.scss";

interface Props {
  folderId: string;
  title: string;
  excerpt?: string;
  posterUrl?: string;
  authorHandle: string;
  authorName?: string;
  publishedAt: string;
  tags?: string[];
  /** Path to navigate to on click. Defaults to the read-only view route —
   *  "My Posts" overrides this to the editor route so drafts open for
   *  editing instead of (harmlessly, but pointlessly) the reader. */
  linkTo?: string;
  /** Like affordance — omitted entirely (no heart control rendered) unless
   *  the caller supplies both `postId` and `onToggleLike`. Only the Popular
   *  tab wires this up today (see `PostsFeedPage.tsx`); "Following"/"My
   *  posts" cards render exactly as before. */
  postId?: string;
  likeCount?: number;
  likedByMe?: boolean;
  onToggleLike?: (postId: string) => void;
}

export const PostCard = memo(function PostCard({
  folderId,
  title,
  excerpt,
  posterUrl,
  authorHandle,
  authorName,
  publishedAt,
  tags,
  linkTo,
  postId,
  likeCount,
  likedByMe,
  onToggleLike,
}: Props) {
  const navigate = useNavigate();
  const [imgLoaded, setImgLoaded] = useState(false);

  function handleClick() {
    navigate(linkTo ?? `/posts/view/${encodeURIComponent(folderId)}`);
  }

  const showLike = !!postId && !!onToggleLike;

  function handleLikeClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (postId) onToggleLike?.(postId);
  }

  return (
    <div
      className={cn("ny-post-card", "ny-focusable")}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={title}
    >
      <div className="ny-post-card__frame">
        {posterUrl ? (
          <>
            <img
              src={posterUrl}
              alt=""
              className={cn("ny-post-card__img", { "is-loaded": imgLoaded })}
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
            />
            {!imgLoaded && <div className="ny-post-card__skeleton ny-shimmer" />}
          </>
        ) : (
          <div className="ny-post-card__fallback">
            <NyrimaMark size="hero" />
          </div>
        )}
      </div>

      <div className="ny-post-card__body">
        <div className="ny-post-card__title" title={title}>
          {title}
        </div>
        {excerpt && <p className="ny-post-card__excerpt">{excerpt}</p>}
        <div className="ny-post-card__meta">
          <span className="ny-post-card__author">
            {authorName ?? `@${authorHandle}`}
          </span>
          <span className="ny-post-card__dot" aria-hidden>
            ·
          </span>
          <span>{formatAgo(publishedAt)}</span>
          {showLike && (
            <button
              type="button"
              className={cn("ny-post-card__like", { "is-liked": likedByMe })}
              onClick={handleLikeClick}
              aria-pressed={!!likedByMe}
              aria-label={likedByMe ? "Unlike" : "Like"}
            >
              <span aria-hidden>{likedByMe ? "♥" : "♡"}</span>
              {typeof likeCount === "number" && <span>{likeCount}</span>}
            </button>
          )}
        </div>
        {tags && tags.length > 0 && (
          <div className="ny-post-card__tags">
            {tags.slice(0, 4).map((tag) => (
              <span key={tag} className="ny-post-card__tag">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
