/**
 * SocialPage — the Phase 4 social hub.
 *
 * One route, five tabs. URL-driven (`/social/:tab`) so deep links stay stable
 * and the topbar's unread badge can jump straight to Inbox. Tabs:
 *
 *   inbox    → new shares from people you follow + access requests
 *   mine     → manage your own published shares
 *   people   → follow + find users
 *   activity → comment threads (placeholder until P4.3 lands)
 *   privacy  → public/private toggle for Shared/, block list
 *
 * Design language: dense, instrument-tape, hairline borders + monospace
 * captions — the same Atelier system the lobby uses. The information density
 * is nyaa.si-flavored (table rows, category badges, sort + filter chrome)
 * filtered through Nyrima's existing tokens; we don't introduce a new palette
 * or font stack.
 *
 * The page mounts a sticky toolbar (kana caption + tab strip + global search
 * + sync state). Each tab renders into the same content slot — keeps the
 * layout grid identical between tabs so switching feels weightless.
 */

import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSharingStore } from "../stores/sharing-store";
import { useSocialStore } from "../stores/social-store";
import { SocialToolbar } from "../components/social/SocialToolbar";
import { SocialTabs, type SocialTabKey, SOCIAL_TABS } from "../components/social/SocialTabs";
import { InboxList } from "../components/social/InboxList";
import { MyShares } from "../components/social/MyShares";
import { PeopleSearch } from "../components/social/PeopleSearch";
import { ActivityFeed } from "../components/social/ActivityFeed";
import { PrivacyPanel } from "../components/social/PrivacyPanel";
import "./SocialPage.scss";

const DEFAULT_TAB: SocialTabKey = "inbox";

export function SocialPage() {
  const navigate = useNavigate();
  const params = useParams<{ tab?: string }>();

  const tabKey: SocialTabKey = useMemo(() => {
    const raw = params.tab ?? DEFAULT_TAB;
    return SOCIAL_TABS.some((t) => t.key === raw)
      ? (raw as SocialTabKey)
      : DEFAULT_TAB;
  }, [params.tab]);

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

  const tabCounts = useMemo(
    () => ({
      inbox: unreadCount,
      mine: myIndex?.entries.length ?? 0,
      people: followedUsers.length,
      activity: 0,
      privacy: 0,
    }),
    [unreadCount, myIndex, followedUsers.length],
  );

  return (
    <div className="ny-social">
      <SocialToolbar
        profile={profile}
        profileLoaded={profileLoaded}
        syncing={syncing}
        lastSyncedAt={lastSyncedAt}
        followsCount={followedUsers.length}
        onSync={() => void syncInbox()}
      />

      <SocialTabs current={tabKey} counts={tabCounts} onChange={goToTab} />

      <div className="ny-social__content">
        {tabKey === "inbox" && <InboxList />}
        {tabKey === "mine" && <MyShares />}
        {tabKey === "people" && <PeopleSearch />}
        {tabKey === "activity" && <ActivityFeed />}
        {tabKey === "privacy" && <PrivacyPanel />}
      </div>
    </div>
  );
}
