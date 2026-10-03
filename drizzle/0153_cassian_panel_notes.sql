-- Sparse experiment-level feedback without a fourth Cassian table.
ALTER TABLE "CassianRun" ADD COLUMN IF NOT EXISTS panel_notes jsonb NOT NULL DEFAULT '[]'::jsonb;
