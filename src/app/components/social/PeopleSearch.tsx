/**
 * PeopleSearch — find + follow + manage the people whose libraries you're
 * watching.
 *
 * Top half: a single-input "paste their Shared/ URL" form. The store does
 * the URL parse + first pull + dedup; this surface is just the affordance
 * and the inline error pill.
 *
 * Bottom half: the follow list. Each card has the author's avatar/initials,
 * handle, display name, last-sync state (from `syncStates`), a "View their
 * shelf" link (opens their Shared/ folder on Drive), and an Unfollow control.
 *
 * Future hook: P4.4 ships a discoverable bootstrap index — when present the
 * "Suggested" rail renders inline above the follow list.
 */

import { useState } from "react";
import cn from "classnames";
import {
  EmptyState,
  formatAgo,
} from "./InboxList";
import { useSocialStore } from "../../stores/social-store";
import type { FollowedUser } from "@shared/types";

export function PeopleSearch() {
  const followed = useSocialStore((s) => s.followedUsers);
  const follow = useSocialStore((s) => s.follow);
  const unfollow = useSocialStore((s) => s.unfollow);
  const syncStates = useSocialStore((s) => s.syncStates);
  const syncInbox = useSocialStore((s) => s.syncInbox);

  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

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

      <header className="ny-social-section-head">
        <h3 className="ny-shelf__title">Following</h3>
        <span className="ny-shelf__count">
          {followed.length} {followed.length === 1 ? "person" : "people"}
        </span>
      </header>

      {followed.length === 0 ? (
        <EmptyState
          title="No follows yet."
          sub="Paste a Shared/ folder URL above to start. Or wait for the bootstrap directory in P4.4 — you'll be able to discover users without a link."
        />
      ) : (
        <div className="ny-social-people-grid">
          {followed.map((f) => (
            <FollowCard
              key={f.sharedFolderId}
              user={f}
              syncState={syncStates[f.sharedFolderId]}
              onUnfollow={() => void unfollow(f.sharedFolderId)}
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
  onUnfollow,
}: {
  user: FollowedUser;
  syncState?: import("../../stores/social-store").FollowSyncState;
  onUnfollow: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const driveUrl = `https://drive.google.com/drive/folders/${user.sharedFolderId}`;
  const status = syncState?.status ?? "idle";

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
            status === "error"
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

      <div className="ny-follow-card__actions">
        <a
          href={driveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ny-share-row__btn"
        >
          View shelf
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
