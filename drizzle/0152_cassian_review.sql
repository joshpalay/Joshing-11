-- Immutable experiment output and per-admin exposure/answer/feedback records.
-- No foreign key points at the normal question or mastery tables.
CREATE TABLE IF NOT EXISTS "CassianCandidate" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES "CassianRun"(id) ON DELETE RESTRICT,
  domain text NOT NULL,
  breadth text NOT NULL,
  arm text NOT NULL,
  model text NOT NULL,
  question_text text NOT NULL,
  answer text NOT NULL,
  acceptable_variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  explainer text NOT NULL,
  fact_key text NOT NULL,
  difficulty text NOT NULL,
  machine_status text NOT NULL,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url text,
  snapshot_sha text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CassianCandidate_breadth_check" CHECK (breadth IN ('broad', 'niche', 'very narrow')),
  CONSTRAINT "CassianCandidate_arm_check" CHECK (arm IN ('baseline', 'candidate')),
  CONSTRAINT "CassianCandidate_status_check" CHECK (machine_status IN ('passed_core_gates', 'held'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "CassianCandidate_run_domain_arm_idx"
  ON "CassianCandidate"(run_id, domain, arm);
CREATE INDEX IF NOT EXISTS "CassianCandidate_fact_key_idx" ON "CassianCandidate"(fact_key);

CREATE TABLE IF NOT EXISTS "CassianReview" (
  candidate_id text NOT NULL REFERENCES "CassianCandidate"(id) ON DELETE RESTRICT,
  admin_user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  shown_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  answer_text text,
  grade jsonb,
  rating jsonb,
  rating_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  rating_updated_at timestamptz,
  PRIMARY KEY (candidate_id, admin_user_id)
);
CREATE INDEX IF NOT EXISTS "CassianReview_admin_shown_idx"
  ON "CassianReview"(admin_user_id, shown_at DESC);
