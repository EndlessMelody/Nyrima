/**
 * ActivityFeed — comment activity on shares.
 *
 * Two strands rendered in one stream, switchable with chips:
 *
 *   - "Received" (default) — comments people you follow have written on
 *     YOUR shares. Aggregated by `loadReceivedComments()` which fetches
 *     every followed user's `comments.jsonl` in parallel and filters to
 *     `sharedFolderId === my-folder-id`. Grouped by `shareId` so the user
 *     can see "who said what about this share".
 *
 *   - "Sent" — comments YOU have written. Read straight from your own
 *     `comments.jsonl`. Useful for "did that comment actually land?" plus
 *     "where did I leave that thought last week?".
 *
 * Only mutual-follow comments surface (people you follow). Drive-based
 * decentralization means we don't have a discovery primitive for "this
 * stranger commented on my share" — that lands when the bootstrap
 * directory ships in P4.4.
 *
 * Auto-pull: visiting the tab triggers a fresh aggregate. The store gates
 * concurrent calls so a tab-switch back-and-forth doesn't fan out reads.
 */

import { useEffect, useMemo, useState } from "react";
import cn from "classnames";
import { useSocialStore } from "../../stores/social-store";
import { EmptyState, formatAgo } from "./InboxList";
import type { ShareComment } from "@shared/types";

type Strand = "received" | "sent";

