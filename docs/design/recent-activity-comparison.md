# Recent Activity comparison

Home shows the shared-answer view by default, without a version toggle. Admins can change their own view under Profile → Developer tools → Use new Recent Activity.

The profile switch remembers the choice for the signed-in account in this browser for 30 days. Turning it off selects the original activity list for normal Home visits; turning it on restores the new view. A different account defaults to the new version. Explicit developer links (`/?recentActivity=current` or `/?recentActivity=shared`) override the saved choice without changing it. The new query runs only when the shared view is selected.

The new view shows each qualifying question and its answer openly, with linked friend names and the existing Send in Joshing / Text it menu. It includes new shared correct answers, including friends playing from your activity and matches found independently. It excludes the known relationship when you answer a question from that friend's existing feed or bundle. Several qualifying friends share one question entry. Headlines name the topic being celebrated instead of repeating “this.” They use the existing question short label first, then its subject (for example, “kangaroo knowledge”), then the canonical domain. Missing topic metadata keeps a neutral fallback. The send drawer retains the original domain.

Recency uses the later of each pair's earliest correct answers, within the existing Home window. There is no three-answer threshold. Blocked friends, deleted/blocked questions, viewer-hidden reports, and the existing question trust gate remain enforced. Feed origin is labeled only when supported by the recorded source; ambiguous milestone origins are not attributed to a particular friend.

The activity view only reads existing data. It introduces no schema changes, migrations, or activity writes. The developer switch uses an account-scoped HttpOnly, SameSite=Lax cookie. Its API is admin-gated and validates the requested version. The existing activity archive remains available.

## Reverting

For an immediate personal fallback, turn off Use new Recent Activity in the profile developer tools, then visit Home. A direct `/?recentActivity=current` link also remains available.

For a complete code rollback, revert this default-view update, then revert the original comparison commit (`d953e326`), and deploy normally. No database cleanup is needed.

## Validation

The isolated checkout based on current GitHub main passed 68 focused tests across 9 files, covering Home selection/rendering, shared-answer direction and deduplication, visibility guards, the existing convergence logic, and onward text formatting. The comparison UI and recipient picker were also exercised in the local browser with illustrative data; no messages were sent. Authenticated Home and physical iPhone/Safari were not exercised.

## Profile developer switch validation

34 focused tests passed across preference resolution, admin API access and input validation, account isolation, profile developer-tool gating, and existing Home rendering. Lint, typecheck, and design checks passed. The browser preview verified saving both choices, leaving and returning to the developer control, and visiting Home without URL overrides. No database or account settings were changed during preview testing; it uses a separate local sample cookie.
