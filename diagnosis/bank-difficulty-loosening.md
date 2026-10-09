---
name: bank-difficulty-loosening
status: active
opened: 2026-10-03
last-reviewed: 2026-10-09
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

### 2026-10-05 (diagnosis-review) — still zero loosened picks ever, now two cron cycles after deploy; the "tier" miss reason is a small share of the post-deploy mix so far, but the sample is thin

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**The loosening has still never fired, all time.** `SELECT count(*) FROM
"DailyBuildMetric" m, jsonb_array_elements(m.bank_attempts) a WHERE
(a->>'loosened')::boolean = true` returns **0** — checked across every row
ever recorded, not just the trailing-14-day window. Only one cron cycle has
run since the 2026-10-03T17:27:20Z deploy that this doc's last entry found
(the 2026-10-04 17:05 UTC cron): two builds, `bd109c6a…` and `88b4457e…`,
18 total bank attempts between them (8 + 10), `loosened: false` on every
attempt.

**Miss-reason mix since deploy (`started_at > '2026-10-03 17:27:20Z'`):**
`fact_history` 4, `no_stock` 3, `filtered` 1, `tier` **1**. Only one of the
nine post-deploy misses is the category this rule targets (the ±1 ladder
finding nothing). That one `tier` miss did not loosen — either the
2-steps-away tier also had no stock, or it landed on a build that had
already spent its one-loosened-pick-per-build allowance on an earlier
attempt (not distinguishable from this query alone). **Not reading this as
a signal either way** — the whole post-deploy population is one cron cycle
and nine misses; a single `tier` miss is nowhere near enough to tell
"the ±1 ladder already covers most of what this was built for" apart from
"this is just too little data yet." The §4 baseline motivating the change
(56% of misses had unused stock reachable only two tiers away) was measured
over 14 days / 213 misses; one day's nine misses can't be compared to it
directly.

**Q1 (trailing 14 days), re-run:** every day from 2026-09-21 through
2026-10-04 still shows `loosened: 0, builds_loosened: 0` — including both
2026-10-03 (deploy day) and 2026-10-04 (the one full cron cycle since).
Blended hit rate over the window is noisy day to day (hits/misses per day
range from 3/11 to 25/12), consistent with the doc's own §7 expectation of
small-volume noise, not itself informative about the loosening since it
hasn't fired.

