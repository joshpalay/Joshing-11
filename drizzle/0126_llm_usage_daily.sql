-- 0126: generalize CritiqueUsageDaily into an action-keyed LlmUsageDaily table.
--
-- B-LLM-RATE-LIMIT-01: as the app opens up to more users, several on-demand
-- LLM endpoints (answer suggestion, verify-answer, crafter drafting, question
-- creation) need the same per-user daily cap that /api/questions/critique
-- already had via CritiqueUsageDaily. Rather than adding a near-identical
-- single-purpose table per endpoint, this migration widens that table with an
-- `action` column (one row per user/day/action) and renames it to
-- LlmUsageDaily; every rate-limited call site shares the one table, keyed by
-- its own action string ('critique', 'suggest-answer', 'verify-answer',
-- 'craft-draft', 'create-question', ...).
--
-- Existing CritiqueUsageDaily rows are copied forward tagged action='critique'
-- before the old table is dropped, so today's in-flight daily counts survive
-- the cutover. IF NOT EXISTS / ON CONFLICT DO NOTHING / IF EXISTS throughout
-- make this safe to re-run (boot guard chain, re-applied migration).
--
-- Rollback:
--   CREATE TABLE "CritiqueUsageDaily" (id uuid primary key default gen_random_uuid(),
--     user_id text not null references "User"(id) on delete cascade,
--     usage_date date not null, critique_count integer not null default 0,
--     updated_at timestamptz not null default now(),
--     unique (user_id, usage_date));
--   INSERT INTO "CritiqueUsageDaily" (user_id, usage_date, critique_count, updated_at)
--     SELECT user_id, usage_date, count, updated_at FROM "LlmUsageDaily" WHERE action = 'critique';
--   DROP TABLE "LlmUsageDaily";

CREATE TABLE IF NOT EXISTS "LlmUsageDaily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "usage_date" date NOT NULL,
  "action" text NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "LlmUsageDaily_user_id_usage_date_action_key" UNIQUE ("user_id", "usage_date", "action")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "LlmUsageDaily_user_id_usage_date_action_idx"
  ON "LlmUsageDaily" ("user_id", "usage_date", "action");
--> statement-breakpoint
ALTER TABLE "LlmUsageDaily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('"CritiqueUsageDaily"') IS NOT NULL THEN
    INSERT INTO "LlmUsageDaily" ("user_id", "usage_date", "action", "count", "updated_at")
      SELECT "user_id", "usage_date", 'critique', "critique_count", "updated_at"
      FROM "CritiqueUsageDaily"
      ON CONFLICT ("user_id", "usage_date", "action") DO NOTHING;
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS "CritiqueUsageDaily";
