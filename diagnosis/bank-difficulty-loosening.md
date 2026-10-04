---
name: bank-difficulty-loosening
status: active
opened: 2026-10-03
last-reviewed: 2026-10-04
owner: Josh
related-pr: "#1743, #1744"
---

# Diagnosis: loosened bank difficulty rule

_Started 2026-10-03 · Owner: Josh · Working branch: `feat/bank-difficulty-loosening`, PR #1744 (miss reasons: #1743)_

**This is an experiment being measured, not a settled rule.** On 2026-10-03 we
deliberately LOOSENED the "never talk down to the player" bank rule so the
Daily Five can reuse more existing questions instead of paying to write fresh
ones. This file exists so that loosening is never forgotten: it records what
changed, how to turn it off, and what the daily `/diagnosis-review` must check.

---

## 1. What triggered this

- 30-day LLM spend went from $21.78 to $39.13 (2026-09-03 → 10-03). About half
  is fresh question writing, which happens whenever a Daily Five slot can't be
  filled from the bank.
- A read-only re-check of 213 bank misses (14 days) against the live bank:
  **56%** had unused stock on the topic, but only at a difficulty the ±1 tier
  ladder won't reach (typically: specialist asked, only accessible left);
  **30%** were topics the player had answered out; **15%** were empty topics.
- PR #1743 (merged) fixed the misleading `missReason` telemetry (it used to guess
  from the ladder's shape). PR #1744 adds the loosened rule below.

## 2. What changed (the loosening)

- Code: `bankLooseTiers` / `bankLooseTierMaxPerBuild` in
  `src/server/daily/generate-questions.ts`, applied in `pickBankPicksForDomains`.
- **Before:** a bank pick could be the requested tier, one step up, or one step
  down (never below the domain floor). Two steps was never allowed.
- **Now:** if that ±1 ladder finds nothing, the build may take **one** pick per
  build (default) from the tier two steps away, nearest first, still never
  below the domain floor. Two steps UP is also allowed (harder is never
  condescending).
- Only the core Daily Five path. The +2 friend-bonus path passes no floors, so
  its "accessible only" target is untouched. Outside a build nothing loosens.
- Every loosened pick is flagged `loosened: true` on its
  `DailyBuildMetric.bank_attempts` entry and logged as `[daily/bank-loosened]`.
- **Off switch:** set `BANK_LOOSE_TIER_MAX_PER_BUILD=0` in Vercel and redeploy.
  A larger number allows more loosened picks per build.

## 3. Open decisions

1. After two weeks live: keep the loosening at 1 pick per build, raise it, or
   turn it off (`0`)?
2. If loosened picks are answered correctly far more often than normal picks
   (a "too easy" signal), should loosening go UP only (harder), never down?

## 4. Baseline (before the loosening; 2026-09-26 → 10-02)

| Measure | Value |
|---|---|
| Bank hit rate (Q1) | ~42% (105 hits / 247 attempts) |
| Fresh generate calls per built build (Q2) | ~3.2 |
| Correct-answer rate on normal hits (Q3) | 27–63% depending on tier pair — a rough, relative signal only (the copy→Question link is approximate) |
| Loosened picks | 0 (rule not live) |

## 5. The checks (read-only; run each review)

Run against prod with the usual read-only pattern (`node --env-file=.env
node_modules/tsx/dist/cli.mjs <script>.ts`, PowerShell). Rows recorded before
#1743 deployed have guessed `missReason` labels, and rows before #1744 deployed
can't carry the `loosened` flag — only compare rows after those deploy dates.

