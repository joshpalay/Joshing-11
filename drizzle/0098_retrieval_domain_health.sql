-- B-SUPPLY-REFILL-THROUGHPUT-01 follow-up — per-domain refill health for adaptive
-- timeout exclusion. runPoolRefill records whether each domain's grounded call
-- completed or timed out; getThinActiveDomains then skips domains that have timed
-- out >= a threshold number of times consecutively and are still within a cooldown,
-- so the capped cron budget stops being spent on chronically-slow (typically broad)
-- domains that never complete, and focuses on domains that actually persist. A
-- domain is retried after the cooldown; a completed generation resets its counter.
--
-- Purely additive: no existing table is altered. RLS enabled with no policies
-- (the app connects as the owner role, which bypasses RLS) per B-SECURITY-RLS-01 /
-- migration 0081. Every statement is idempotent and mirrored by a defensive guard
-- in src/instrumentation.ts (precedent: 0097).
--
-- Rollback:
--   DROP TABLE IF EXISTS "RetrievalDomainHealth";
CREATE TABLE IF NOT EXISTS "RetrievalDomainHealth" (
  "domain" text PRIMARY KEY,
  "consecutive_timeouts" integer NOT NULL DEFAULT 0,
  "last_timeout_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "RetrievalDomainHealth" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RetrievalDomainHealth_cooldown_idx" ON "RetrievalDomainHealth" ("consecutive_timeouts", "last_timeout_at");
