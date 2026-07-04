-- 0109: KnowledgeNode gains node_weight — the Mastery v2 DEPTH WEIGHT
-- (docs/thinking/MASTERY-MODEL-v2.md): a topic-size / breadth proxy on a ~1–10
-- scale, seeded from Wikidata child-count (with an LLM fallback) and
-- human-overridable. Distinct from mastery_threshold (the v1 parent bar) and
-- from the "N Qs" depth (a question count). Nullable — unseeded nodes simply
-- have none, and nothing reads it yet (dark until the Phase 5 v2 read path).
-- Additive, safe on a non-empty table.
-- Rollback: ALTER TABLE "KnowledgeNode" DROP COLUMN "node_weight";
-- (readers treat a missing/NULL value as "unseeded — fall back to default").
ALTER TABLE "KnowledgeNode" ADD COLUMN IF NOT EXISTS "node_weight" integer;
