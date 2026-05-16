CREATE TYPE "public"."TerritoryType" AS ENUM('declared', 'demonstrated');
--> statement-breakpoint
ALTER TABLE "PLAYER_MASTERY"
  ALTER COLUMN "territory_type"
  SET DATA TYPE "public"."TerritoryType"
  USING "territory_type"::"public"."TerritoryType";