export function ActivityFeed() {
  const followedUsers = useSocialStore((s) => s.followedUsers);
  const myIndex = useSocialStore((s) => s.myIndex);
  const loadMyIndex = useSocialStore((s) => s.loadMyIndex);
  const myIndexLoaded = useSocialStore((s) => s.myIndexLoaded);
  const receivedComments = useSocialStore((s) => s.receivedComments);
  const myComments = useSocialStore((s) => s.myComments);
  const loading = useSocialStore((s) => s.commentsLoading);
  const error = useSocialStore((s) => s.commentsError);
  const lastSyncedAt = useSocialStore((s) => s.lastCommentsSyncedAt);
  const loadReceived = useSocialStore((s) => s.loadReceivedComments);
  const loadMine = useSocialStore((s) => s.loadMyComments);

  const [strand, setStrand] = useState<Strand>("received");

  // First-visit pulls. The store dedupes concurrent calls so the chip
  // switcher below can call again without worrying.
  useEffect(() => {
    if (!myIndexLoaded) void loadMyIndex();
  }, [myIndexLoaded, loadMyIndex]);
  useEffect(() => {
    void loadReceived();
    void loadMine();
    // intentionally one-shot on mount; refresh via the button below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const receivedGroups = useMemo(() => {
    const groups: Array<{
      shareId: string;
      title: string;
      posterUrl?: string;
      comments: ShareComment[];
    }> = [];
    if (!myIndex) return groups;
    const titleByShareId = new Map(
      myIndex.entries.map((e) => [e.id, e] as const),
    );
    for (const [shareId, comments] of Object.entries(receivedComments)) {
      if (comments.length === 0) continue;
      const entry = titleByShareId.get(shareId);
      groups.push({
        shareId,
        title: entry?.title ?? "(unknown share)",
        posterUrl: entry?.posterUrl,
        comments,
      });
    }
    // Newest activity first — sort by each group's most recent comment.
    groups.sort((a, b) =>
      (a.comments[0]?.at ?? "") < (b.comments[0]?.at ?? "") ? 1 : -1,
    );
    return groups;
  }, [myIndex, receivedComments]);

  const receivedCount = useMemo(
    () =>
      Object.values(receivedComments).reduce((n, list) => n + list.length, 0),
    [receivedComments],
  );

  return (
    <section className="ny-social-pane">
      <div className="ny-social-pane__rail">
        <div className="ny-social-filterbar">
          <div className="ny-social-filterbar__chips" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={strand === "received"}
              className={cn("ny-social-chip", { "is-active": strand === "received" })}
              onClick={() => setStrand("received")}
            >
              Received
              {receivedCount > 0 && (
                <span className="ny-social-chip__count">{receivedCount}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={strand === "sent"}
              className={cn("ny-social-chip", { "is-active": strand === "sent" })}
              onClick={() => setStrand("sent")}
            >
              Sent
              {myComments.length > 0 && (
                <span className="ny-social-chip__count">{myComments.length}</span>
              )}
            </button>
          </div>
        </div>
        <div className="ny-social-filterbar__actions">
          <span className="ny-social-filterbar__count">
            {loading
              ? "Refreshing…"
              : lastSyncedAt
                ? `Synced ${formatAgoTs(lastSyncedAt)}`
                : "Not synced"}
          </span>
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            disabled={loading}
            onClick={() => {
              void loadReceived();
              void loadMine();
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="ny-social-followform__error" role="status">
          {error}
        </p>
      )}

      {strand === "received" ? (
        followedUsers.length === 0 ? (
          <EmptyState
            title="Follow people to receive comments."
            sub="Only mutual follows can surface here for now. P4.4's bootstrap directory will widen the net."
          />
        ) : receivedGroups.length === 0 ? (
          <EmptyState
            title={
              loading
                ? "Pulling comment threads…"
                : "No comments on your shares yet."
            }
            sub={
              !myIndex || myIndex.entries.length === 0
                ? "Publish a share first — comments need something to land on."
                : "When someone you follow comments on one of your shares, it'll show up here."
            }
          />
        ) : (
          <div className="ny-activity-stream">
            {receivedGroups.map((group) => (
              <ReceivedThread key={group.shareId} group={group} />
            ))}
          </div>
        )
      ) : myComments.length === 0 ? (
        <EmptyState
          title={loading ? "Reading your comments…" : "You haven't commented yet."}
          sub="Hit Comment on any inbox row to start a thread."
        />
      ) : (
        <div className="ny-activity-stream">
          {myComments.map((c) => (
            <SentRow key={c.id} comment={c} />
          ))}
        </div>
      )}
    </section>
  );
}

function ReceivedThread({
  group,
}: {
  group: {
    shareId: string;
    title: string;
    posterUrl?: string;
    comments: ShareComment[];
  };
}) {
  return (
    <article className="ny-activity-thread">
      <header className="ny-activity-thread__head">
        {group.posterUrl ? (
          <img
            src={group.posterUrl}
            alt=""
            className="ny-activity-thread__poster"
            loading="lazy"
          />
        ) : (
          <span className="ny-activity-thread__poster ny-activity-thread__poster--fallback">
            {(group.title[0] ?? "?").toUpperCase()}
          </span>
        )}
        <div className="ny-activity-thread__title-block">
          <span className="ny-activity-thread__title">{group.title}</span>
          <span className="ny-activity-thread__count">
            {group.comments.length}{" "}
            {group.comments.length === 1 ? "comment" : "comments"}
          </span>
        </div>
      </header>
      <ul className="ny-activity-thread__list">
        {group.comments.map((c) => (
          <CommentLine key={c.id} comment={c} />
        ))}
      </ul>
    </article>
  );
}

function SentRow({ comment }: { comment: ShareComment }) {
  return (
    <article className="ny-activity-thread ny-activity-thread--sent">
      <header className="ny-activity-thread__head">
        <span className="ny-activity-thread__poster ny-activity-thread__poster--fallback">
          ↗
        </span>
        <div className="ny-activity-thread__title-block">
          <span className="ny-activity-thread__title">
            on {shortShareId(comment.shareId)}
          </span>
          <span className="ny-activity-thread__count">
            {formatAgo(comment.at)} · @
            {shortFolderId(comment.sharedFolderId)}
          </span>
        </div>
      </header>
      <ul className="ny-activity-thread__list">
        <CommentLine comment={comment} />
      </ul>
    </article>
  );
}

function CommentLine({ comment }: { comment: ShareComment }) {
  return (
    <li className="ny-activity-line">
      <div className="ny-activity-line__avatar">
        {comment.author.avatarUrl ? (
          <img src={comment.author.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span>{(comment.author.handle[0] ?? "?").toUpperCase()}</span>
        )}
      </div>
      <div className="ny-activity-line__body">
        <div className="ny-activity-line__meta">
          <span className="ny-activity-line__name">
            {comment.author.name ?? `@${comment.author.handle}`}
          </span>
          <span className="ny-activity-line__handle">@{comment.author.handle}</span>
          <span
            className="ny-activity-line__at"
            title={new Date(comment.at).toLocaleString()}
          >
            {formatAgo(comment.at)}
          </span>
        </div>
        <p className="ny-activity-line__text">{comment.text}</p>
      </div>
    </li>
  );
}

function formatAgoTs(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 30_000) return "just now";
  if (delta < 60 * 60_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / (24 * 3_600_000))}d ago`;
}

function shortShareId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function shortFolderId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 6)}…` : id;
}
