/**
 * FollowedShelf — read-only Nyrima view of someone else's shares.
 *
 * Mounted by SocialPage at `/social/shelf/:folderId`. Replaces the tab
 * content (Inbox/MyShares/etc.) with a focused list of the followed
 * user's entries, surfacing the same row affordances as InboxList:
 *   - Open    → target Drive URL (video file or library folder)
 *   - Import  → Drive-to-Drive copy into the recipient's Nyrima root
 *   - Copy    → clipboard the target URL
 *   - Comment → CommentComposerDialog targeting this share
 *
 * Data source: we lean on `inboxItems` from social-store, filtered to
 * entries with `sourceFolderId === folderId`. Trade-off: avoids a fresh
 * `readShareIndex` call when the global sync has already pulled them, but
 * means a brand-new follow needs a sync pass before the shelf populates.
 * The on-mount sync covers most cases; we also surface a Refresh button
 * so the user can re-pull on demand without leaving the page.
 *
 * Scope (P4.2 deliverable): followed users only. If the folderId doesn't
 * match a followed user we render a "Follow first" prompt and keep the
 * URL parseable — P4.4 will widen this to support arbitrary shelves.
 */

import { useEffect, useMemo, useState } from "react";
import cn from "classnames";
import { Link } from "react-router-dom";
import { useSocialStore } from "../../stores/social-store";
import {
  EmptyState,
  ImportShareButton,
  KindBadge,
  ShareTable,
  formatAgo,
  targetDriveUrl,
} from "./InboxList";
import { CommentComposerDialog } from "./CommentComposerDialog";
import type { ShareEntry } from "@shared/types";

interface Props {
  folderId: string;
}

export function FollowedShelf({ folderId }: Props) {
  const follow = useSocialStore((s) =>
    s.followedUsers.find((f) => f.sharedFolderId === folderId),
  );
  const items = useSocialStore((s) => s.inboxItems);
  const syncStates = useSocialStore((s) => s.syncStates);
  const syncing = useSocialStore((s) => s.syncing);
  const syncInbox = useSocialStore((s) => s.syncInbox);

  // Re-sync on first mount so a freshly-followed user's entries appear
  // even if the global inbox hasn't pulled them yet. syncInbox is gated
  // internally so this is cheap if a sync is already running.
  useEffect(() => {
    void syncInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shelfEntries = useMemo<ShareEntry[]>(() => {
    const list = items
      .filter((i) => i.sourceFolderId === folderId)
      .map((i) => i.entry);
    // Newest-first; same comparison as the store but defensive in case
    // the inbox order shifts.
    list.sort((a, b) => (a.sharedAt < b.sharedAt ? 1 : -1));
    return list;
  }, [items, folderId]);

  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shelfEntries;
    return shelfEntries.filter((e) =>
      (e.title ?? "").toLowerCase().includes(q),
    );
  }, [shelfEntries, query]);

  if (!follow) {
    return (
      <section className="ny-social-pane">
        <BackLink />
        <EmptyState
          title="You're not following that user yet."
          sub="Open the People tab to follow them by URL. Once you do, their shelf appears here."
          cta={
            <Link to="/social/people" className="ny-social-cta">
              Go to People →
            </Link>
          }
        />
      </section>
    );
  }

  const state = syncStates[folderId];
  const headerAvatar = follow.profile.avatarUrl;

  return (
    <section className="ny-social-pane">
      <BackLink />

      <header className="ny-shelf-header">
        <div className="ny-shelf-header__avatar">
          {headerAvatar ? (
            <img src={headerAvatar} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span>
              {(follow.profile.name ?? follow.profile.handle)[0]?.toUpperCase() ?? "?"}
            </span>
          )}
        </div>
        <div className="ny-shelf-header__id">
          <h2 className="ny-shelf-header__name">
            {follow.profile.name ?? follow.profile.handle}
          </h2>
          <span className="ny-shelf-header__handle">@{follow.profile.handle}</span>
          <span className="ny-shelf-header__meta">
            {shelfEntries.length}{" "}
            {shelfEntries.length === 1 ? "share" : "shares"}
            {follow.lastPulledAt
              ? ` · pulled ${formatAgo(follow.lastPulledAt)}`
              : ""}
          </span>
        </div>
        <div className="ny-shelf-header__actions">
          <a
            href={`https://drive.google.com/drive/folders/${folderId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ny-shelf-link__btn ny-shelf-link__btn--ghost"
          >
            Open on Drive
          </a>
          <button
            type="button"
            className="ny-shelf-link__btn"
            onClick={() => void syncInbox()}
            disabled={syncing}
          >
            {syncing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {state?.status === "error" && (
        <p className="ny-social-followform__error" role="status">
          Last sync failed{state.error ? ` — ${state.error}` : "."}
        </p>
      )}

      <div className="ny-social-pane__rail">
        <div className="ny-social-filterbar">
          <input
            type="search"
            className="ny-social-filterbar__input"
            placeholder={`Filter @${follow.profile.handle}'s shares…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter shelf"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={
            shelfEntries.length === 0
              ? syncing
                ? "Pulling their shares…"
                : "They haven't shared anything yet."
              : "Nothing matches that filter."
          }
        />
      ) : (
        <ShareTable
          header={
            <>
              <span className="ny-share-row__cell ny-share-row__cell--poster" aria-hidden />
              <span className="ny-share-row__cell ny-share-row__cell--title">Title</span>
              <span className="ny-share-row__cell ny-share-row__cell--kind">Kind</span>
              <span className="ny-share-row__cell ny-share-row__cell--age">Posted</span>
              <span className="ny-share-row__cell ny-share-row__cell--actions" aria-hidden />
            </>
          }
        >
          {filtered.map((entry) => (
            <ShelfRow
              key={entry.id}
              entry={entry}
              sharedFolderId={folderId}
              authorHandle={follow.profile.handle}
            />
          ))}
        </ShareTable>
      )}
    </section>
  );
}

