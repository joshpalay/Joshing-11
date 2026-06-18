---
name: new-migration
description: Scaffold the next Drizzle migration following the repo's numbering convention, schema parity, and instrumentation guards. Invoke when starting any schema change.
argument-hint: <description of the migration, e.g. "add tags table">
allowed-tools: Bash(ls:*), Bash(npx drizzle-kit:*), Bash(cat:*), Bash(git diff:*), Read, Edit, Write, Grep
---

# New Drizzle migration: $ARGUMENTS

Create the next Drizzle migration for: **$ARGUMENTS**

## Repo conventions to honor

- ORM is Drizzle, not Prisma. Older docs in `_docs/` may say otherwise — ignore them.
- Migrations live in `drizzle/NNNN_*.sql`, numbered sequentially.
- Schema source of truth: `src/server/db/schema.ts`.
- Migrations are auto-applied at boot via `src/instrumentation.ts`.
- Postgres pool is capped at `max: 5` in `src/server/db/index.ts:24` (Supabase PgBouncer constraint — see commit 2aafbb1). Don't write migrations that assume a higher connection count.
- **RLS on every new table (B-SECURITY-RLS-01).** Tables in `public` are auto-granted to Supabase's `anon`/`authenticated` Data API roles by default privileges, so a new table is readable/writable over the public Data API the moment it's created. Every `CREATE TABLE` migration MUST be followed by `ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;` (no policies — the app connects as the owner `postgres`, which bypasses RLS). See migration `0081_enable_rls_public_tables`. Skipping this re-opens the hole 0081 closed and trips the Supabase `rls_disabled` advisor.

## Steps

1. List `drizzle/` and find the highest-numbered `NNNN_*.sql` file. The new migration uses `NNNN+1`.
2. Update `src/server/db/schema.ts` to reflect the change implied by `$ARGUMENTS`. Show the user the diff before generating SQL. If anything about the intent is ambiguous, ask before editing.
3. Generate the SQL: `npx drizzle-kit generate`. Confirm the filename matches the expected `NNNN+1` prefix; if it doesn't, rename it.
4. Read the generated SQL. If it includes any of the following, stop and warn the user:
   - `ADD COLUMN ... NOT NULL` without a `DEFAULT` (will fail on non-empty tables)
   - `DROP COLUMN` or `DROP TABLE` on a table that may have production data
   - `ALTER COLUMN ... TYPE` changes that aren't trivially safe
   - `CREATE INDEX` on a large table without `CONCURRENTLY`
5. If the migration creates any new table, append `ALTER TABLE "<name>" ENABLE ROW LEVEL SECURITY;` for each new table (see the RLS convention above and migration `0081`). `drizzle-kit generate` does NOT emit this — it must be added by hand.
6. Check `src/instrumentation.ts`. Migrations 0006 and 0009 set a precedent — if this migration depends on data being in a particular shape, add a defensive guard there. Reference the precedent explicitly.
7. Add a header comment at the top of the generated `.sql` file: one paragraph explaining the change in human terms, plus the rollback plan in one or two sentences.
8. Do NOT run the migration. Tell the user to run `npm run db:migrate` themselves when ready.
