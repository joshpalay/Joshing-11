# Things to Check Regularly

Operational runbook: the reports, audits, and checks worth running on a cadence —
what to look at, where it lives, and how often. Keep this list curated; when you
add a new dashboard, diagnostic, or invariant guard, add a line here.

Cadence tags used below: **[commit]** before a commit/PR · **[weekly]** ·
**[release]** before a release / pre-launch sign-off · **[post-launch]** once
there's real production traffic.

---

## 1. Reports & dashboards

### Expansion-offer funnel (the post-daily-Five "branch out" offer)
The offer fires when a player tops a domain's difficulty ladder yet still out-runs
its content (Part 2 supply-ceiling). Two views, by design:

- **Axiom dashboard — "Expansion offer funnel"** `[weekly] [post-launch]`
  Owner `X-AXIOM-EVERYONE` (visible to the org), UID `7e2fc550-ad2c-422e-a7f8-a4558ac4adaa`.
  Five panels off the `[expansion-offer]` logs in the `vercel` dataset: total
  **eligible / shown / resolved**, the funnel over time, and **triggers by domain**.
  This is where the **accept-vs-dismiss** split lives (the `resolved` log carries
  `accepted` / `addedCount` / `dismissed`).
  *What "healthy" looks like:* `shown` ≈ `eligible` over time (offers that trigger
  get seen), and a non-trivial `accepted` share. A pile of `eligible` with no
  `resolved` = players seeing it and ignoring it — revisit the copy/placement.

- **DB diagnostic — `/dev/expansion-offer`** `[weekly]`
  Reads `USER_DOMAIN_DIFFICULTY` directly: totals (eligible / resolved / pending +
  resolve-rate), a by-domain breakdown, and a recent-triggers table. Durable state,
  instant, no log-retention dependency — but can't tell accept from dismiss (that's
  the Axiom view). Linked from **Profile → Developer tools → "Expansion offer funnel"**.

### Points diagnostic — `/dev/points-diagnostic` `[as needed]`
Every `MASTERY_EVENTS` row for a given user (live answers, catchup, author credit,
meta events), filterable by category/difficulty/source/date, with CSV export. Use
when a player's points or mastery tier look wrong.

> The other `/dev/*` routes (onboarding, welcome-tour, first-time-player,
> invite-login, loading-preview, expand-preview) are **UI preview harnesses**, not
> data reports — they render flows on demand and mutate nothing.

---

## 2. Audits

- **Ledger — `audits/AUDIT-TRACKER.md`** `[weekly]`
  The living audit ledger. Skim for any items not yet `DONE` / `DEFERRED` /
  `WON'T DO`. Individual audit findings live as dated files under `audits/`.

- **Run a PRD audit — `PRD-AUDIT-PROMPT.md` (and the `prd-audit` skill)** `[release]`
  Runs the project's audit prompt against a PRD section and writes findings to
  `audits/`. Run against the `PRD-D-*` section for any surface you've changed
  materially before sign-off.

- **Open decisions to revisit — `DECISIONS.md`** `[weekly] [release]`
  Several decisions ship behind a "revisit after the test" note (e.g. niche-match
  production default, via-answerer attribution privacy, the authored-domain
  reconcile flip, the Playables 4→5 cap). Re-read the open section periodically and
  close or re-decide ones whose test window has passed.

---

## 3. Code-health checks (run before every commit/PR; these gate CI)