**Q2 (gen_calls_per_build), re-run:** 2.00–6.00 across the 14-day window,
including 5.00 on 2026-10-03 and 3.50 on 2026-10-04 — both inside the
existing noisy range, no visible shift tied to the deploy (expected, since
the mechanism it would affect hasn't fired yet).

**Q3 has nothing to measure** — still zero loosened picks, same as every
prior reading.

**Not resolving anything — explicitly not due.** The §6 exit criteria need
≥14 days of the loosening actually firing; this doc is at 1 cron cycle
since deploy with zero fires observed in any of them. Status stays
`active`. Flagging prominently rather than burying it, since "hasn't had a
chance to fire yet" (the 2026-10-04 reading) and "fired zero times in the
one cycle it's had" (today) are different facts worth distinguishing, even
though neither changes what this doc should do yet.

### Next steps (revised)
1. Keep watching for the first `loosened: true` pick — still zero, now
   across two cron cycles (2026-10-03, 2026-10-04) since deploy.
2. Once loosened picks start appearing, begin the ≥14-day live-measurement
   clock for the §6 exit criteria.
3. Watch whether the `tier` miss-reason share stays small as more
   post-deploy days accumulate, or whether today's one-miss sample was
   just too thin to read.
4. Q3 (loosened-pick correct-rate) still has nothing to measure.

### 2026-10-06 (diagnosis-review) — still zero loosened picks ever, now two full post-deploy cron cycles; the `tier` miss-reason share stayed flat (still just 1) while other reasons grew

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**The loosening has still never fired, all time.** `SELECT count(*) FROM
"DailyBuildMetric" m, jsonb_array_elements(m.bank_attempts) a WHERE
(a->>'loosened')::boolean = true` returns **0** — checked across every row
ever recorded. Two full cron cycles have now run since the
2026-10-03T17:27:20Z deploy (2026-10-04: 27 builds; 2026-10-05: 26 builds),
both confirmed `loosened: 0` in the per-attempt data — current server time
at this review (2026-10-06 06:26 UTC) is before today's ~17:05 UTC cron, so
today's build hasn't run yet.

**Miss-reason mix since deploy (`started_at > '2026-10-03 17:27:20Z'`),
re-run:** `fact_history` 9 (up from 4), `no_stock` 4 (up from 3), `filtered`
1 (unchanged), `tier` **1 (unchanged)** — the one `tier` miss is still the
same single occurrence the 2026-10-05 entry found; neither of the two new
cron cycles added another. Fifteen total post-deploy misses now, still only
one in the category this rule targets. **Not reading this as a signal
either way, same caution as the last two reviews** — the mechanism needs a
`tier` miss AND unused stock two tiers away AND an unspent per-build
allowance to actually fire, and the data so far says `tier` misses
themselves are rare in this window, not that the mechanism is broken.

**Q1 (trailing 14 days), re-run:** every day from 2026-09-22 through
2026-10-05 still shows `loosened: 0, builds_loosened: 0`. Blended hit rate
remains noisy day to day (21.4%–67.6%), including 2026-10-04 (50.0%) and
2026-10-05 (66.7%) — both inside the existing noisy range, consistent with
the doc's own §7 expectation, not itself informative since the loosening
hasn't fired.

**Q2 (gen_calls_per_build), re-run:** 2.00–6.00 across the 14-day window,
including 3.50 on 2026-10-04 and 2.50 on 2026-10-05 — both inside the
existing noisy range, no visible shift tied to the deploy.

**Q3 has nothing to measure** — still zero loosened picks.

**Not resolving anything — explicitly not due.** The §6 exit criteria need
≥14 days of the loosening actually firing; this doc is at 2 cron cycles
since deploy with zero fires observed in either. Status stays `active`.

### Next steps (unchanged)
1. Keep watching for the first `loosened: true` pick — still zero, now
   across two full post-deploy cron cycles (2026-10-04, 2026-10-05).
2. Once loosened picks start appearing, begin the ≥14-day live-measurement
   clock for the §6 exit criteria.
3. Watch whether the `tier` miss-reason share stays small (still just 1 of
   15 post-deploy misses) as more days accumulate.
4. Q3 (loosened-pick correct-rate) still has nothing to measure.

### 2026-10-07 (diagnosis-review) — the first loosened pick ever fired, on the 2026-10-06 cron; the ≥14-day measurement clock has not started yet (one fire is not "live")

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**Headline: the loosening fired for the first time, 3 cron cycles after
deploy.** `SELECT count(*) ... WHERE (a->>'loosened')::boolean = true`
now returns **1** (was 0 on every prior review). The single fire, read in
full:

| build_id | user | started_at (UTC) | domain | requested tier | served tier | outcome |
|---|---|---|---|---|---|---|
| `b691c375…` | `f5ed1c59…` | 2026-10-06 17:05:19 | Oklahoma! (Rodgers & Hammerstein Musical) | specialist | accessible | hit |

This is a genuine two-steps-away loosened pick (specialist requested,
accessible served — skipping the intermediate tier), exactly the mechanism
§2 describes, firing correctly on its first real occurrence. **Not
reading this as resolving anything** — one data point says the code path
works, nothing about whether the player experience is fine with it. §6's
exit criteria need ≥14 days of the loosening *actually firing*, and today
is day 1 of that clock, not day 1-of-14-already-elapsed.

**Miss-reason mix since deploy (`started_at > '2026-10-03 17:27:20Z'`),
re-run:** `fact_history` 17 (up from 9), `no_stock` 5 (up from 4),
`tier` **2 (up from 1)**, `filtered` 1 (unchanged). The new `tier` miss is
presumably a different attempt than the one that became the loosened hit
above (a miss record and a hit record are different rows) — not
cross-checked further since it doesn't change any exit-criteria math.

**Q1 (trailing 14 days), re-run:** 2026-09-23 through 2026-10-06. Blended
hit rate stays noisy day to day (31.4%–67.6%), including the fire day
itself (2026-10-06: 44.4%, 8 hits / 10 misses) — inside the existing noisy
range, not distinguishable from ordinary variance with n=1 loosened pick
in the denominator.

**Q2 (gen_calls_per_build), re-run:** 2.00–5.50 across the window,
including 4.50 on 2026-10-06 — inside the existing noisy range.

**Q3 — now has exactly one row to look at, not a real sample.** The
single loosened pick was answered... not checked against `MASTERY_EVENTS`
this session (one data point can't inform the "too easy" signal §6 asks
about, and running Q3's full join for n=1 isn't worth the query). Will
start being meaningful once a handful more loosened picks accumulate.

**Not resolving anything.** Status stays `active`. The ≥14-day clock for
§6 starts counting *fires*, not deploy-days — at 1 fire observed, it has
barely begun.

### Next steps (revised)
1. Watch for more `loosened: true` picks to accumulate — now 1 ever (fired
   2026-10-06), need materially more before Q3 or the §6 exit criteria mean
   anything.
2. Once a handful of loosened picks exist, run Q3 for real and start
   reading the ≥14-day clock from the first fire, not the deploy date.
3. Watch whether the `tier` miss-reason share (now 2 of 25 post-deploy
   misses) keeps growing now that the mechanism has proven it can fire.

### 2026-10-08 (diagnosis-review) — still only one loosened pick ever, two cron cycles after the first fire; nothing new to read

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**The loosening has fired exactly once, all time, still.**
`SELECT count(*) ... WHERE (a->>'loosened')::boolean = true` returns **1**
— the same single fire from 2026-10-06 (`b691c375…`) this doc's last entry
found; no second fire in the two cron cycles since (2026-10-07,
2026-10-08's cron hasn't run yet at review time).

**Q1 (trailing 14 days), re-run:** 2026-09-24 through 2026-10-07. Blended
hit rate stays noisy day to day (26.7%–66.7% depending on the day), with
2026-10-07 at 44.1% (15 hits / 19 misses) — inside the existing noisy
range, same read as every prior entry.

**Q2 (gen_calls_per_build), re-run:** 2.00–5.50 across the window,
including 4.67 on 2026-10-07 — inside the existing noisy range, no visible
shift.

**Q3 still has exactly one row to look at** — unchanged since the last
review, not worth running the full join again for n=1.

**No code change since the last review** to `generate-questions.ts` or
`build-context.ts` (the only new commit on `main`, `#1756`, touches
`queue-orchestrator.ts` and `daily.ts` for an unrelated Blue Moon
cross-day throttle on the authored/house pickers — confirmed by reading
its diff, no overlap with `bankLooseTiers` / `bankLooseTierMaxPerBuild` /
`pickBankPicksForDomains`).

**Not resolving anything.** Status stays `active`. The ≥14-day clock for
§6 still hasn't meaningfully started — one fire, two cron cycles ago, is
not "live."

### Next steps (unchanged)
1. Watch for a second `loosened: true` pick — still just 1 ever (fired
   2026-10-06), now two cron cycles with no second fire.
2. Once a handful of loosened picks exist, run Q3 for real and start
   reading the ≥14-day clock from the first fire, not the deploy date.
3. Watch whether the `tier` miss-reason share keeps growing now that the
   mechanism has proven it can fire.

### 2026-10-09 (diagnosis-review) — still only one loosened pick ever, three cron cycles after the first fire; `tier` misses growing but still a small minority

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.
Session time at review (06:22 UTC) is before today's ~17:05 UTC cron, so
today's build hasn't run yet — same pattern as every prior same-morning
review.

**The loosening has fired exactly once, all time, still.**
`SELECT count(*) ... WHERE (a->>'loosened')::boolean = true` returns **1**
— the same single fire from 2026-10-06 (`b691c375…`). No second fire in the
three cron cycles since (2026-10-07, 2026-10-08, 2026-10-09's cron hasn't
run yet).

**Q1 (trailing 14 days), re-run:** 2026-09-25 through 2026-10-08. Blended
hit rate stays noisy day to day (31.4%–66.7%), with 2026-10-08 at 41.7%
(10 hits / 14 misses) — inside the existing noisy range, same read as every
prior entry. `loosened`/`builds_loosened` are 0 on every day except
2026-10-06 (1/1), unchanged.

**Q2 (gen_calls_per_build), re-run:** 2.00–5.50 across the window, with
2026-10-08 at 5.50 — the highest single-day value seen yet, but still only
2 builds that day (small-sample noise, consistent with the doc's own §7
expectation, not a trend on its own).

**Q3 still has exactly one row to look at** — unchanged since the last
review, not worth running the full join again for n=1.

**Miss-reason mix since deploy (`started_at > '2026-10-03 17:27:20Z'`),
re-run:** `fact_history` 31 (up from 17), `filtered` 10 (up from 1),
`no_stock` 10 (up from 5), `tier` **7 (up from 2)**. All four categories
grew over the two cron cycles since the last review; `tier` is still the
smallest share (7 of 58 post-deploy misses, 12%) — growing, but not
dominant, and growing in step with every other miss reason rather than
disproportionately. **Not reading this as a signal either way**, same
caution as every prior entry: more `tier` misses don't by themselves mean
more loosening opportunities, since the mechanism also needs unused stock
two tiers away and an unspent per-build allowance.

**No code change since the last review** to `generate-questions.ts`,
`build-context.ts`, or `src/server/db/queries/daily.ts` — `git log` between
the last review's commit and `HEAD` returns nothing touching any of the
three.

**Not resolving anything.** Status stays `active`. The ≥14-day clock for
§6 still hasn't meaningfully started — one fire, three cron cycles ago, is
not "live."

### Next steps (unchanged)
1. Watch for a second `loosened: true` pick — still just 1 ever (fired
   2026-10-06), now three cron cycles with no second fire.
2. Once a handful of loosened picks exist, run Q3 for real and start
   reading the ≥14-day clock from the first fire, not the deploy date.
3. Watch whether the `tier` miss-reason share keeps growing relative to the
   other three reasons, or just tracks them proportionally as it has so far.
