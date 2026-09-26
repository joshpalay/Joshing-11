-- Give "HiddenQuestion"."id" the database default every other table has.
--
-- Migration 0131 created the table as `"id" text PRIMARY KEY NOT NULL` with no
-- DEFAULT, while the Drizzle schema's shared id() helper declares
-- `DEFAULT gen_random_uuid()::text` and so never sends a value. Every insert
-- therefore wrote `id = DEFAULT` -> NULL and failed with 23502 (not-null
-- violation). "Never show this question" has returned a 500 since 0131 shipped;
-- the table had zero rows in production as of 2026-09-26 (QA report C1, prod
-- logs 2026-09-26 14:54Z / 14:55Z).
--
-- Setting a column default is metadata-only (no table rewrite, no lock beyond a
-- brief ACCESS EXCLUSIVE) and re-running it is harmless.
--
-- Rollback:
--   ALTER TABLE "HiddenQuestion" ALTER COLUMN "id" DROP DEFAULT;
-- (which restores the broken insert path -- only do this alongside reverting
-- the hide feature.)

ALTER TABLE "HiddenQuestion" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
