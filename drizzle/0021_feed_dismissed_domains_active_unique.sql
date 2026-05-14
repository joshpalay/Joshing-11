-- Ensure preview/partially-migrated databases have the dismissed-domain table
-- before adding the active-row uniqueness constraint. Some environments recorded
-- the earlier 0012 migration without this table, which made this migration fail
-- with relation "FeedDismissedDomain" does not exist.
CREATE TABLE IF NOT EXISTS "FeedDismissedDomain" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "canonicalSubcategory" TEXT NOT NULL,
  "dismissedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "reinstatedAt" TIMESTAMPTZ
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FeedDismissedDomain_userId_idx" ON "FeedDismissedDomain" ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FeedDismissedDomain_userId_sub_idx" ON "FeedDismissedDomain" ("userId", "canonicalSubcategory");
--> statement-breakpoint
-- If duplicates were inserted before the unique index existed, keep the newest
-- active dismissal and remove the older active rows so the constraint can apply.
DELETE FROM "FeedDismissedDomain" existing
USING "FeedDismissedDomain" newest
WHERE existing."userId" = newest."userId"
  AND existing."canonicalSubcategory" = newest."canonicalSubcategory"
  AND existing."reinstatedAt" IS NULL
  AND newest."reinstatedAt" IS NULL
  AND (
    existing."dismissedAt" < newest."dismissedAt"
    OR (existing."dismissedAt" = newest."dismissedAt" AND existing."id" < newest."id")
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feed_dismissed_domains_active_unique"
ON "FeedDismissedDomain" ("userId", "canonicalSubcategory")
WHERE "reinstatedAt" IS NULL;
