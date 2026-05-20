/**
 * InboxList — newest-first feed of shares from people the user follows.
 *
 * Information density follows nyaa.si's table-row pattern: one row per share,
 * with a fixed grid (poster · title+meta · kind · age · actions). Filters
 * along the top let the user narrow by unread / kind. The empty state is
 * actionable — a fresh user lands here first and we point them at People.
 *
 * Wiring: reads `inboxItems` straight from the social store. The store does
 * the per-follow pull + merge + unread computation; this component is purely
 * presentational + filter logic.
 *
 * Actions per row:
 *   - Open in Drive   → the *target's* Drive URL (the video file or library
 *                       folder), not the manifest file. Schema v=2 inlines
 *                       the full target in the index, so we have the real
 *                       fileId/folderId without a second fetch.
 *   - Import          → Drive-to-Drive copy into the recipient's Nyrima root.
 *   - Copy link       → clipboard the target Drive URL.
 *   - Mark read       → bumps `lastSeenEntryId` on the follow.
 */

import { useMemo, useState } from "react";
import cn from "classnames";
import { useSocialStore, type InboxItem } from "../../stores/social-store";
import type { ShareTarget } from "@shared/types";
import type { DriveImportResult } from "../../services/sharing";
import { Link } from "react-router-dom";
import { CommentComposerDialog } from "./CommentComposerDialog";

type Filter = "all" | "unread" | "videos" | "libraries";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "videos", label: "Videos" },
  { key: "libraries", label: "Libraries" },
];

