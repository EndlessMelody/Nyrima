/**
 * ContributionHeatmap — GitHub-style 53×7 activity grid + streak line.
 *
 * "Activity" is a distinct-files-touched-per-day count (see
 * `services/social/profile-stats.ts`), not real watch-minutes — there's no
 * append-only watch-event log to derive true daily minutes from today.
 */

import type { ActivityDay } from "../../services/social/social-api";
import "./ContributionHeatmap.scss";

interface Props {
  days: ActivityDay[];
  currentStreak: number;
  longestStreak: number;
}

const WEEKS = 53;
const CELLS = WEEKS * 7;

export function ContributionHeatmap({ days, currentStreak, longestStreak }: Props) {
  const byDay = new Map(days.map((d) => [d.day, d.units]));
  const maxUnits = days.reduce((max, d) => Math.max(max, d.units), 1);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + (6 - today.getDay()));
  const start = new Date(endOfWeek);
  start.setDate(start.getDate() - CELLS + 1);

  const weeks: { key: string; units: number; inFuture: boolean }[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const week: { key: string; units: number; inFuture: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + w * 7 + d);
      const key = toKey(date);
      week.push({ key, units: byDay.get(key) ?? 0, inFuture: date.getTime() > today.getTime() });
    }
    weeks.push(week);
  }

  return (
    <section className="ny-heatmap" aria-label="Contribution activity">
      <header className="ny-heatmap__head">
        <span className="ny-heatmap__title">Activity</span>
        <div className="ny-heatmap__streaks">
          <span>
            <strong>{currentStreak}</strong> day streak
          </span>
          <span>
            <strong>{longestStreak}</strong> best streak
          </span>
        </div>
      </header>
      <div className="ny-heatmap__grid">
        {weeks.map((week) => (
          <div className="ny-heatmap__week" key={week[0]?.key}>
            {week.map((cell) => (
              <span
                key={cell.key}
                className={`ny-heatmap__cell${cell.inFuture ? " is-future" : ""}`}
                style={
                  cell.inFuture
                    ? undefined
                    : { opacity: cell.units === 0 ? undefined : 0.25 + 0.75 * (cell.units / maxUnits) }
                }
                data-active={cell.units > 0 || undefined}
                title={`${cell.key}: ${cell.units} active file${cell.units === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="ny-heatmap__note">Activity = distinct files touched per day, not exact watch time.</p>
    </section>
  );
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
