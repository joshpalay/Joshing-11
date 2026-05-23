-- Migration: introduce TerritoryType enum on PLAYER_MASTERY.territory_type.
--
-- Idempotent guards: Postgres has no native CREATE TYPE IF NOT EXISTS, so we
-- wrap in DO ... EXCEPTION WHEN duplicate_object. The column conversion is
-- gated on the column's current udt_name so re-runs against an already-
-- converted DB are no-ops. Matches the pattern in src/instrumentation.ts.
DO $$ BEGIN
  CREATE TYPE "public"."TerritoryType" AS ENUM('declared', 'demonstrated');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'PLAYER_MASTERY'
      AND column_name = 'territory_type'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE "PLAYER_MASTERY" ALTER COLUMN "territory_type" DROP DEFAULT;
    ALTER TABLE "PLAYER_MASTERY"
      ALTER COLUMN "territory_type"
      SET DATA TYPE "public"."TerritoryType"
      USING "territory_type"::"public"."TerritoryType";
    ALTER TABLE "PLAYER_MASTERY"
      ALTER COLUMN "territory_type"
      SET DEFAULT 'demonstrated'::"public"."TerritoryType";
  END IF;
END $$;
