-- 0105: LlmUsageEvent gains web_search_requests — the per-call count of Anthropic
-- server-side web_search invocations (billed ~$0.01/request, a separate meter from
-- tokens). Closes ledger gap (a) from docs/findings/ledger-telemetry-gaps.md: the
-- batch-verify cron and the (paused) grounded refill both search the web, but the
-- token-only ledger made that spend invisible to getMonthToDateLlmSpendUsd, the
-- monthly cap, and the cost readouts. Additive column with a DEFAULT, safe on a
-- non-empty table. Rollback: ALTER TABLE "LlmUsageEvent" DROP COLUMN
-- "web_search_requests"; (readers treat a missing column as pre-0105 rows = 0).
ALTER TABLE "LlmUsageEvent" ADD COLUMN IF NOT EXISTS "web_search_requests" integer NOT NULL DEFAULT 0;
