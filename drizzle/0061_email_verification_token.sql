-- Migration: add EmailVerificationToken table for the confirm-link flow.
--
-- When a user submits a pendingEmail via PATCH /api/account/reminders we
-- mint a 32-byte random token, store its SHA-256 hash here, and email the
-- plaintext token in a /verify-email?token=… URL. Confirming the link
-- promotes pendingEmail → email and sets emailVerified = true.
--
-- token_hash is unique so a leaked link is single-use; consumed_at is kept
-- (rather than deleted) for audit. Cascades on User delete so token rows
-- don't outlive the account.
--
-- Idempotent guards are also pre-applied in src/instrumentation.ts for
-- preview/production databases that may have this migration recorded
-- without the table actually present.
CREATE TABLE IF NOT EXISTS "EmailVerificationToken" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "user_id" text NOT NULL,
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
DECLARE
  token_table regclass := to_regclass('public."EmailVerificationToken"');
  user_table regclass := to_regclass('public."User"');
BEGIN
  IF token_table IS NOT NULL
    AND user_table IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'EmailVerificationToken_user_id_User_id_fk'
        AND conrelid = token_table
    )
  THEN
    ALTER TABLE "EmailVerificationToken"
      ADD CONSTRAINT "EmailVerificationToken_user_id_User_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailVerificationToken_token_hash_key"
  ON "EmailVerificationToken" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailVerificationToken_user_id_idx"
  ON "EmailVerificationToken" ("user_id");
