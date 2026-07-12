/**
 * SocialPage — the Phase 4 social hub.
 *
 * Layout: a 2-column rail/pane grid sized to the viewport so the page itself
 * never scrolls — the pane owns its own overflow. The rail (left, 320px)
 * holds identity + section picker + sync controls; the pane (right) renders
 * the active section.
 *
 * One route, five sections. URL-driven (`/social/:tab`) so deep links stay
 * stable and the topbar's unread badge can jump straight to Inbox. Sections:
 *
 *   inbox    → new shares from people you follow + access requests
 *   mine     → manage your own published shares
 *   people   → follow + find users
 *   activity → comment threads (placeholder until P4.3 lands)
 *   privacy  → public/private toggle for Shared/, block list
 *
 * Section switching uses the SocialSectionPicker (compact trigger →
 * floating popover), not a horizontal tabstrip — keeps the rail dense and
 * leaves the eye on the pane content.
 *
 * Design language: dense, instrument-tape, hairline borders + monospace
 * captions — the same Atelier system the lobby uses. The information density
 * is nyaa.si-flavored (table rows, category badges, sort + filter chrome)
 * filtered through Nyrima's existing tokens; we don't introduce a new palette
 * or font stack.
 */

import { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { SocialLockedState } from "../components/SocialLockedState";
import { useSharingStore } from "../stores/sharing-store";
import { useSocialStore } from "../stores/social-store";
import { SocialToolbar, SyncControls } from "../components/social/SocialToolbar";
import { ShelfLinkCard } from "../components/social/ShelfLinkCard";
import {
  SocialSectionPicker,
  type SocialTabKey,
  SOCIAL_TABS,
} from "../components/social/SocialTabs";
import { InboxList } from "../components/social/InboxList";
import { MyShares } from "../components/social/MyShares";
import { PeopleSearch } from "../components/social/PeopleSearch";
import { ActivityFeed } from "../components/social/ActivityFeed";
import { PrivacyPanel } from "../components/social/PrivacyPanel";
import { FollowedShelf } from "../components/social/FollowedShelf";
import "./SocialPage.scss";

const DEFAULT_TAB: SocialTabKey = "inbox";

/**
 * Capability gate for the whole social hub. Guests have no `social:profile`
 * capability, so they never mount `SocialHub` — meaning none of its social
 * store loads / inbox syncs / backend reads fire. They see the friendly
 * locked state instead.
 */
export function SocialPage() {
  const { canAccess } = useAuth();
  return canAccess("social:profile") ? <SocialHub /> : <SocialLockedState />;
}

function SocialHub() {
  const navigate = useNavigate();
  const params = useParams<{ tab?: string; folderId?: string }>();
  const location = useLocation();

  // `/social/shelf/:folderId` matches a different route definition than the
  // tabbed routes, so we use the path prefix rather than params.tab to
  // detect shelf mode — `params.folderId` is only populated on the shelf
  // route and `params.tab` on the tab routes.
  const shelfFolderId = location.pathname.startsWith("/social/shelf/")
    ? params.folderId
    : undefined;
  const isShelf = !!shelfFolderId;

  const tabKey: SocialTabKey = useMemo(() => {
    if (isShelf) return "people"; // highlight People tab when drilling into a shelf
    const raw = params.tab ?? DEFAULT_TAB;
    return SOCIAL_TABS.some((t) => t.key === raw)
      ? (raw as SocialTabKey)
      : DEFAULT_TAB;
  }, [params.tab, isShelf]);

  // ---- store wiring -------------------------------------------------------

  const profile = useSharingStore((s) => s.profile);
  const profileLoaded = useSharingStore((s) => s.profileLoaded);
  const loadProfile = useSharingStore((s) => s.loadProfile);

  const followedUsers = useSocialStore((s) => s.followedUsers);
  const loadFollows = useSocialStore((s) => s.loadFollows);
  const syncInbox = useSocialStore((s) => s.syncInbox);
  const syncing = useSocialStore((s) => s.syncing);
  const lastSyncedAt = useSocialStore((s) => s.lastSyncedAt);
  const unreadCount = useSocialStore((s) => s.unreadCount);

  const myIndex = useSocialStore((s) => s.myIndex);
  const myIndexLoaded = useSocialStore((s) => s.myIndexLoaded);
  const loadMyIndex = useSocialStore((s) => s.loadMyIndex);

  const receivedComments = useSocialStore((s) => s.receivedComments);

  // Hydrate the profile + follow list on first mount. Cheap (one
  // chrome.storage read each) and decoupled — neither blocks the other.
  useEffect(() => {
    void loadProfile();
    void loadFollows();
  }, [loadProfile, loadFollows]);

  // Auto-pull the inbox on first visit + whenever the follow list changes.
  // Skipped if no follows so a brand-new user doesn't see "Sync failed".
  useEffect(() => {
    if (followedUsers.length === 0) return;
    void syncInbox();
    // We deliberately don't re-fire on every render — syncing is gated
    // inside the store on `syncing` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedUsers.length]);

  // Lazy-load the user's own index on first MyShares visit.
  useEffect(() => {
    if (tabKey !== "mine") return;
    if (myIndexLoaded) return;
    void loadMyIndex();
  }, [tabKey, myIndexLoaded, loadMyIndex]);

  const goToTab = (next: SocialTabKey) => {
    navigate(next === DEFAULT_TAB ? "/social" : `/social/${next}`);
  };

  const activityCount = useMemo(
    () =>
      Object.values(receivedComments).reduce((n, list) => n + list.length, 0),
    [receivedComments],
  );

  const tabCounts = useMemo(
    () => ({
      inbox: unreadCount,
      mine: myIndex?.entries.length ?? 0,
      people: followedUsers.length,
      activity: activityCount,
      privacy: 0,
    }),
    [unreadCount, myIndex, followedUsers.length, activityCount],
  );

  return (
    <div className="ny-social">
      <aside className="ny-social__rail" aria-label="Social rail">
        <SocialToolbar />

        <ShelfLinkCard ready={profileLoaded} />

        <SocialSectionPicker
          current={tabKey}
          counts={tabCounts}
          onChange={goToTab}
        />

        <div className="ny-social__rail-sep" aria-hidden="true" />

        <SyncControls
          profile={profile}
          profileLoaded={profileLoaded}
          syncing={syncing}
          lastSyncedAt={lastSyncedAt}
          followsCount={followedUsers.length}
          onSync={() => void syncInbox()}
        />
      </aside>

      <section className="ny-social__pane" aria-label="Social content">
        {isShelf ? (
          <FollowedShelf folderId={shelfFolderId!} />
        ) : (
          <>
            {tabKey === "inbox" && <InboxList />}
            {tabKey === "mine" && <MyShares />}
            {tabKey === "people" && <PeopleSearch />}
            {tabKey === "activity" && <ActivityFeed />}
            {tabKey === "privacy" && <PrivacyPanel />}
          </>
        )}
      </section>
    </div>
  );
}
