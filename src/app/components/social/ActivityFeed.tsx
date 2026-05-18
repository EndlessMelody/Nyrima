/**
 * ActivityFeed — placeholder for P4.3 (comments).
 *
 * Two strands once P4.3 lands:
 *   - "On your shares" — comment threads on entries you've published.
 *     Reconstructed by scanning every followed user's
 *     `Shared/comments/{yourShareId}.jsonl`.
 *   - "Your comments" — JSONL files in *your own* `Shared/comments/` folder,
 *     i.e. comments you've left on other people's shares.
 *
 * We render the surface now so the tab strip stays complete and the empty
 * state explains the upcoming wiring.
 */

import { EmptyState } from "./InboxList";

export function ActivityFeed() {
  return (
    <section className="ny-social-pane">
      <EmptyState
        title="Activity is coming in P4.3."
        sub="Comment threads on your shares (and on shares from people you follow) will surface here. The data plumbing lives in Shared/comments/ already — the aggregator + writer ship with Phase 4.3."
      />
    </section>
  );
}