| Check | Command | Guards |
|---|---|---|
| Lint | `npm run lint` | ESLint over `src/` |
| Typecheck | `npx tsc -p tsconfig.typecheck.json` | strict TS (don't commit `.tsbuildinfo`) |
| Fonts ratchet | `npm run check:fonts` | off-system font-families ≤ ceiling |
| Colors ratchet | `npm run check:colors` | off-system hex/rgb/hsl ≤ ceiling |
| Spacing ratchet | `npm run check:spacing` | arbitrary `p-/m-/gap-/space-[…]` ≤ ceiling |
| Radius ratchet | `npm run check:radius` | literal arbitrary `rounded-[Npx]` ≤ ceiling |
| Tests | `npm test` | full Vitest suite |

All four ratchets in one go:
`npm run check:fonts && npm run check:colors && npm run check:spacing && npm run check:radius`

Also: the **`check-middleware`** skill — confirm there's no `src/middleware.ts`
(this repo uses `src/proxy.ts`; the `middleware.ts` variant has been reverted
several times). Run after merges or when routing feels off.

---

## 4. Invariant smoke tests (run the one for the surface you touched) `[commit]`

Boundary guards over load-bearing invariants — cheap, run on demand:

| Command | Surface / spec |
|---|---|
| `npm run smoke:daily-catchup` | catch-up dedup/order + 7-day eligibility |
| `npm run smoke:house-authorship` | D-3 house author + D-1 feed invariants |
| `npm run smoke:lately-milestones` | D-4 dual-form milestones + 5-cap |
| `npm run smoke:niche-match-dedup` | D-2 niche-match non-collision |
| `npm run smoke:first-five-seeding` | first-five seeding |
| `npm run smoke:invite-first-five` | first-five in the invite flow |
| `npm run smoke:question-vetting` | question creation/validation |
| `npm run smoke:sms-message-types` | SMS message-type routing |
| `npm run smoke:gameplay` | full playtest harness |

---

## 5. Data & migration checks

- **After hand-writing a migration** `[commit]` — `node scripts/reconcile-drizzle.mjs`
  (report-only; keeps `drizzle/*.sql` and `drizzle/meta/_journal.json` in lockstep).
  Apply migrations with `npm run db:migrate` (they also auto-apply at boot).
- **Account-deletion integrity** `[release]` — `npm run verify:account-deletion`
  (runs against a live DB; seeds the deletion-territory scenario, deletes, asserts
  retention/anonymization/FK cleanup, self-cleans). Run before pre-launch sign-off.
- **Backfills (run with `:apply` only after the dry run looks right):**
  `npm run pool:embed-backfill` (question embeddings),
  `npm run knowledge:casing-backfill` (domain casing),
  `npm run knowledge:broad-category-backfill` (broad categories).

---

## 6. Observability & monitoring `[post-launch]`

- **Axiom log tags** (the `vercel` dataset; structured object inlines into `message`):
  - `[expansion-offer]` — the funnel above (`eligible` / `shown` / `resolved`).
  - `[instrumentation boot]` — once per cold start: `{ guards_ran, guards_ms, migrate_ms, total_ms }`.
    Sanity-check: production should show guards skipped (`SKIP_BOOT_DB_GUARDS=1`),
    preview/dev should run the ~70 guards.
  - `[perf]` / `[latency]` — prepped; **needs a Vercel/Axiom log drain wired up**
    before p50/p95 can be measured (open item, see `_docs/PERF-FINDINGS-01.md`).
- **Supabase advisors** — re-run periodically (and ~2 weeks after launch) to flag
  unindexed FKs and unused indexes.
- **Performance targets** (PRD §12.6, unverified until real traffic): home < 1.5s,
  Daily Five reveal < 800ms, deterministic grade < 200ms, LLM grade < 2s, feed < 1s.
- **Migration tracking drift** — `__drizzle_migrations` on the shared Supabase DB is
  partially-recorded (boot guards repair schema idempotently). If a migration looks
  applied-but-absent, verify the actual schema, not just the tracking table. (The
  `0084` `FeedItem_viaUserId_User_id_fk` FK was one such gap, now fixed.)

---

## Quick cadence summary

- **Before commit/PR:** ratchets · lint · typecheck · the relevant smoke test · `reconcile-drizzle` if you wrote a migration.
- **Weekly:** expansion-offer funnel (Axiom + `/dev/expansion-offer`) · `audits/AUDIT-TRACKER.md` · `DECISIONS.md` open items.
- **Before a release:** full `npm test` · `verify:account-deletion` · a PRD audit of changed surfaces · confirm boot-log guard posture.
- **Post-launch:** Axiom tags for anomalies · Supabase advisors · p50/p95 vs targets (once the log drain is wired) · re-decide expired open items.
