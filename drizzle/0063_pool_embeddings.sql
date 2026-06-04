-- Migration: B1 pool substrate — pgvector embeddings for semantic dedup
-- (PRD-D-5 §5.1 D10 / §7).
--
-- Enables pgvector and adds a nullable 1024-dim embedding column (Voyage
-- voyage-3.5-lite) to both pool tables, plus HNSW cosine indexes for fast
-- nearest-neighbour lookup. The column is populated at insert (best-effort) and
-- by the batched backfill job; it stays NULL until VOYAGE_API_KEY is provisioned,
-- so this migration alone changes no behavior.
--
-- Additive / IF NOT EXISTS throughout — safe and non-destructive. Matching
-- idempotent boot guards land in src/instrumentation.ts.
--
-- Rollback: DROP INDEX the two hnsw indexes; ALTER TABLE ... DROP COLUMN IF
-- EXISTS "embedding" on both tables. (CREATE EXTENSION is left in place.)
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
--> statement-breakpoint
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "GeneratedQuestion_embedding_hnsw_idx"
  ON "GeneratedQuestion" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Question_embedding_hnsw_idx"
  ON "Question" USING hnsw ("embedding" vector_cosine_ops);
