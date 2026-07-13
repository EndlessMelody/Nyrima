/**
 * PostsFeedPage — `/posts`. Two tabs: "Following" (aggregated
 * `Shared/posts.json` announcements from everyone the user follows) and
 * "My posts" (the author's own draft + published folders).
 *
 * Gated the same way as `SocialPage`: guests have no `social:profile`
 * capability, so they see the shared `SocialLockedState` instead of ever
 * mounting the hub — no follow-list reads, no posts-store syncs fire for
 * them. This mirrors the fact that "Following" is empty for guests anyway
 * (they can't follow anyone), so a single top-level gate is simpler than
 * partially gating each tab.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@once-ui-system/core/components";
import { useAuth } from "@/auth/AuthProvider";
import { LobbyShell, LobbySidebar, LobbyTopbar } from "../components/LobbyChrome";
import { GuestBanner } from "../components/GuestBanner";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import { SocialLockedState } from "../components/SocialLockedState";
import { usePostsStore } from "../stores/posts-store";
import { PostCard } from "../components/posts/PostCard";
import "./PostsFeedPage.scss";

type Tab = "following" | "mine";

export function PostsFeedPage() {
  const { canAccess } = useAuth();
  const [collapsed, setCollapsed] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < 1280,
  );
  const [query, setQuery] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  return (
    <LobbyShell
      collapsed={collapsed}
      sidebar={
        <LobbySidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
          onOpenDrive={() => setSetupOpen(true)}
        />
      }
      topbar={
        <LobbyTopbar
          query={query}
          onQueryChange={setQuery}
          inputRef={searchInputRef}
          searchPlaceholder="Search posts..."
        />
      }
    >
      <div className="ny-lobby-main__guest">
        <GuestBanner />
      </div>
      {canAccess("social:profile") ? <PostsFeedHub /> : <SocialLockedState />}
      <SetupAccessDialog
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onSaved={() => setSetupOpen(false)}
      />
    </LobbyShell>
  );
}

function PostsFeedHub() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("following");

  const feedItems = usePostsStore((s) => s.feedItems);
  const feedLoaded = usePostsStore((s) => s.feedLoaded);
  const syncing = usePostsStore((s) => s.syncing);
  const loadFeed = usePostsStore((s) => s.loadFeed);
  const syncFeed = usePostsStore((s) => s.syncFeed);

  const myPosts = usePostsStore((s) => s.myPosts);
  const myPostsLoaded = usePostsStore((s) => s.myPostsLoaded);
  const myPostsLoading = usePostsStore((s) => s.myPostsLoading);
  const loadMyPosts = usePostsStore((s) => s.loadMyPosts);

  useEffect(() => {
    void loadFeed().then(() => void syncFeed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "mine") void loadMyPosts();
  }, [tab, loadMyPosts]);

  return (
    <div className="ny-posts-feed-page">
      <div className="ny-posts-feed-page__header">
        <div className="ny-posts-feed-page__tabs">
          <button
            type="button"
            className={tab === "following" ? "is-active" : ""}
            onClick={() => setTab("following")}
          >
            Following
          </button>
          <button
            type="button"
            className={tab === "mine" ? "is-active" : ""}
            onClick={() => setTab("mine")}
          >
            My posts
          </button>
        </div>
        <Button variant="primary" onClick={() => navigate("/posts/new")}>
          New post
        </Button>
      </div>

      {tab === "following" && (
        <FollowingTab loaded={feedLoaded} syncing={syncing} items={feedItems} />
      )}
      {tab === "mine" && (
        <MyPostsTab
          loaded={myPostsLoaded}
          loading={myPostsLoading}
          posts={myPosts}
        />
      )}
    </div>
  );
}

function FollowingTab({
  loaded,
  syncing,
  items,
}: {
  loaded: boolean;
  syncing: boolean;
  items: ReturnType<typeof usePostsStore.getState>["feedItems"];
}) {
  if (!loaded || (syncing && items.length === 0)) {
    return <div className="ny-posts-feed-page__status">Loading…</div>;
  }
  if (items.length === 0) {
    return (
      <div className="ny-posts-feed-page__empty">
        Follow people from Social → People to see their posts here.
      </div>
    );
  }
  return (
    <div className="ny-posts-feed-page__grid">
      {items.map((item) => (
        <PostCard
          key={item.announcement.id}
          folderId={item.announcement.folderId}
          title={item.announcement.title}
          excerpt={item.announcement.excerpt}
          posterUrl={item.announcement.posterUrl}
          authorHandle={item.author.handle}
          authorName={item.author.name}
          publishedAt={item.announcement.publishedAt}
          tags={item.announcement.tags}
        />
      ))}
    </div>
  );
}

function MyPostsTab({
  loaded,
  loading,
  posts,
}: {
  loaded: boolean;
  loading: boolean;
  posts: ReturnType<typeof usePostsStore.getState>["myPosts"];
}) {
  if (loading && !loaded) {
    return <div className="ny-posts-feed-page__status">Loading…</div>;
  }
  if (posts.length === 0) {
    return (
      <div className="ny-posts-feed-page__empty">
        You haven't written anything yet.
      </div>
    );
  }
  return (
    <div className="ny-posts-feed-page__grid">
      {posts.map(({ folderId, doc }) => (
        <PostCard
          key={folderId}
          folderId={folderId}
          linkTo={`/posts/edit/${encodeURIComponent(folderId)}`}
          title={doc.title || "Untitled draft"}
          authorHandle={doc.author.handle}
          authorName={doc.author.name}
          publishedAt={doc.publishedAt ?? doc.updatedAt}
          tags={doc.tags}
        />
      ))}
    </div>
  );
}
