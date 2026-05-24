-- Migration: GeneratedQuestion.fact_key — fact-level dedup for daily generation.
--
-- The LLM repeatedly regenerates famous canonical trivia (e.g. "What instrument
-- does Hagen play to summon the Gibichungs in Götterdämmerung?") under slightly
-- different wordings. The existing text-level dedup in persistGeneratedQuestion
-- only catches identical strings, so each re-wording lands as its own
-- GeneratedQuestion → its own Question → the same fact surfaces in the user's
-- queue multiple times.
--
-- fact_key is a normalized identifier for the underlying fact (lowercase,
-- hyphenated, ~80 char cap). We dedup against recent fact_keys for the same
-- user both at LLM-prompt time (so the avoid list is compact) and at persist
-- time (so a slipped-through re-wording can't reach the Question table).
--
-- Nullable so rows generated before this column existed remain valid. The
-- index is `(user_id, fact_key)` because the only lookup is "recent fact_keys
-- for this user."
--
-- Idempotent guards also pre-applied in src/instrumentation.ts.
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "fact_key" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "GeneratedQuestion_user_id_fact_key_idx"
  ON "GeneratedQuestion" ("user_id", "fact_key");
