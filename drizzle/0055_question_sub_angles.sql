-- Migration: GeneratedQuestion.sub_angles — positive sub-angle guidance for daily generation.
--
-- The avoid list tells the LLM what NOT to ask but offers no positive signal
-- about which angles inside a domain have been over-mined. Within a work-level
-- domain like "Mrs. Dalloway", the model clusters on a handful of salient
-- subjects (Septimus, Sally Seton, the old woman in the window) because
-- nothing in the prompt points it at the unexplored angles.
--
-- sub_angles stores 1-3 short tags emitted by the generation LLM identifying
-- which facets of the domain a question covers (e.g. "Septimus shell shock",
-- "Cymbeline allusion", "old woman in window"). On the next generation we
-- aggregate the recent sub_angles per domain and surface them as positive
-- guidance: "you've already covered X, Y, Z — pick something else."
--
-- Stored as text[] with default '{}' so historical rows remain valid without
-- backfill. Idempotent guard also pre-applied in src/instrumentation.ts.
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "sub_angles" text[] NOT NULL DEFAULT '{}';
