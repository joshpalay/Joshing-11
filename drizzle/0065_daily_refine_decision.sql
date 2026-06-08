-- Migration: add DAILY_REFINE_DECISION, the decision + cooldown ledger that
-- backs the Refine Your Game section on the daily summary.
--
-- One row tracks a single refine item the player acted on (or that was shown
-- and defaulted). The action column moves pending -> committed | defaulted:
--   * pending   = player tapped the action verb; change is STAGED, not applied.
--   * committed = the staged change was applied when the player built their
--                 next daily (commitPendingRefineDecisions in
--                 src/server/refine/commit.ts). cooldown_until is stamped then.
--   * defaulted = the item was shown but never acted on; no effect, but a
--                 cooldown is stamped so it does not immediately re-fire.
--
-- friend_id is set only for friend_expansion (the bonus source friend). The
-- unique index keys one decision per (user, queue, type, subdomain[, friend])
-- so resolve/undo upserts are idempotent. Cascades on User and DailyQueue
-- delete so rows don't outlive their owner or their triggering game.
--
-- Idempotent guards are also pre-applied in src/instrumentation.ts for
-- preview/production databases that may have this migration recorded without
-- the table actually present.
CREATE TABLE IF NOT EXISTS "DAILY_REFINE_DECISION" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "user_id" text NOT NULL,
  "queue_id" text NOT NULL,
  "item_type" text NOT NULL,
  "canonical_subcategory" text NOT NULL,
  "friend_id" text,
  "action" text NOT NULL DEFAULT 'pending',
  "committed_at" timestamp with time zone,
  "cooldown_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
DECLARE
  decision_table regclass := to_regclass('public."DAILY_REFINE_DECISION"');
  user_table regclass := to_regclass('public."User"');
  queue_table regclass := to_regclass('public."DailyQueue"');
BEGIN
  IF decision_table IS NOT NULL
    AND user_table IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'DAILY_REFINE_DECISION_user_id_User_id_fk'
        AND conrelid = decision_table
    )
  THEN
    ALTER TABLE "DAILY_REFINE_DECISION"
      ADD CONSTRAINT "DAILY_REFINE_DECISION_user_id_User_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE;
  END IF;

  IF decision_table IS NOT NULL
    AND queue_table IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'DAILY_REFINE_DECISION_queue_id_DailyQueue_id_fk'
        AND conrelid = decision_table
    )
  THEN
    ALTER TABLE "DAILY_REFINE_DECISION"
      ADD CONSTRAINT "DAILY_REFINE_DECISION_queue_id_DailyQueue_id_fk"
      FOREIGN KEY ("queue_id") REFERENCES "DailyQueue"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "DAILY_REFINE_DECISION_unique_item"
  ON "DAILY_REFINE_DECISION" ("user_id", "queue_id", "item_type", "canonical_subcategory", COALESCE("friend_id", ''));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DAILY_REFINE_DECISION_cooldown_idx"
  ON "DAILY_REFINE_DECISION" ("user_id", "item_type", "canonical_subcategory", "cooldown_until");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DAILY_REFINE_DECISION_uncommitted_idx"
  ON "DAILY_REFINE_DECISION" ("user_id", "committed_at");
