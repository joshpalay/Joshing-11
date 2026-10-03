# Cassian migration reservation

As of 2026-10-03, main ends at `0150_weekly_friends_digest`, while draft PR #1745 adds `0151_cassian_run`, `0152_cassian_review` and `0153_cassian_panel_notes`. Those three migrations have already been applied to the connected live database. This is a schema state fact, not evidence that Cassian app code is deployed to production.

The installed Drizzle runner reads the latest `created_at` from `drizzle.__drizzle_migrations` and only applies journal entries whose `when` is larger. A different branch adding `0151` with a `when` between main's `0150` and Cassian's applied `0153` can therefore be silently skipped on this database. Numbering alone is insufficient; both the journal `idx` and increasing `when` must be checked.

**Until #1745 merges, reserve 0151–0153 for Cassian. Any new migration destined for the same live database must start at 0154 and have a `when` greater than `1791052800000`.** Rebase that branch on the Cassian migration journal, then verify the live `drizzle.__drizzle_migrations` head and target schema after deploying. Do not rewrite or renumber the already-applied Cassian entries. If a conflicting migration is created, stop its rollout and reconcile the journal and database before deployment.

The draft PR should not be merged solely to clear this ordering risk while its signed-in admin preview and novelty checks remain incomplete. The reservation is the immediate coordination measure; merge after those checks pass.