**Q1 — is it firing, and did the bank hit rate move?**
```sql
SELECT m.started_at::date AS day,
       count(*) FILTER (WHERE a->>'outcome' = 'hit')  AS hits,
       count(*) FILTER (WHERE a->>'outcome' = 'miss') AS misses,
       round(100.0 * count(*) FILTER (WHERE a->>'outcome' = 'hit') / nullif(count(*), 0), 1) AS hit_pct,
       count(*) FILTER (WHERE (a->>'loosened')::boolean) AS loosened,
       count(DISTINCT m.build_id) FILTER (WHERE (a->>'loosened')::boolean) AS builds_loosened
FROM "DailyBuildMetric" m, jsonb_array_elements(m.bank_attempts) a
WHERE m.started_at > now() - interval '14 days'
GROUP BY 1 ORDER BY 1;
```

**Q2 — did fresh writing per game go down?**
```sql
SELECT m.started_at::date AS day, count(*) AS builds,
       round(avg(m.generate_call_count), 2) AS gen_calls_per_build
FROM "DailyBuildMetric" m
WHERE m.started_at > now() - interval '14 days' AND m.outcome = 'built'
GROUP BY 1 ORDER BY 1;
```

**Q3 — are loosened questions landing badly (too easy / too hard)?**
```sql
WITH picks AS (
  SELECT m.user_id, m.started_at, m.completed_at, a->>'domain' AS domain,
         a->>'tierRequested' AS req, a->>'tierServed' AS srv,
         coalesce((a->>'loosened')::boolean, false) AS loosened
  FROM "DailyBuildMetric" m, jsonb_array_elements(m.bank_attempts) a
  WHERE m.started_at > now() - interval '30 days' AND a->>'outcome' = 'hit'
), served AS (
  SELECT DISTINCT ON (p.user_id, p.started_at, p.domain) p.*, g.id AS gq_id
  FROM picks p
  JOIN "GeneratedQuestion" g
    ON g.user_id = p.user_id
   AND lower(g.canonical_subcategory) = lower(p.domain)
   AND g.difficulty_estimate = p.srv
   AND g.created_at BETWEEN p.started_at AND p.completed_at + interval '5 minutes'
)
SELECT s.loosened, s.req, s.srv, count(*) AS picks,
       count(me.id) AS answered_correct,
       round(100.0 * count(me.id) / nullif(count(*), 0), 1) AS correct_pct
FROM served s
LEFT JOIN "Question" cq ON cq.generated_question_id = s.gq_id
LEFT JOIN "MASTERY_EVENTS" me ON me.question_id = cq.id
  AND me.answered_by_user_id = s.user_id
  AND me.source_type IN ('live_correct', 'catchup_correct')
GROUP BY 1,2,3 ORDER BY 1 DESC, 4 DESC;
```

Also check the miss mix (now honest): `missReason` counts for the window
(`no_stock` / `fact_history` / `tier` / `filtered` / `unknown`). `unknown`
above a handful means the diagnosis query is failing — look at logs.

## 6. Exit criteria (when to decide)

- **Keep (status → done):** after ≥14 days live, hit rate up and/or
  `gen_calls_per_build` down vs. the §4 baseline, and loosened picks' correct
  rate not wildly above normal hits of the served tier, and no player complaint
  about "too easy" questions.
- **Turn off:** loosened picks look clearly condescending (Josh's judgment,
  helped by Q3), or a player complains. Set `BANK_LOOSE_TIER_MAX_PER_BUILD=0`.
- **Raise the cap:** savings are real, quality looks fine, and Q1 shows many
  builds still missing with `missReason = 'tier'`.

## 7. Recommendation (as of 2026-10-03)

Ship at 1 pick per build and measure for two weeks. Volume is small (~4 builds
a day), so expect noisy numbers. Read the trend, and read Josh's own sense of
whether the easier questions felt wrong.

---

## Updates

