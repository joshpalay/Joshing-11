-- 0107: KnowledgeNode gains wikidata_qid — the Wikidata entity (Q-number) a
-- ratified node was seeded from (B-KNOWLEDGE-ADMIN-01 P3: Wikidata is the
-- preferred structure proposer; storing the QID keeps provenance and lets the
-- admin re-query the entity later). Nullable — manually-authored and
-- LLM-proposed nodes simply have none. Additive, safe on a non-empty table.
-- Rollback: ALTER TABLE "KnowledgeNode" DROP COLUMN "wikidata_qid";
-- (readers treat a missing/NULL value as "no Wikidata provenance").
ALTER TABLE "KnowledgeNode" ADD COLUMN IF NOT EXISTS "wikidata_qid" text;
