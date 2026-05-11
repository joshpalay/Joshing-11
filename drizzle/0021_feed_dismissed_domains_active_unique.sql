CREATE UNIQUE INDEX "feed_dismissed_domains_active_unique"
ON "FeedDismissedDomain" ("userId", "canonicalSubcategory")
WHERE "reinstatedAt" IS NULL;
