-- Migration: scope-aware USER_DOMAIN_EXCLUSIONS so users can exclude a single
-- subcategory ("Pee-wee's Playhouse"), a broader category ("Saturday morning
-- cartoons"), or a top-level category enum value ("film_tv"). The familiarity
-- slider in the daily client writes one of these scopes per click.
--
-- Idempotent guards: CREATE TYPE and ADD CONSTRAINT have no native IF NOT
-- EXISTS, so both are wrapped in DO ... EXCEPTION WHEN duplicate_object.
-- Mirrors src/instrumentation.ts.
DO $$ BEGIN
  CREATE TYPE "public"."DomainExclusionScope" AS ENUM('subcategory', 'broad_category', 'category');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "USER_DOMAIN_EXCLUSIONS"
  ADD COLUMN IF NOT EXISTS "scope" "public"."DomainExclusionScope" NOT NULL DEFAULT 'subcategory';
--> statement-breakpoint
ALTER TABLE "USER_DOMAIN_EXCLUSIONS"
  DROP CONSTRAINT IF EXISTS "USER_DOMAIN_EXCLUSIONS_user_id_canonical_subcategory_key";
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "USER_DOMAIN_EXCLUSIONS"
    ADD CONSTRAINT "USER_DOMAIN_EXCLUSIONS_user_id_scope_canonical_subcategory_key"
    UNIQUE ("user_id", "scope", "canonical_subcategory");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
