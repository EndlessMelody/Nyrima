/**
 * Post Sharing — default visibility for new posts, plus a manager for
 * currently friends/public posts (unpublish/change visibility without
 * opening each post's editor). The share handle itself lives in
 * PublicProfileSection; this section assumes one is already picked (the
 * empty state below points there when it isn't).
 */

import { useEffect, useState } from "react";
import cn from "classnames";
import { Link } from "react-router-dom";
import { useSharingStore } from "@app/stores/sharing-store";
import { usePostsStore, type MyPostSummary } from "@app/stores/posts-store";
import {
  getDefaultPostVisibility,
  setDefaultPostVisibility,
  type DefaultPostVisibility,
} from "@app/services/posts";
import { useAccountCenter } from "../useAccountCenter";
import type { SectionProps } from "../registry";

const DEFAULT_VISIBILITY_OPTIONS: { value: DefaultPostVisibility; label: string }[] = [
  { value: "draft", label: "Draft — still writing" },
  { value: "private", label: "Private — finished, unshared" },
];

export function PostSharingSection({ highlightSettingId: _ }: SectionProps) {
  const accountCenter = useAccountCenter();
  const profile = useSharingStore((s) => s.profile);
  const profileLoaded = useSharingStore((s) => s.profileLoaded);
  const loadProfile = useSharingStore((s) => s.loadProfile);

  const myPosts = usePostsStore((s) => s.myPosts);
  const myPostsLoaded = usePostsStore((s) => s.myPostsLoaded);
  const loadMyPosts = usePostsStore((s) => s.loadMyPosts);
  const publish = usePostsStore((s) => s.publish);
  const makePrivate = usePostsStore((s) => s.makePrivate);

  const [defaultVisibility, setDefaultVisibility] = useState<DefaultPostVisibility>("draft");
  const [busyFolderId, setBusyFolderId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    void loadProfile();
    void loadMyPosts();
    void getDefaultPostVisibility().then(setDefaultVisibility);
  }, [loadProfile, loadMyPosts]);

  async function handleDefaultVisibilityChange(value: DefaultPostVisibility) {
    setDefaultVisibility(value);
    await setDefaultPostVisibility(value);
  }

  async function handleSwitchVisibility(post: MyPostSummary, target: "friends" | "public") {
    setBusyFolderId(post.folderId);
    setRowError(null);
    try {
      await publish(post.folderId, post.doc, target);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Couldn't update visibility.");
    } finally {
      setBusyFolderId(null);
    }
  }

  async function handleMakePrivate(post: MyPostSummary) {
    setBusyFolderId(post.folderId);
    setRowError(null);
    try {
      await makePrivate(post.folderId, post.doc);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Couldn't make private.");
    } finally {
      setBusyFolderId(null);
    }
  }

  const published = myPosts.filter(
    (p) => p.doc.visibility === "friends" || p.doc.visibility === "public",
  );

  return (
    <div className="ny-ac__section-body">
      <div className="ny-ac__card" data-setting-id="post-sharing-default-visibility">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Default visibility</div>
            <div className="ny-ac__row-sub">Applied to a post when you first create it.</div>
          </div>
          <div className="ny-ac__pills">
            {DEFAULT_VISIBILITY_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={cn("ny-ac__pill", {
                  "is-active": defaultVisibility === option.value,
                })}
                onClick={() => void handleDefaultVisibilityChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="post-sharing-published">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Published posts</div>
            <div className="ny-ac__row-sub">
              Posts currently shared with friends or publicly.
            </div>
          </div>
        </div>

        {profileLoaded && !profile && (
          <div className="ny-ac__row ny-ac__row--stack">
            <p className="ny-ac__row-sub">Pick a share handle before sharing a post.</p>
            <button
              type="button"
              className="ny-btn ny-btn--ghost"
              onClick={() => accountCenter.setSection("public-profile")}
            >
              Open Public Profile
            </button>
          </div>
        )}

        {myPostsLoaded && published.length === 0 && (
          <p className="ny-ac__row-sub">Nothing shared yet — publish a post to see it here.</p>
        )}

        {published.map((post) => (
          <div className="ny-ac__row" key={post.folderId}>
            <div>
              <div className="ny-ac__row-label">{post.doc.title || "Untitled post"}</div>
              <div className="ny-ac__row-sub">
                {post.doc.visibility === "public" ? "Public" : "Friends"}
              </div>
            </div>
            <div className="ny-ac__actions-row">
              <button
                type="button"
                className="ny-btn ny-btn--ghost"
                disabled={busyFolderId === post.folderId}
                onClick={() =>
                  void handleSwitchVisibility(
                    post,
                    post.doc.visibility === "public" ? "friends" : "public",
                  )
                }
              >
                {post.doc.visibility === "public" ? "Make friends-only" : "Make public"}
              </button>
              <button
                type="button"
                className="ny-btn ny-btn--ghost"
                disabled={busyFolderId === post.folderId}
                onClick={() => void handleMakePrivate(post)}
              >
                Make private
              </button>
              <Link className="ny-btn ny-btn--ghost" to={`/posts/edit/${post.folderId}`}>
                Edit
              </Link>
            </div>
          </div>
        ))}

        {rowError && <p className="ny-ac__error">{rowError}</p>}
      </div>
    </div>
  );
}
