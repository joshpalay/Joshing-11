ALTER TABLE "DailyPreference" ADD COLUMN IF NOT EXISTS "difficulty" text NOT NULL DEFAULT 'adaptive';
--> statement-breakpoint
ALTER TABLE "DailyPreference" ADD COLUMN IF NOT EXISTS "domain_mode" text NOT NULL DEFAULT 'random';
--> statement-breakpoint
ALTER TABLE "DailyPreference" ALTER COLUMN "selected_domains" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "DailyPreference" ALTER COLUMN "selected_domains" TYPE jsonb USING to_jsonb(coalesce("selected_domains", ARRAY[]::text[]));
--> statement-breakpoint
ALTER TABLE "DailyPreference" ALTER COLUMN "selected_domains" SET DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "DailyPreference" ALTER COLUMN "selected_domains" SET NOT NULL;
--> statement-breakpoint
UPDATE "DailyPreference"
SET
  "difficulty" = CASE
    WHEN "difficulty_preference" IN ('normal', 'moderate', 'challenging', 'ridiculous', 'adaptive')
      THEN "difficulty_preference"
    ELSE 'adaptive'
  END,
  "domain_mode" = CASE
    WHEN jsonb_array_length("selected_domains") > 0 THEN 'custom'
    ELSE 'random'
  END,
  "updated_at" = now();