function ShelfRow({
  entry,
  sharedFolderId,
  authorHandle,
}: {
  entry: ShareEntry;
  sharedFolderId: string;
  authorHandle: string;
}) {
  const driveUrl = targetDriveUrl(entry.target);
  const [commentOpen, setCommentOpen] = useState(false);

  return (
    <article className={cn("ny-share-row")}>
      <div className="ny-share-row__cell ny-share-row__cell--poster">
        {entry.posterUrl ? (
          <img
            src={entry.posterUrl}
            alt=""
            className="ny-share-row__poster"
            loading="lazy"
          />
        ) : (
          <span className="ny-share-row__poster ny-share-row__poster--fallback">
            {(entry.title ?? "?")[0]?.toUpperCase()}
          </span>
        )}
      </div>

      <div className="ny-share-row__cell ny-share-row__cell--title">
        <div className="ny-share-row__title-row">
          <span className="ny-share-row__title" title={entry.title}>
            {entry.title ?? "Untitled share"}
          </span>
        </div>
        {entry.caption && (
          <div className="ny-share-row__meta">
            <span className="ny-share-row__caption">{entry.caption}</span>
          </div>
        )}
      </div>

      <div className="ny-share-row__cell ny-share-row__cell--kind">
        <KindBadge kind={entry.target.kind} />
      </div>

      <div
        className="ny-share-row__cell ny-share-row__cell--age"
        title={new Date(entry.sharedAt).toLocaleString()}
      >
        {formatAgo(entry.sharedAt)}
      </div>

      <div className="ny-share-row__cell ny-share-row__cell--actions">
        <a
          href={driveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ny-share-row__btn"
        >
          Open
        </a>
        <button
          type="button"
          className="ny-share-row__btn ny-share-row__btn--ghost"
          onClick={() => setCommentOpen(true)}
          title="Reply with a comment"
        >
          Comment
        </button>
        <ImportShareButton target={entry.target} title={entry.title} />
        <button
          type="button"
          className="ny-share-row__btn ny-share-row__btn--ghost"
          onClick={() => void navigator.clipboard.writeText(driveUrl)}
          title="Copy Drive link"
        >
          Copy
        </button>
      </div>
      <CommentComposerDialog
        isOpen={commentOpen}
        onClose={() => setCommentOpen(false)}
        target={{
          sharedFolderId,
          shareId: entry.id,
          title: entry.title,
          authorHandle,
        }}
      />
    </article>
  );
}

function BackLink() {
  return (
    <Link to="/social/people" className="ny-shelf-header__back">
      ← Back to People
    </Link>
  );
}
