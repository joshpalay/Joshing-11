-- Migration: schema foundation for the friends/privacy work (B-Friends-1).
--
-- Adds three independent pieces in one file:
--
--   1. Discoverability flags on User (default FALSE). Nothing reads them
--      yet; B-Friends-3 / B-Friends-4 will. Privacy & visibility page goes
--      live as part of this work.
--   2. ContactHash table — stores SHA-256 hashes of a user's E.164 phone
--      contacts so B-Friends-4 can match against User.phone_hash without
--      the server ever seeing the raw numbers. Cascades on User delete.
--   3. Friendship extension — personalNote (≤160), expiresAt, resolvedAt.
--      The existing pending-friendship mechanism gains a freeform note,
--      a 30-day expiry, and a resolved-at timestamp. B-Friends-2 wires
--      the lifecycle endpoints. Two CHECK constraints (note length and
--      "users distinct") plus two partial indexes for the expiry cron
--      and the post-resolution decay GC.
--
-- Idempotent guards mirroring this migration also land in
-- src/instrumentation.ts so preview/production databases that may have the
-- migration recorded without the columns/constraints actually present can
-- still boot.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "discoverable_by_contacts" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "discoverable_by_mutual_friends" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ContactHash" (
  "userId"     text NOT NULL,
  "phoneHash"  text NOT NULL,
  "uploadedAt" timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("userId", "phoneHash")
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ContactHash_userId_User_id_fk'
      AND conrelid = to_regclass('public."ContactHash"')
  ) THEN
    ALTER TABLE "ContactHash"
      ADD CONSTRAINT "ContactHash_userId_User_id_fk"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ContactHash_phoneHash_idx" ON "ContactHash" ("phoneHash");
--> statement-breakpoint
ALTER TABLE "Friendship"
  ADD COLUMN IF NOT EXISTS "personalNote" text;
--> statement-breakpoint
ALTER TABLE "Friendship"
  ADD COLUMN IF NOT EXISTS "expiresAt" timestamptz;
--> statement-breakpoint
ALTER TABLE "Friendship"
  ADD COLUMN IF NOT EXISTS "resolvedAt" timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'Friendship'
      AND constraint_name = 'friendship_personal_note_length'
  ) THEN
    ALTER TABLE "Friendship"
      ADD CONSTRAINT friendship_personal_note_length
      CHECK (char_length("personalNote") <= 160);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'Friendship'
      AND constraint_name = 'friendship_users_distinct'
  ) THEN
    ALTER TABLE "Friendship"
      ADD CONSTRAINT friendship_users_distinct
      CHECK ("userAId" <> "userBId");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Friendship_expiresAt_pending_idx"
  ON "Friendship" ("expiresAt") WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Friendship_resolvedAt_decay_idx"
  ON "Friendship" ("resolvedAt") WHERE status IN ('declined', 'expired');
