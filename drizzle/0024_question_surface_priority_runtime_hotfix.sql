-- Runtime compatibility hotfix for preview/prod databases whose migration
-- journal indicates feed migrations ran but the Question priority column is
-- absent. Safe to run repeatedly.
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "surface_priority_score" DOUBLE PRECISION NOT NULL DEFAULT 0;
