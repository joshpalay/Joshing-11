# Incident — a dev-server boot applied migrations to production

**Date:** 2026-09-03, 00:53 UTC
**Detected:** 2026-09-04, during review of PR #1597
**Severity:** no user impact; recoverable. Near-miss on a class that would not have been.

---

## What happened

Starting `npm run dev` on an unmerged feature branch applied migration
`0136_daily_build_metrics.sql` to the **production** database.

Three things combined, none of them individually wrong:

1. This repo's local `.env` `DATABASE_URL` points at production (long-standing,
   documented — local development shares the production database).
2. `register()` in `src/instrumentation.ts` calls `migrate()` on every boot.
3. `migrate()` applies **every pending migration on the current branch**, not a
   named one.

So a local process, on a branch that had never been reviewed or merged, made a
schema change to a live database as a side effect of starting up.

## Blast radius

- **Schema applied:** `DailyQueue.target_size`, `DailyQueue.build_completed_at`,
  `LlmUsageEvent.build_id`, and the `DailyBuildMetric` table.
- **Data written:** the `0136` backfill set `target_size` from *all* slots. A
  Daily Five queue is five core slots plus up to two optional bonus slots, so
  the modal 7-slot queue was written as `target_size = 7`. **148 rows** got a
  value above 5.
- **User impact: none.** No application code reads `DailyQueue.target_size`
  (re-verified 2026-09-04); production was running the old code against a
  slightly newer schema, which is benign. `DailyBuildMetric` remained empty.
- **Not dormant.** Production was actively serving: 10 queues, 80 answers, and
  5 distinct users in the trailing week. A destructive migration on the same
  path would not have been recoverable.

## Why it was not caught

The dangerous property was the **connection target**, but every mental check in
play keyed on the **environment name**. `NODE_ENV` was `development`, the
command was `npm run dev`, the branch was local — everything said "safe", and
none of it was the thing that mattered.

## Fix

`src/server/db/migrate-safety.ts` — `decideBootMigrate()` gates the boot
`migrate()` call. A boot may auto-apply migrations only when one of:

| condition | rationale |
|---|---|
| target host is loopback | a developer's own database |
| `VERCEL` is set | a real deploy; production must migrate exactly as before |
| `ALLOW_REMOTE_BOOT_MIGRATE=1` | deliberate, per-run, explicit |

Otherwise it **warns and skips the migrate** — the app still boots and serves
requests; only the automatic schema change is withheld. It deliberately does
**not** consult `NODE_ENV`, because that is precisely the signal that said
"safe" during the incident.

Fails closed on an absent or unparseable connection string: the cost of a
wrongly-skipped local migration is one manual command; the cost of a
wrongly-allowed remote one is this incident.

Verified against this repo's real `.env`: **refused**.

## Data correction

`0137_target_size_core_only.sql` sets every `target_size` to `NULL` and drops
`NOT NULL DEFAULT 5`.

- `NULL`, not a corrected number: core and bonus slots cannot be reliably
  separated on historical rows, and `LEAST(5, …)` would be a positional
  heuristic that breaks on skip-extended queues — quietly wrong rather than
  visibly unknown.
- Dropping the default matters independently: `NOT NULL DEFAULT 5` made an
  *unwritten* `target_size` indistinguishable from a deliberate one, so a build
  landing short would silently carry 5 and strand the player. **An unwritten
  value must be visible, not plausible.**
- `0136` is **not** edited. It has been applied; editing an applied migration
  diverges the journal from the applied state.

## Related finding

`0135_user_invite_links.sql` was **edited after it had been applied** (an
idempotency wrapper was added to a `CHECK` constraint after a failed boot).
Semantically harmless — the edit only made a re-run safe — but its file hash no
longer matches the applied row. Same rule, same reason: once applied, correct
forward.

## Follow-ups

- [ ] Deliver `0137` by a deliberate path (`npm run db:migrate` or a deploy),
      **not** by another boot — the broken mechanism must not deliver the fix
      for what the broken mechanism did.
- [ ] Consider separating local and production credentials entirely, so a dev
      environment cannot reach production at all. Strictly stronger than this
      guard, and larger than one change.
