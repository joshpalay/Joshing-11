ALTER TABLE "PROFILE_DOMAIN_VISIBILITY"
ADD COLUMN IF NOT EXISTS "domain" TEXT;
--> statement-breakpoint
UPDATE "PROFILE_DOMAIN_VISIBILITY"
SET "domain" = "canonical_subcategory"
WHERE "domain" IS NULL OR btrim("domain") = '';
--> statement-breakpoint
ALTER TABLE "PROFILE_DOMAIN_VISIBILITY"
ALTER COLUMN "domain" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "PROFILE_DOMAIN_VISIBILITY"
ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'public';
--> statement-breakpoint
UPDATE "PROFILE_DOMAIN_VISIBILITY"
SET "visibility" = CASE WHEN "is_visible" THEN 'public' ELSE 'private' END
WHERE "visibility" NOT IN ('public', 'friends', 'private');
--> statement-breakpoint
ALTER TABLE "PROFILE_DOMAIN_VISIBILITY"
ADD CONSTRAINT "PROFILE_DOMAIN_VISIBILITY_visibility_check"
CHECK ("visibility" IN ('public', 'friends', 'private'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "PROFILE_DOMAIN_VISIBILITY_user_id_domain_key"
ON "PROFILE_DOMAIN_VISIBILITY" ("user_id", "domain");
