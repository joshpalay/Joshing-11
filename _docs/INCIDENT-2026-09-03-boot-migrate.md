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
- **Not dormant.** Production is actively serving: 10 Daily Five queues built
  in the trailing week, 2 in the last 24 hours, most recent 2026-09-04 17:05
  UTC. A destructive migration on the same path would not have been
  recoverable.

## Two DDL paths, not one

`register()` writes schema along **two independent routes**, and the incident
review initially accounted for only one:

1. the **~70 idempotent boot guards** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE
   IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) — **unjournalled**, and they
   run **before** `migrate()`; and
2. **`migrate()`** — journalled.

`SKIP_BOOT_DB_GUARDS` is set only in production. The incident boot was a *dev*
process pointed at production, so the flag was unset and **the guard chain
executed DDL against the production database**, ahead of `migrate()`.

Which route actually created the 0136 columns is **not recoverable**: both use
identical `IF NOT EXISTS` DDL — including the same partial index predicate — so
the live schema cannot discriminate, and the guard block was uncommitted at the
time of the boot. What is certain is that `migrate()` ran (the ledger row and
the backfill `UPDATE` exist only there), and that the guard chain ran too.

This split is why "what actually applied?" was hard to answer. Unifying the two
routes is a larger change; the guard below covers **both**.

## Why it was not caught

The dangerous property was the **connection target**, but every mental check in
play keyed on the **environment name**. `NODE_ENV` was `development`, the
command was `npm run dev`, the branch was local — everything said "safe", and
none of it was the thing that mattered.

## Fix

`src/server/db/migrate-safety.ts` — `decideBootSchemaWrite()` gates the entire
schema-writing phase, positioned **above the guard chain** so it covers both
routes. A boot may write schema only when one of:

| condition | rationale |
|---|---|
| target host is loopback | a developer's own database |
| `VERCEL_ENV === 'production'` | a production deploy; must migrate exactly as before |
| `ALLOW_REMOTE_BOOT_MIGRATE=1` | deliberate, per-run, explicit — and logged loudly |

**Not** the presence of `VERCEL`: that variable is set on *every* Vercel
deployment including previews. Keying on it would let any branch that receives a
preview deploy write schema to whatever `DATABASE_URL` that environment
resolves to — the same incident, sourced from CI instead of a laptop, and
permitted by the guard. Previews now need the explicit override, set once as a
Preview-scoped variable: a deliberate act visible in the dashboard rather than
an accident of branch naming.

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
- [ ] **If preview deployments have their own database**, set
      `ALLOW_REMOTE_BOOT_MIGRATE=1` on the Preview environment in Vercel, or
      previews will stop auto-migrating and drift. If previews share the
      production string, leave it unset — that is the hole this closes.
- [ ] Consider unifying the two DDL routes so schema reaches the database only
      through the journal. The guard covers both today; it does not merge them.
- [ ] Consider separating local and production credentials entirely, so a dev
      environment cannot reach production at all. Strictly stronger than this
      guard, and larger than one change.
