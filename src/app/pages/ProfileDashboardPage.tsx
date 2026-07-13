/**
 * ProfileDashboardPage — LeetCode/GitHub-style profile at `/u/:handle`.
 * `/u/me` resolves to the signed-in user's own profile via `getMyProfile()`,
 * sidestepping the "I don't have a handle yet" chicken-and-egg on first
 * visit. Any signed-in user can view any profile (same `auth.uid() is not
 * null` read gate as the rest of the social schema — not friends-only).
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import {
  getMyProfile,
  getProfileByHandle,
  getCommentsGivenCount,
  type SocialProfile,
} from "../services/social/social-api";
import { useProfileStatsStore } from "../stores/profile-stats-store";
import { useAccountCenter } from "../account-center/useAccountCenter";
import { ProfileHeader } from "../components/profile/ProfileHeader";
import { ProfileStatsCards } from "../components/profile/ProfileStatsCards";
import { ContributionHeatmap } from "../components/profile/ContributionHeatmap";
import { BadgesShelf } from "../components/profile/BadgesShelf";
import "./ProfileDashboardPage.scss";

export function ProfileDashboardPage() {
  const { handle } = useParams<{ handle: string }>();
  const { account } = useAuth();
  const accountCenter = useAccountCenter();

  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentsGivenCount, setCommentsGivenCount] = useState(0);

  const byUser = useProfileStatsStore((s) => s.byUser);
  const loadForUser = useProfileStatsStore((s) => s.loadForUser);
  const loadBadgeDefs = useProfileStatsStore((s) => s.loadBadgeDefs);
  const badgeDefs = useProfileStatsStore((s) => s.badgeDefs);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProfile(null);
    void (async () => {
      try {
        const resolved =
          handle === "me" ? await getMyProfile() : await getProfileByHandle(handle ?? "");
        if (cancelled) return;
        if (!resolved) {
          setError(
            handle === "me"
              ? "Set a handle in Account Center → Public Profile to get your dashboard link."
              : `No profile found for @${handle}.`,
          );
          setLoading(false);
          return;
        }
        setProfile(resolved);
        setLoading(false);
        void loadForUser(resolved.id);
        void loadBadgeDefs();
        getCommentsGivenCount(resolved.id)
          .then((n) => {
            if (!cancelled) setCommentsGivenCount(n);
          })
          .catch(() => undefined);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't load that profile.");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, loadForUser, loadBadgeDefs]);

  if (loading) {
    return <div className="ny-profile-dash__status">Loading profile…</div>;
  }

  if (error || !profile) {
    return <div className="ny-profile-dash__status">{error ?? "Profile not found."}</div>;
  }

  const isSelf = handle === "me" || profile.id === account?.id;
  const data = byUser[profile.id];

  return (
    <div className="ny-profile-dash">
      <ProfileHeader
        profile={profile}
        isSelf={isSelf}
        onEdit={() => accountCenter.open("public-profile")}
      />
      <ProfileStatsCards stats={data?.stats ?? null} commentsGivenCount={commentsGivenCount} />
      <ContributionHeatmap
        days={data?.activity ?? []}
        currentStreak={data?.stats?.currentStreakDays ?? 0}
        longestStreak={data?.stats?.longestStreakDays ?? 0}
      />
      <BadgesShelf defs={badgeDefs} earned={data?.badges ?? []} />
    </div>
  );
}