export function InboxList() {
  const items = useSocialStore((s) => s.inboxItems);
  const followsCount = useSocialStore((s) => s.followedUsers.length);
  const syncing = useSocialStore((s) => s.syncing);
  const markAllRead = useSocialStore((s) => s.markAllRead);
  const unreadCount = useSocialStore((s) => s.unreadCount);

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === "unread" && !i.isUnread) return false;
      if (filter === "videos" && i.entry.target.kind !== "video") return false;
      if (filter === "libraries" && i.entry.target.kind !== "library") return false;
      if (q) {
        const t = (i.entry.title ?? "").toLowerCase();
        const h = i.author.handle.toLowerCase();
        if (!t.includes(q) && !h.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, query]);

  if (followsCount === 0) {
    return (
      <EmptyState
        title="You're not following anyone yet."
        sub="Head to People and paste a friend's Shared/ folder URL to start filling your inbox."
        cta={
          <Link to="/social/people" className="ny-social-cta">
            Find people →
          </Link>
        }
      />
    );
  }

  return (
    <section className="ny-social-pane">
      <div className="ny-social-pane__rail">
        <div className="ny-social-filterbar">
          <input
            type="search"
            placeholder="Filter inbox…"
            className="ny-social-filterbar__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter inbox"
          />
          <div className="ny-social-filterbar__chips" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={cn("ny-social-chip", {
                  "is-active": filter === f.key,
                })}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {f.key === "unread" && unreadCount > 0 && (
                  <span className="ny-social-chip__count">{unreadCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="ny-social-filterbar__actions">
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            disabled={unreadCount === 0}
            onClick={() => void markAllRead()}
          >
            Mark all read
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={
            syncing
              ? "Pulling fresh shares…"
              : items.length === 0
                ? "Your follows haven't shared anything yet."
                : "Nothing matches that filter."
          }
          sub={
            items.length === 0
              ? "Check back after they post — pull manually with the Sync button up top."
              : "Try clearing the search or switching back to All."
          }
        />
      ) : (
        <ShareTable
          header={
            <>
              <span className="ny-share-row__cell ny-share-row__cell--poster" aria-hidden />
              <span className="ny-share-row__cell ny-share-row__cell--title">Title · Author</span>
              <span className="ny-share-row__cell ny-share-row__cell--kind">Kind</span>
              <span className="ny-share-row__cell ny-share-row__cell--age">Posted</span>
              <span className="ny-share-row__cell ny-share-row__cell--actions" aria-hidden />
            </>
          }
        >
          {filtered.map((item) => (
            <InboxRow key={item.sourceFolderId + ":" + item.entry.id} item={item} />
          ))}
        </ShareTable>
      )}
    </section>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  const { entry, author } = item;
  const driveUrl = targetDriveUrl(entry.target);
  const markFollowRead = useSocialStore((s) => s.markFollowRead);
  const [commentOpen, setCommentOpen] = useState(false);

  return (
    <article
      className={cn("ny-share-row", {
        "is-unread": item.isUnread,
      })}
    >
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
          {item.isUnread && <span className="ny-share-row__new">NEW</span>}
          <span className="ny-share-row__title" title={entry.title}>
            {entry.title ?? "Untitled share"}
          </span>
        </div>
        <div className="ny-share-row__meta">
          <span className="ny-share-row__author">
            <span className="ny-share-row__author-name">
              {author.name ?? `@${author.handle}`}
            </span>
            <span className="ny-share-row__author-handle">@{author.handle}</span>
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
          onClick={() => void markFollowRead(item.sourceFolderId)}
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
        <ImportShareButton
          target={entry.target}
          title={entry.title}
          onImported={() => void markFollowRead(item.sourceFolderId)}
        />
        <button
          type="button"
          className="ny-share-row__btn ny-share-row__btn--ghost"
          onClick={() => {
            void navigator.clipboard.writeText(driveUrl);
          }}
          title="Copy Drive link"
        >
          Copy
        </button>
      </div>
      <CommentComposerDialog
        isOpen={commentOpen}
        onClose={() => setCommentOpen(false)}
        target={{
          sharedFolderId: item.sourceFolderId,
          shareId: entry.id,
          title: entry.title,
          authorHandle: author.handle,
        }}
      />
    </article>
  );
}

export function ImportShareButton({
  target,
  title,
  onImported,
}: {
  target: ShareTarget;
  title?: string;
  onImported?: (result: DriveImportResult) => void;
}) {
  const importShareTarget = useSocialStore((s) => s.importShareTarget);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DriveImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const label = pending ? "Importing" : result ? "Imported" : error ? "Retry" : "Import";
  const titleText = pending
    ? "Copying into your Nyrima Drive"
    : result
      ? summarizeImport(result)
      : error
        ? error
        : "Copy this share into your Nyrima Drive";

  async function handleClick() {
    if (pending) return;
    if (result) {
      window.open(
        targetDriveUrl({ kind: "library", folderId: result.destinationFolder.id }),
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      const imported = await importShareTarget({ target, title });
      setResult(imported);
      onImported?.(imported);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className="ny-share-row__btn ny-share-row__btn--ghost"
      onClick={() => void handleClick()}
      disabled={pending}
      title={titleText}
      aria-label={titleText}
    >
      {label}
    </button>
  );
}

function summarizeImport(result: DriveImportResult): string {
  const copied = `${result.copiedFiles.length} file${
    result.copiedFiles.length === 1 ? "" : "s"
  } copied`;
  if (result.failures.length === 0) {
    return `${copied}. Click to open the imported folder.`;
  }
  return `${copied}; ${result.failures.length} failed. Click to open the imported folder.`;
}

// ---------------------------------------------------------------------------
// Tiny shared bits used by all the social tabs.
// ---------------------------------------------------------------------------

export function ShareTable({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="ny-share-table">
      <header className="ny-share-row ny-share-row--head" role="presentation">
        {header}
      </header>
      <div className="ny-share-table__body">{children}</div>
    </div>
  );
}

export function KindBadge({ kind }: { kind: "video" | "library" }) {
  return (
    <span className={`ny-kind-badge ny-kind-badge--${kind}`}>
      {kind === "video" ? "VIDEO" : "LIBRARY"}
    </span>
  );
}

export function EmptyState({
  title,
  sub,
  cta,
}: {
  title: string;
  sub?: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="ny-social-empty">
      <span className="dc-tracker">EMPTY · NYRIMA</span>
      <p className="ny-social-empty__title">{title}</p>
      {sub && <p className="ny-social-empty__sub">{sub}</p>}
      {cta && <div className="ny-social-empty__cta">{cta}</div>}
    </div>
  );
}

/** Build a Drive viewer URL for the actual content the share points at —
 *  the video file for `kind: video`, the folder for `kind: library`.
 *  Used by InboxList + MyShares so the Open/Copy actions surface the
 *  thing the user actually wants to land on, not the manifest file. */
export function targetDriveUrl(target: ShareTarget): string {
  if (target.kind === "video") {
    return `https://drive.google.com/file/d/${target.fileId}/view`;
  }
  return `https://drive.google.com/drive/folders/${target.folderId}`;
}

export function formatAgo(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const delta = Date.now() - ts;
  if (delta < 60_000) return "just now";
  if (delta < 60 * 60_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.round(delta / 3_600_000)}h ago`;
  const days = Math.round(delta / (24 * 3_600_000));
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}
