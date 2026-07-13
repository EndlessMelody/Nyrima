/**
 * ProfileStatsCards — lifetime totals grid, same metric-card visual
 * pattern as `LibraryHealthCard`. All numbers except `commentsGivenCount`
 * come from the client-pushed `profile_stats` snapshot (self-reported, no
 * server verification — see the profile dashboard migration header).
 */

import type { ProfileStats } from "../../services/social/social-api";
import "./ProfileStatsCards.scss";

interface Props {
  stats: ProfileStats | null;
  /** Server-verified (live query on `folder_comments`), unlike the rest. */
  commentsGivenCount: number;
}

export function ProfileStatsCards({ stats, commentsGivenCount }: Props) {
  const hours = stats ? Math.round((stats.minutesWatched / 60) * 10) / 10 : 0;
  return (
    <ul className="ny-profile-stats">
      <Metric label="Hours watched" value={String(hours)} accent="brand" />
      <Metric label="Completed" value={String(stats?.completedCount ?? 0)} accent="accent" />
      <Metric label="Libraries" value={String(stats?.librariesOwned ?? 0)} />
      <Metric label="Posts" value={String(stats?.postsCount ?? 0)} />
      <Metric label="Friends" value={String(stats?.friendsCount ?? 0)} />
      <Metric label="Comments given" value={String(commentsGivenCount)} />
      <Metric label="Comments received" value={String(stats?.commentsReceivedCount ?? 0)} />
    </ul>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "brand" | "accent";
}) {
  return (
    <li className={`ny-profile-stats__metric${accent ? ` is-${accent}` : ""}`}>
      <span className="ny-profile-stats__value">{value}</span>
      <span className="ny-profile-stats__label">{label}</span>
    </li>
  );
}
