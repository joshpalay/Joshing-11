# Recent Activity comparison

Home now shows the shared-answer view by default, without a version toggle.

For a quick operational fallback, `/?recentActivity=current` still selects the existing activity stream. The default `/` and the earlier `/?recentActivity=shared` link show the new view. The new query runs only when the shared view is selected.

The new view shows each qualifying question and its answer openly, with linked friend names and the existing Send in Joshing / Text it menu. It includes new shared correct answers, including friends playing from your activity and matches found independently. It excludes the known relationship when you answer a question from that friend's existing feed or bundle. Several qualifying friends share one question entry.

Recency uses the later of each pair's earliest correct answers, within the existing Home window. There is no three-answer threshold. Blocked friends, deleted/blocked questions, viewer-hidden reports, and the existing question trust gate remain enforced. Feed origin is labeled only when supported by the recorded source; ambiguous milestone origins are not attributed to a particular friend.

This change only reads existing data. It introduces no schema changes, migrations, activity writes, or persisted preference. The existing activity archive remains available.

## Reverting

For an immediate fallback, visit `/?recentActivity=current`. The fallback remains available without adding comparison controls to Home.

For a complete code rollback, revert this default-view update, then revert the original comparison commit (`d953e326`), and deploy normally. No database cleanup is needed.

## Validation

The isolated checkout based on current GitHub main passed 68 focused tests across 9 files, covering Home selection/rendering, shared-answer direction and deduplication, visibility guards, the existing convergence logic, and onward text formatting. The comparison UI and recipient picker were also exercised in the local browser with illustrative data; no messages were sent. Authenticated Home and physical iPhone/Safari were not exercised.