### 2026-10-03
Opened. Loosened rule built on `feat/bank-difficulty-loosening` (PR #1744) with the
off switch and per-pick flag. Queries Q1–Q3 run read-only against prod and
return the §4 baseline. Nothing live until #1744 merges and deploys.

### 2026-10-04 (diagnosis-review) — first review since open; both PRs confirmed merged, but the loosening hasn't had a chance to fire yet; #1743's honest miss-reason labels show up for the first time on 2026-10-03

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**PR state, confirmed via the GitHub API directly, not inferred from git
log:** `#1743` ("fix(daily): honest bank-miss reasons + loosen the bank
difficulty rule") merged to `main` **2026-10-03T15:57:01Z**; `#1744`
("feat(daily): loosen the bank difficulty rule by one pick per build")
merged to `main` **2026-10-03T17:27:20Z**. Diffed both directly rather than
trusting titles: `#1743` touches only `pickBankSource` /
`bankMissReasonFromCounts` in `src/server/db/queries/daily.ts` (the honest
miss-reason telemetry); `#1744` adds `bankLooseTierMaxPerBuild` /
`bankLooseTiers` to `generate-questions.ts` and new `BankAttempt` fields /
`loosenedBankPicksSoFar` / `noteLoosenedBankPick` to `build-context.ts`
(the loosening itself). Matches this doc's own §1/§2 description exactly.

**The loosening has not yet had a chance to fire in production.** The
2026-10-03 cron runs at 17:05 UTC; `#1744` deployed at 17:27:20Z — *after*
that day's cron had already run. Q1, run for the trailing 14 days, shows
`loosened: 0` and `builds_loosened: 0` on **every** day including
2026-10-03 itself, and no 2026-10-04 row exists yet in this query. This is
expected, not a problem: the first build that could possibly show a
loosened pick is the next cron run after the 17:27 UTC deploy, which this
session has not yet observed.

**Q1 — pre-loosening baseline, reconfirmed over the trailing 14 days
(2026-09-20 through 2026-10-03):** 179 hits / 231 misses across the window
(43.7% blended hit rate), consistent with the §4 baseline's ~42% — no
anomaly, as expected since no loosened code has run yet. Day-to-day hit
rate is noisy (21.4%–67.6%), same volatility the doc's own §7
recommendation anticipated ("volume is small, expect noisy numbers").

**Q2 — gen_calls_per_build, reconfirmed:** ranges 2.00–6.00 across the
window, consistent with the ~3.2 baseline given the small per-day sample
(1–4 builds/day); no anomaly.

**New finding, directly relevant to this doc's own §5 checks: the honest
`missReason` labels from `#1743` appear for the first time on
2026-10-03** (the day it merged), and the mix looks different from every
prior day's guessed labels:

| day | miss_reason | count |
|---|---|---:|
| 2026-10-03 | `fact_history` | 1 |
| 2026-10-03 | `filtered` | 11 |
| 2026-10-03 | `no_stock` | 6 |
| 2026-10-03 | `tier` | 6 |

Every prior day in the 14-day window shows only `no_stock`/`tier` (the
guessed pre-#1743 labels this doc's §5 explicitly warns not to compare
across the deploy boundary). On the first honest day, `tier` is only 6 of
24 misses (25%) — much smaller than the pre-change read implied `tier`
alone explained the bulk of misses — and `filtered` (a label that didn't
exist before `#1743`) is the single largest category at 11 of 24 (46%).
One day is not a trend, and this is exactly the caveat this doc's §5
already names ("rows recorded before #1743 deployed have guessed
`missReason` labels... only compare rows after those deploy dates") — but
it's worth flagging precisely since it's the first real data point for
decision 1's eventual read, once a few more honest-labeled days
accumulate.

**Not resolving anything.** The exit criteria (§6) require ≥14 days live
with the loosening actually firing; today is day 0 of that window and no
loosened pick has been observed yet. Status stays `active`.

### Next steps
1. Confirm the loosening actually fires on the next cron after the
   2026-10-03T17:27:20Z deploy — re-run Q1 and look for the first
   `loosened: true` pick.
2. Once loosened picks start appearing, begin the ≥14-day live-measurement
   clock for the §6 exit criteria.
3. Keep watching the honest `missReason` mix (`#1743`) accumulate more
   days before reading anything into the 2026-10-03 split.
4. Q3 (loosened-pick correct-rate) has nothing to measure yet — no
   loosened picks exist.
