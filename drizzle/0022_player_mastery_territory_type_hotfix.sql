ALTER TABLE "PLAYER_MASTERY" ADD COLUMN IF NOT EXISTS "territory_type" text DEFAULT 'demonstrated' NOT NULL;
--> statement-breakpoint
UPDATE "PLAYER_MASTERY" SET "territory_type" = 'demonstrated' WHERE "territory_type" IS DISTINCT FROM 'demonstrated';
