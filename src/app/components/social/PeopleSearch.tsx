/**
 * PeopleSearch — find + follow + manage the people whose libraries you're
 * watching.
 *
 * Top: the paste-by-URL form. Below that, when the P4.4 directory has
 * entries the user isn't already following, the Discover rail renders
 * suggestion cards with one-click follow. Bottom: the active follow list
 * with View shelf / Drive / Unfollow per card.
 */

import { useEffect, useState } from "react";
import cn from "classnames";
import { Link } from "react-router-dom";
import {
  EmptyState,
  formatAgo,
} from "./InboxList";
import { useSocialStore } from "../../stores/social-store";
import type { DirectoryEntry, FollowedUser } from "@shared/types";

export function PeopleSearch() {
  const followed = useSocialStore((s) => s.followedUsers);
  const follow = useSocialStore((s) => s.follow);
  const unfollow = useSocialStore((s) => s.unfollow);
  const syncStates = useSocialStore((s) => s.syncStates);
  const syncInbox = useSocialStore((s) => s.syncInbox);
  const globalSyncing = useSocialStore((s) => s.syncing);
  const directoryEntries = useSocialStore((s) => s.directoryEntries);
  const directoryLoading = useSocialStore((s) => s.directoryLoading);
  const directoryLoaded = useSocialStore((s) => s.directoryLoaded);
  const loadDirectory = useSocialStore((s) => s.loadDirectory);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const suggestions = directoryEntries.filter(
    (e) => !followed.some((f) => f.sharedFolderId === e.folderId),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setPending(true);
    setError(null);
    setOkMsg(null);
    try {
      const fresh = await follow({ url });
      setOkMsg(`Following @${fresh.profile.handle}.`);
      setUrl("");
      // Kick a sync so the inbox tab populates without a tab switch.
      void syncInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to follow.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="ny-social-pane">
      <form className="ny-social-followform" onSubmit={submit}>
        <label htmlFor="ny-social-follow-url" className="ny-social-followform__label">
          Follow by Shared/ URL
        </label>
        <div className="ny-social-followform__row">
          <input
            id="ny-social-follow-url"
            type="text"
            inputMode="url"
            className="ny-social-followform__input"
            placeholder="https://drive.google.com/drive/folders/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={pending}
          />
          <button
            type="submit"
            className="ny-social-followform__submit"
            disabled={pending || !url.trim()}
          >
            {pending ? "Resolving…" : "Follow"}
          </button>
        </div>
        <p className="ny-social-followform__hint">
          Paste the URL of someone's <code>Shared/</code> folder. Their
          handle resolves automatically from their <code>index.json</code>.
        </p>
        {error && <p className="ny-social-followform__error">{error}</p>}
        {okMsg && <p className="ny-social-followform__ok">{okMsg}</p>}
      </form>

      <DiscoverRail
        suggestions={suggestions}
        loading={directoryLoading}
        loaded={directoryLoaded}
        directoryHasAny={directoryEntries.length > 0}
        onFollow={async (entry) => {
          // Reuse the same path as paste-by-URL — the folderId becomes
          // a synthetic Drive URL the store can parse.
          await follow({
            url: `https://drive.google.com/drive/folders/${entry.folderId}`,
          });
          void syncInbox();
        }}
        onRefresh={() => void loadDirectory({ force: true })}
      />

      <header className="ny-social-section-head">
        <h3 className="ny-shelf__title">Following</h3>
        <span className="ny-shelf__count">
          {followed.length} {followed.length === 1 ? "person" : "people"}
        </span>
      </header>

      {followed.length === 0 ? (
        <EmptyState
          title="No follows yet."
          sub="Paste a Shared/ folder URL above, or follow a suggested user from the Discover rail."
        />
      ) : (
        <div className="ny-social-people-grid">
          {followed.map((f) => (
            <FollowCard
              key={f.sharedFolderId}
              user={f}
              syncState={syncStates[f.sharedFolderId]}
              syncing={globalSyncing}
              onUnfollow={() => void unfollow(f.sharedFolderId)}
              onRetry={() => void syncInbox()}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FollowCard({
  user,
  syncState,
  syncing,
  onUnfollow,
  onRetry,
}: {
  user: FollowedUser;
  syncState?: import("../../stores/social-store").FollowSyncState;
  syncing: boolean;
  onUnfollow: () => void;
  onRetry: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const driveUrl = `https://drive.google.com/drive/folders/${user.sharedFolderId}`;
  const shelfRoute = `/social/shelf/${user.sharedFolderId}`;
  const status = syncState?.status ?? "idle";
  const isError = status === "error";

  return (
    <article className={cn("ny-follow-card", `is-${status}`)}>
      <div className="ny-follow-card__head">
        <div className="ny-follow-card__avatar">
          {user.profile.avatarUrl ? (
            <img
              src={user.profile.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="ny-follow-card__monogram">
              {(user.profile.name ?? user.profile.handle)[0]?.toUpperCase()}
            </span>
          )}
        </div>
        <div className="ny-follow-card__id">
          <span className="ny-follow-card__name">
            {user.profile.name ?? user.profile.handle}
          </span>
          <span className="ny-follow-card__handle">@{user.profile.handle}</span>
        </div>
        <span
          className={cn("ny-follow-card__pulse", `is-${status}`)}
          title={
            isError
              ? syncState?.error ?? "Last pull failed"
              : status === "syncing"
                ? "Pulling…"
                : status === "ok"
                  ? `${syncState?.pulledCount ?? 0} entries`
                  : "Idle"
          }
        />
      </div>

      <dl className="ny-follow-card__stats">
        <div>
          <dt>Followed</dt>
          <dd>{formatAgo(user.followedAt)}</dd>
        </div>
        <div>
          <dt>Last pull</dt>
          <dd>{user.lastPulledAt ? formatAgo(user.lastPulledAt) : "—"}</dd>
        </div>
      </dl>

      {isError && (
        <div className="ny-follow-card__error">
          <span className="ny-follow-card__error-text">
            {syncState?.error ?? "Last pull failed."}
          </span>
          <button
            type="button"
            className="ny-share-row__btn"
            onClick={onRetry}
            disabled={syncing}
          >
            {syncing ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      <div className="ny-follow-card__actions">
        <Link
          to={shelfRoute}
          className="ny-share-row__btn"
          title="Browse their shares inside Nyrima"
        >
          View shelf
        </Link>
        <a
          href={driveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ny-share-row__btn ny-share-row__btn--ghost"
          title="Open their Shared/ folder on Drive"
        >
          Drive
        </a>
        <button
          type="button"
          className={cn("ny-share-row__btn", "ny-share-row__btn--danger", {
            "is-armed": armed,
          })}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              window.setTimeout(() => setArmed(false), 3500);
              return;
            }
            onUnfollow();
          }}
        >
          {armed ? "Confirm?" : "Unfollow"}
        </button>
      </div>
    </article>
  );
}

function DiscoverRail({
  suggestions,
  loading,
  loaded,
  directoryHasAny,
  onFollow,
  onRefresh,
}: {
  suggestions: DirectoryEntry[];
  loading: boolean;
  loaded: boolean;
  /** Did the directory have any entries at all, even if all are already
   *  followed? Lets us distinguish "directory empty" from "all caught up". */
  directoryHasAny: boolean;
  onFollow: (entry: DirectoryEntry) => Promise<void>;
  onRefresh: () => void;
}) {
  if (!loaded && !loading) return null;
  return (
    <section className="ny-discover" aria-label="Suggested follows">
      <header className="ny-social-section-head">
        <h3 className="ny-shelf__title">Discover</h3>
        <div className="ny-discover__head-actions">
          <span className="ny-shelf__count">
            {loading && suggestions.length === 0
              ? "Loading…"
              : suggestions.length === 0
                ? directoryHasAny
                  ? "All caught up"
                  : "Directory empty"
                : `${suggestions.length} suggested`}
          </span>
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>
      {suggestions.length === 0 ? (
        <p className="ny-discover__empty">
          {directoryHasAny
            ? "You're already following every listed user. New entries land here as the directory grows."
            : "The Nyrima directory hasn't published any entries yet. Paste a Shared/ folder URL above to follow someone, or request your own listing from the Privacy tab."}
        </p>
      ) : (
        <div className="ny-discover__grid">
          {suggestions.map((e) => (
            <DiscoverCard key={e.handle} entry={e} onFollow={onFollow} />
          ))}
        </div>
      )}
    </section>
  );
}

function DiscoverCard({
  entry,
  onFollow,
}: {
  entry: DirectoryEntry;
  onFollow: (entry: DirectoryEntry) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fresh = isFresh(entry.addedAt);

  async function doFollow() {
    setPending(true);
    setError(null);
    try {
      await onFollow(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't follow.");
    } finally {
      setPending(false);
    }
  }

  return (
    <article className={cn("ny-discover-card", { "is-fresh": fresh })}>
      <div className="ny-follow-card__head">
        <div className="ny-follow-card__avatar">
          {entry.avatarUrl ? (
            <img src={entry.avatarUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="ny-follow-card__monogram">
              {(entry.name ?? entry.handle)[0]?.toUpperCase() ?? "?"}
            </span>
          )}
        </div>
        <div className="ny-follow-card__id">
          <span className="ny-follow-card__name">
            {entry.name ?? entry.handle}
          </span>
          <span className="ny-follow-card__handle">@{entry.handle}</span>
        </div>
        {fresh && <span className="ny-discover-card__fresh">NEW</span>}
      </div>

      {entry.bio && <p className="ny-discover-card__bio">{entry.bio}</p>}

      {entry.tags && entry.tags.length > 0 && (
        <div className="ny-discover-card__tags">
          {entry.tags.slice(0, 4).map((t) => (
            <span key={t} className="ny-discover-card__tag">
              {t}
            </span>
          ))}
        </div>
      )}

      {error && <p className="ny-social-followform__error">{error}</p>}

      <div className="ny-follow-card__actions">
        <button
          type="button"
          className="ny-share-row__btn"
          onClick={() => void doFollow()}
          disabled={pending}
        >
          {pending ? "Following…" : "Follow"}
        </button>
        <a
          href={`https://drive.google.com/drive/folders/${entry.folderId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ny-share-row__btn ny-share-row__btn--ghost"
        >
          Preview
        </a>
      </div>
    </article>
  );
}

/** A directory entry counts as "fresh" if it was added in the last 14
 *  days. Drives the NEW pill on the discover card. */
function isFresh(addedAt: string): boolean {
  const ts = Date.parse(addedAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < 14 * 24 * 60 * 60 * 1000;
}
