-- Cassian's paid runner uses one durable ledger for the whole $10 pilot.
-- Candidate/review storage follows when the admin UI is ready.
CREATE TABLE IF NOT EXISTS "CassianRun" (
  id text PRIMARY KEY,
  manifest_sha text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  spent_usd numeric(12, 6) NOT NULL DEFAULT 0,
  reserved_usd numeric(12, 6) NOT NULL DEFAULT 0,
  calls jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CassianRun_status_check" CHECK (status IN ('active', 'halted', 'complete')),
  CONSTRAINT "CassianRun_spent_nonnegative" CHECK (spent_usd >= 0),
  CONSTRAINT "CassianRun_reserved_nonnegative" CHECK (reserved_usd >= 0)
);
