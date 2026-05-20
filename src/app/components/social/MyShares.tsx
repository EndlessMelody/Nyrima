/**
 * MyShares — the user's own published shares.
 *
 * Reads from `social-store.myIndex` (their own `Shared/index.json`). Each row
 * mirrors the Inbox layout but the action cluster is different:
 *
 *   - Open in Drive  → the entry JSON URL.
 *   - Copy link      → useful to paste somewhere else.
 *   - Unshare        → confirmation pill → store.unshare(id). Removes from
 *                      index *first* (so followers stop seeing it) then
 *                      trashes the entry file (best-effort).
 *
 * The unshare flow uses a two-step "press to confirm" on the same button so
 * we don't ship a confirm modal for a recoverable action — Drive keeps the
 * trashed entry for 30 days. The row visually fades during pending state.
 */

import { useMemo, useState } from "react";
import cn from "classnames";
import { useSocialStore } from "../../stores/social-store";
import { useSharingStore } from "../../stores/sharing-store";
import {
  EmptyState,
  KindBadge,
  ShareTable,
  formatAgo,
  targetDriveUrl,
} from "./InboxList";

export function MyShares() {
  const myIndex = useSocialStore((s) => s.myIndex);
  const loaded = useSocialStore((s) => s.myIndexLoaded);
  const loading = useSocialStore((s) => s.myIndexLoading);
  const error = useSocialStore((s) => s.myIndexError);
  const loadMyIndex = useSocialStore((s) => s.loadMyIndex);
  const profile = useSharingStore((s) => s.profile);

  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!myIndex) return [];
    const q = query.trim().toLowerCase();
    if (!q) return myIndex.entries;
    return myIndex.entries.filter((e) =>
      (e.title ?? "").toLowerCase().includes(q),
    );
  }, [myIndex, query]);

  if (!profile) {
    return (
      <EmptyState
        title="Pick a share handle first."
        sub="Click Share in the topbar to set your @handle. Your published shares show up here once you've posted one."
      />
    );
  }
  if (loading && !loaded) {
    return (
      <EmptyState
        title="Reading your index from Drive…"
        sub="One file: Shared/index.json"
      />
    );
  }
  if (error) {
    return (
      <EmptyState
        title="Couldn't load your shares."
        sub={error}
        cta={
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={() => void loadMyIndex({ force: true })}
          >
            Try again
          </button>
        }
      />
    );
  }
  if (!myIndex || myIndex.entries.length === 0) {
    return (
      <EmptyState
        title="You haven't shared anything yet."
        sub="Open a library or play a video, then hit Share in the topbar to publish it to your Shared/ folder."
      />
    );
  }

  return (
    <section className="ny-social-pane">
      <div className="ny-social-pane__rail">
        <div className="ny-social-filterbar">
          <input
            type="search"
            placeholder="Filter your shares…"
            className="ny-social-filterbar__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter my shares"
          />
        </div>
        <div className="ny-social-filterbar__actions">
          <span className="ny-social-filterbar__count">
            {myIndex.entries.length}{" "}
            {myIndex.entries.length === 1 ? "share" : "shares"}
          </span>
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={() => void loadMyIndex({ force: true })}
          >
            Refresh
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Nothing matches that filter." />
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
            <MyShareRow key={entry.id} entry={entry} />
          ))}
        </ShareTable>
      )}
    </section>
  );
}

function MyShareRow({
  entry,
}: {
  entry: import("@shared/types").ShareEntry;
}) {
  const unshare = useSocialStore((s) => s.unshare);
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const driveUrl = targetDriveUrl(entry.target);

  async function doUnshare() {
    if (!armed) {
      setArmed(true);
      // Auto-disarm after a few seconds so the click doesn't stay loaded.
      window.setTimeout(() => setArmed(false), 3500);
      return;
    }
    setPending(true);
    try {
      await unshare(entry.id);
    } finally {
      setPending(false);
      setArmed(false);
    }
  }

  return (
    <article className={cn("ny-share-row", { "is-pending": pending })}>
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
          <span className="ny-share-row__title">{entry.title ?? "Untitled share"}</span>
        </div>
        <div className="ny-share-row__meta">
          <span className="ny-share-row__author-handle">
            {entry.id.slice(0, 8)}…
          </span>
        </div>
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
          onClick={() => void navigator.clipboard.writeText(driveUrl)}
          title="Copy Drive link"
        >
          Copy
        </button>
        <button
          type="button"
          className={cn("ny-share-row__btn", "ny-share-row__btn--danger", {
            "is-armed": armed,
          })}
          onClick={() => void doUnshare()}
          disabled={pending}
        >
          {pending ? "Unsharing…" : armed ? "Confirm?" : "Unshare"}
        </button>
      </div>
    </article>
  );
}
