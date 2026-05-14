ALTER TABLE "GradeDispute"
  ADD COLUMN IF NOT EXISTS "question_text" TEXT,
  ADD COLUMN IF NOT EXISTS "surface" TEXT,
  ADD COLUMN IF NOT EXISTS "review_decision" TEXT,
  ADD COLUMN IF NOT EXISTS "review_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "accepted_alternative" TEXT;
