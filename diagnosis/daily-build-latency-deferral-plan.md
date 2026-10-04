---
name: daily-build-latency-deferral-plan
status: active
opened: 2026-09-04
last-reviewed: 2026-10-04
owner: Josh
related-pr: "#1620, #1626"
---

> **2026-09-07: open question 5 is FIXED, MERGED, and deployed (#1620).** The
> deferred bonus append could silently destroy real core questions when two
> builds raced for the same user+date. `persistDailyQueue` now reports whether
> its own insert won that race; `queue-orchestrator.ts` checks it and bails
> before the deferred tail on a loss. Proven both ways against the real DB
> (`scripts/build-latency-anomaly.verify.ts`, two scenarios). No open decision
> remains on this item. `status` moved to `active`: Phase 3's latency numbers
> are still being measured (now n=3; the "stable residual" read at n=2 did
> NOT hold at n=3 — see the final Update), and question 4 (is the +2 bonus
> worth its own generation cost) is still open.

# Diagnosis: Daily Five build latency — the bonus deferral

_Started 2026-09-04 · Owner: Josh · Merged to `main` (PRs #1597, #1600, #1601)_

This is an **experiment in flight**, not a settled decision. The change has
shipped; what has not happened yet is the measurement that says whether it
worked and by how much. The "Recommendation" section below is a running
best-guess and should be read as provisional until Phase 3 completes.

**To take a reading: `npm run check:build-latency`.** Read-only, safe any time,
and it prints PASS/FAIL against the Phase 2 and Phase 3 criteria below. See
§6 for what it does and when to run it.

Everything above the Updates log is history. Correct it by appending a dated
entry, not by editing in place.

---

## 1. What triggered this

Players wait on a loading screen while their Daily Five is built. The question
was where the time actually goes.

The first attempts to answer it were wrong three separate ways, each invisible
from the output, because build spans were being reconstructed by clustering
`LlmUsageEvent` rows on timestamps:

1. a one-day batch sweep (4,697 `self-containment` calls on 2026-07-12) was
   read as daily-build traffic;
2. 600s lookback windows **overlapped** for the ~36% of queues the cron builds
   back-to-back, double-counting their calls;
3. "bank-only builds take 0.0s" was **circular** — a build with no LLM calls
   has no LLM events, so its reconstructed span is zero by construction.

Every open question traced back to a missing correlation primitive. So the
instrument was built first (`#1597`), and only then the change it measures.

The finding that motivated the change: **`generateBonusQuestionsForDomains`
runs before `persistDailyQueue`**. The queue is not readable until the two
*optional* "+2" bonus questions have been generated, one domain at a time. The
player waits on questions they did not ask for.

## 2. Open decisions

1. **Does the deferral reduce user-visible latency, and by how much?**
   Answerable as a number: median `span_ms - user_visible_ms` over post-deferral
   `outcome='built'` rows.
2. **Is the carried "~21s p50 / ~15s saving" figure still valid?** The one
   measured build was **45.9s** with a bonus cycle of **7.6s**. Either that
   build is atypical, or the p50 is stale. Answerable once a handful of rows
   exist.
3. **Should the initial core generation be phase-tagged?** One line. Only
   improves rows written *after* it deploys. (Time-boxed — see Updates.)
4. **Is the +2 bonus worth ~7.6s of generation at all?** Bonus is additive and
   optional by canon. Deferral moves the cost off the critical path; it does not
   remove it. Worth asking separately whether the feature earns its spend.
5. **[FIXED and MERGED, #1620] The deferred bonus append could silently
   destroy real core questions.** Root cause confirmed by direct reproduction
   (2026-09-06) and fixed (2026-09-07, see Updates) — a genuine, general
   concurrency bug, not a one-row artifact: `persistDailyQueue`'s insert is
   race-safe (`onConflictDoNothing`), but its return value — which says
   whether THIS build's insert won or lost — used to be discarded at the one
   call site in `queue-orchestrator.ts`. A build that lost the race had no way
   to know, and its deferred bonus tail appended using its own (losing,
   discarded) core count as the position, landing inside the WINNING build's
   real core range and overwriting whatever real question sat there.
   `persistDailyQueue` now returns `{ row, won }`; the orchestrator checks
   `won` and bails — `noteOutcome('lost_persist_race')`, no deferred tail, no
   append — before touching anything that assumes its own `slots` reflects
   what's persisted. Verified two ways: `persist-daily-queue-race.test.ts` /
   `queue-build-race.test.ts` (mocked, run every `vitest run`) and
   `scripts/build-latency-anomaly.verify.ts` (real DB, both the historical bug
   AND the fix reproduced in the same run). Remaining, smaller, genuinely open
   question — not a correctness question, a cost one: the LOSING build still
   burns a full core-generation cycle for nothing, and this fix doesn't reduce
   how often that race happens, only what damage it does when it does. Worth a
   follow-up only if the race turns out to be frequent enough to matter for
   spend — `outcome='lost_persist_race'` in `DailyBuildMetric` now makes that
   measurable, where before it wasn't visible at all.

## 3. What we know so far

### The instrument

`DailyBuildMetric`, one row per build, correlated by an AsyncLocalStorage
`build_id` threaded through the real call graph (`src/server/daily/build-context.ts`).

| column | meaning | migration |
|---|---|---|
| `span_ms` | total build wall clock, **including** deferred work | 0136 / nullable in 0139 |
| `user_visible_ms` | build start → queue persisted and readable | 0138 |
| `deferred` | did the bonus work run off the critical path? | 0140 |
| `borrowed_domain_count` | bonus domains borrowed back to fill a short core | 0140 |
| `deferred_domain_count` | domains handed to the continuation | 0140 |
| `target_size` | the **intended** core size, always `DAILY_QUEUE_SIZE` | 0136 / corrected 0137 |
| `outcome` | `built` / `carry_forward` / `existing_queue` / … | 0136 |

**Analysis must filter on `outcome='built'`.** Early returns record zero
generation calls and are otherwise indistinguishable from a genuine bank-only
build — the same contamination that produced the withdrawn "0.0s" figure.

The deferral's effect is measured as a **subtraction between two columns on one
row**, deliberately, rather than a before/after across a deploy. At ~1 genuine
build per day, a cross-deploy comparison would be hopelessly confounded by
model latency, bank hit rate and domain mix.

### The pre-deferral baseline — unrepeatable

The only observation of `span_ms ≈ user_visible_ms` that will ever exist. After
the deferral shipped, the two diverge by design.

```
build_id         35fae452-ef06-49d1-9eb2-83bb8a19270e
started_at       2026-09-05T17:05:16.431Z
span_ms          45909
user_visible_ms  45908          <- 1 ms apart
rounds           [{"phase":"bonus","round":0,"chunks":2,"gateMs":0,"generationMs":7646}]
round_count 1 · generate_call_count 3 · bank 6/12 · final_size 7
deferred / borrowed_domain_count / deferred_domain_count : ALL NULL (predate 0139/0140)
```

**1 ms apart, against a tolerance of a few hundred.** That is as good a
validation of the instrument as a single row can give.

### The prize is ~7.6s, not ~15s

On that build, bonus generation was **7,646 ms of 45,909 — about 17%**. The
deferral moves bonus generation only, so that is the removable portion.

**Pre-registered:** the first post-deferral divergence should land near ~7.6s
(plausibly 5–10s with variance). That is success. A figure near ~15s would be
*inconsistent* with this baseline and needs explaining before it is celebrated.

### Load-bearing assumptions, flagged

- **`after()` has never executed anywhere.** Tests exercise the *inline*
  fallback (vitest has no request scope), which produces an identical end state.
  The deferred path's first real execution will be in production. Mitigated:
  a silent `after()` failure shows as `deferred: true, span_ms: null` — visible,
  not absent.
- **Whether AsyncLocalStorage crosses the `after()` boundary is unknown.** If it
  does not, bonus-phase `LlmUsageEvent` rows stamp `build_id: null` and drop out
  of build statistics — the deferral still works, the LLM accounting quietly
  does not.
- **The "~21s p50" is carried and unverified**, and now sits against a single
  observed 45.9s build. If the honest answer turns out to be "a 7-second
  improvement on a 45-second build", that is still real and should be described
  that way rather than reaching for the larger number.
- **`n = 1`.** Good instrument validation, poor population estimate.

### Known gap

Initial core generation is **not** phase-tagged: `noteRound({ phase: 'core' })`
sits inside the *top-up* loop only. So `rounds` decomposes top-up rounds,
borrow-back and the bonus cycle — but not baseline core generation.

This does **not** affect the deferral measurement: `span_ms - user_visible_ms`
is structurally the work moved after persist, independent of round tagging.
What it costs is decomposing the remaining ~38s.

## 4. Plan

### Phase 0 — build the instrument · **DONE** (#1597)

AsyncLocalStorage correlation, `DailyBuildMetric`, `user_visible_ms`,
phase-tagged rounds.
**Exit criterion:** a row where `span_ms ≈ user_visible_ms`, proving the two
fields measure what they claim while the answer is already known. **MET** —
1 ms, 2026-09-05.

### Phase 1 — ship the deferral · **DONE** (#1601)

Bonus generation moved after `persistDailyQueue`; core-fill and promotion stay
synchronous; borrow-back protects the five when the core slice under-delivers.
**Exit criterion:** 0139/0140 applied in production and the three new columns
present. **MET** — 2026-09-05, ledger head `1788400823476`.

### Phase 2 — first post-deferral row · **MET, WITH A CAVEAT**

**Exit criterion**, all on one row:
- `deferred: true` — `after()` actually ran
- `span_ms` populated — the continuation completed
- `target_size = 5` — write-at-persist works
- `borrowed_domain_count` / `deferred_domain_count` sane
- bonus-phase `LlmUsageEvent` rows carry a **non-null `build_id`** — ALS crossed
  the boundary

Four unknowns, one read. **All four passed** on the first row (see the
2026-09-06 Update) — but a data-integrity anomaly was found on that same row
while checking a fifth thing the exit criteria didn't ask for (whether the
persisted queue's core count matches what the build recorded). See open
question 5.

### Phase 3 — the subtraction · **IN PROGRESS, NOT YET TRUSTED**

**Exit criterion — split in two, because the original conflated a mechanism
question with a population one:**

- **3a · Mechanism (works at n=1).** On each row, is `span_ms - user_visible_ms`
  at least that row's OWN bonus cost, summed from its `rounds` telemetry? You
  cannot move work off the critical path and save less than the work was worth,
  so this is a real check on a single row. The residual above the bonus cost is
  reported, not judged — a residual that stays put across rows is fixed
  non-generation overhead the deferral also removes, and is a finding.
- **3b · Population (needs several rows).** Median `span_ms - user_visible_ms`.
  This is the "what does it save a typical player" number, and it is the only
  one that needs volume.

**Judge 3b against nothing fixed.** The ~7.6s pre-registration is ONE SAMPLE of
a quantity that varies by more than 10x — 7,646ms of bonus generation on the
baseline build, 501ms and 437ms on the two surviving post-deferral rows. The
deferral saves whatever the bonus costs that day. Holding every future row to a
fixed ~7.6s reads ordinary variance as underperformance; that framing has
already produced one misleading "far below prediction" reading (below).

**First reading (2026-09-06, n=3): median 1,362ms.** Far below the ~7.6s
prediction, and see the Update for why that may say more about the baseline
than about the deferral. Not treated as final: one of the three rows carries
the unresolved anomaly from open question 5, so this median is provisional
until that is understood. **That row has since been deleted** — see the
2026-09-06 (later still) Update; n is now 2.

Volume note: ~1 genuine build/day, so this accumulates slowly. Three or four
rows is a usable read; one is not.

### Phase 4 — decide whether more is warranted

**Exit criterion:** with the deferral's real saving known, decide open question
4 — whether the +2 bonus earns its generation spend at all — and whether any
further latency work is justified against the remaining core time.

## 5. Recommendation (as of 2026-09-07, fixed)

**Merge the fix. It closes a confirmed, general mechanism for silently
destroying real core questions, and both the bug and the fix are proven
against the real database, not just reasoned about.**

The mechanism (reproduced 2026-09-06, fixed 2026-09-07):

1. Two builds race to persist a queue for the same user+date. `persistDailyQueue`'s
   insert is race-safe (`onConflictDoNothing` on `(user_id, queue_date)`) — the
   loser's insert correctly no-ops, and the function correctly hands back the
   WINNING row. **The bug was that its one caller, in `queue-orchestrator.ts`,
   discarded that return value** — so the losing build never learned it lost.
2. The losing build's deferred bonus tail ran anyway, using its OWN (losing)
   core-slot count as the append position.
3. `createDailyQueueItemFromPresence`'s `filter(slot_index !== position) +
   append` against whatever is CURRENTLY persisted — the winner's real queue —
   then silently deleted a real core question and replaced it with a bonus one
   whenever the loser's position fell inside the winner's real core range.

**The fix** (`src/server/db/queries/daily.ts`, `src/server/daily/queue-orchestrator.ts`,
`src/server/daily/build-context.ts`): `persistDailyQueue` now returns
`{ row, won } | null` instead of a bare row — `won` is exactly the signal the
function already computed internally (`if (row) ... else` the conflict
fallback) and simply never surfaced. The orchestrator checks it right after
persisting: on a loss, it records `outcome: 'lost_persist_race'` (a new,
distinct `BuildOutcome`, so this is countable separately from `existing_queue`
going forward — genuinely different costs, since a loser burned a full
generation cycle first) and returns before scheduling the deferred tail. No
append, no chance to touch a queue this build doesn't own.

No lock was added, deliberately — an advisory lock across the whole build was
already considered and rejected once for this exact race, for a documented
reason that still holds: `git log 4ca75ff5` ("stop a concurrent build from
swapping the served Daily Five"), which fixed the ORIGINAL version of this same
race before the bonus deferral existed: *"We deliberately do NOT use a DB
advisory lock held across generation: the daily cron runs USER_CONCURRENCY=4
builds against the max:5 pool, and pinning a connection per build for its
whole duration would starve that pool."* That reasoning is unchanged. The fix
here follows the SAME first-writer-wins design that commit already
established — it just closes the one path (added later, by #1601's bonus
deferral) that stopped honoring it.

Verified two ways:

- **Mocked, fast, runs in every `vitest run`:** `persist-daily-queue-race.test.ts`
  pins the `{ row, won }` contract directly. `queue-floor.test.ts` adds three
  dedicated tests driving `fillDailyQueueForUser` itself through the real code
  path — `won: false` calls `createDailyQueueItemFromPresence` zero times
  (the actual regression, proven the same way the real bug did the damage:
  by watching whether the append fires, not by inspecting internal state);
  `won: true` calls it once, unchanged from today; `null` also skips it
  without throwing. Four other orchestrator suites (`queue-build-race`,
  `diversity-cap`, `queue-floor`'s own earlier tests, `resting-domains`)
  updated their `persistDailyQueue` mocks to the new shape — they previously
  mocked `undefined`, which the new `if (!persistResult)` check would have
  misread as the pathological no-row-at-all case and silently changed their
  meaning without a shape update.
- **Real DB, self-cleaning, run on demand:** `scripts/build-latency-anomaly.verify.ts`
  now runs two scenarios back to back — Scenario A deliberately ignores `won`
  and reproduces the exact historical damage (5 slots, bonus at index 3 and 4,
  2 of 5 real questions destroyed); Scenario B checks `won` and asserts the
  winner's queue is completely untouched, 0 bonus slots appended. Both pass.

**What this does NOT fix, and I'm not proposing to:** the losing build still
burns a full core-generation cycle for nothing — this fix stops the DAMAGE, not
the WASTE. `outcome: 'lost_persist_race'` makes that waste measurable for the
first time (`build-latency-check.mjs`'s existing outcome-totals line will show
it automatically, no script change needed); whether it happens often enough to
justify more work is a real follow-up question, but not one to guess at before
there's a single row of `lost_persist_race` data to look at.

Superseded, kept for the record — my prior (pre-fix) recommendation:

**Do not treat the deferral as validated yet. Trace the slot-collision anomaly
before relying on any Phase 3 number.** (2026-09-06, earlier) Phase 2's four
criteria all passed on the first real row, but checking a fifth thing — do the
numbers match the actual persisted queue? — found a queue with only 3 real
core slots dressed as a "Daily Five," with the mechanism not yet identified.

Superseded, kept for the record — my prior recommendation:

**Wait for Phase 2. Change nothing.**

The instrument is validated, the change is deployed, and the only thing missing
is data that arrives on its own at the 17:05 UTC cron. Anything built now would
be built against `n = 1`.

Two things I would *not* do:

- **Do not re-quote ~15s.** The single measured build says ~7.6s. Until Phase 3
  produces a median, the honest statement is "expected around 7–8 seconds,
  measured on one build."
- **Do not treat a small divergence as failure.** If `span_ms - user_visible_ms`
  comes back at ~7s, that is the deferral working exactly as designed.

Time-boxed option, low value: phase-tagging the initial core generation (open
question 3) only helps rows written after it deploys. If it does not land before
today's cron, it simply rides the general instrumentation cleanup later.

What would change this recommendation: `deferred: false` on a cron-built row
(meaning `after()` is unavailable on that path and the deferral is inert in the
one place it matters), or `build_id: null` on bonus-phase LLM events.

---

## 6. How to take a reading

```bash
npm run check:build-latency
```

Read-only: no writes, no LLM calls, safe to run repeatedly. It needs
`DATABASE_URL` in `.env`, which points at production.

**When.** The cron builds at **17:05 UTC**. Give it ten minutes and run the
script. If it says "no post-deferral build yet", that is not a failure — a row
appears only when someone actually needs a queue built, and at current volume
that is roughly one genuine build a day.

**What it prints, in order:**

| section | what it answers |
|---|---|
| totals by `outcome` | how many rows exist, and how many are early returns |
| pre-deferral baseline | the unrepeatable `span ≈ user_visible` row, re-shown for reference |
| **Phase 2** | `deferred`, `span_ms`, `target_size`, the two counts — four unknowns |
| LLM attribution | whether `build_id` survives the `after()` boundary |
| **Phase 3** | the subtraction, per row and as a median, against the ~7.6s prediction |

**The filter is baked in.** Analysis uses `outcome='built'` only. Forgetting
that mixes in `carry_forward` / `existing_queue` early returns, which record
zero generation calls and read as implausibly fast builds — the same
contamination that produced the withdrawn "bank builds take 0.0s" figure. The
script applies the filter so nobody has to remember it.

**Two failure signatures it calls out explicitly**, because neither is obvious
from the raw numbers:

- `deferred: true` with `span_ms: null` → the continuation was **dropped**.
  `after()` ran and never finished. This is precisely what the two-phase write
  exists to make visible rather than absent.
- `deferred: false` on a **cron** build → `after()` was unavailable and the tail
  ran inline. Correct, but not faster — and it means the deferral is inert on
  the one path that matters.

---

## 7. Regression test: the persist-race fix (open question 5)

```bash
npm run verify:build-latency-anomaly
```

`scripts/build-latency-anomaly.verify.ts`. **Not read-only** — unlike §6's
reading, this one WRITES: it seeds a disposable user, generated questions, and
a `DailyQueue` row, exercises the real `persistDailyQueue` /
`createDailyQueueItemFromPresence` functions against them, then deletes
everything it created in a `finally` block regardless of outcome (same pattern
as `scripts/account-deletion-territory.verify.ts`). Safe to run against
production — it needs `DATABASE_URL` in `.env` for the same reason §6 does —
but it is not read-only the way §6 is, so don't reach for it as a casual
status check.

**What it proves, in two scenarios run back to back:**

- **Scenario A (the historical bug, kept on purpose):** deliberately ignores
  `persistDailyQueue`'s `won` field, the way every call site used to. Must
  still reproduce the exact damage — 5 total slots, bonus at index 3 and 4, 2
  of the winning build's 5 real questions destroyed. If this scenario ever
  stops reproducing the damage, something changed the underlying mechanism (not
  necessarily for the better) and needs explaining before trusting Scenario B.
- **Scenario B (the fix):** checks `won` and skips the deferred append on a
  loss, exactly as `queue-orchestrator.ts` now does. Must leave the winning
  build's queue at exactly 5 slots, 0 destroyed, 0 spurious appends.

**PASS** means both scenarios matched their expected shape — the mechanism
still exists (A) and the fix still closes it (B). **FAIL on Scenario A**
would mean the reproduction itself is stale (unlikely to matter — the mocked
unit tests below are the ones that would actually catch a regression in CI).
**FAIL on Scenario B** is the one that matters: it means a future change to
`persistDailyQueue`, `queue-orchestrator.ts`, or `createDailyQueueItemFromPresence`
reopened the ability for a losing build to corrupt the winner's queue.

**When to run it:** before merging any further change that touches
`persistDailyQueue`'s return contract or the deferred-bonus append path.

**The faster, CI-covered version of the same fix** lives in
`src/server/daily/__tests__/queue-floor.test.ts` (describe block "a lost
persistDailyQueue race must not touch the deferred bonus tail") and
`src/server/db/queries/__tests__/persist-daily-queue-race.test.ts` — both run
on every `vitest run`, mocked, no DB required. This script is the slower,
real-DB confirmation for when mocked coverage alone doesn't feel like enough
before touching this path again.

---

## Updates

### 2026-09-04 — instrument built, and it caught a defect in itself

`#1597` landed the correlation primitive. Two review findings worth recording:

- **`span_ms` alone would have hidden the entire result.** The deferral moves
  bonus work off the critical path rather than removing it, so a span measured
  to bonus-completion would have kept reading the same number and reported that
  deferring bought exactly zero. `user_visible_ms` (0138) exists because of
  that. It was found *before* any row was written, and only because the two
  fields had been separated one turn earlier — with a single span field the
  right and wrong designs are indistinguishable.
- **Migration 0136 wrote a wrong `target_size` to 148 live rows**, backfilled
  from *all* slots so the modal 5-core+2-bonus queue recorded 7. `0137` set
  every row to NULL rather than a corrected number: backfilling from the
  *achieved* core count makes `answered >= target_size` trivially true, so a
  3-slot build would read complete — the exact defect the column exists to
  prevent. Related: `_docs/INCIDENT-2026-09-03-boot-migrate.md`.

### 2026-09-05 — a live stranding bug found on the way, then the deferral shipped

- **`isRoundComplete` counted every slot**, so a player who answered all five
  core questions and ignored the two optional bonus ones was marked incomplete
  **permanently**. Five production queues were in exactly that state. Not
  cosmetic: completion gates the demand-pull bank replenish, so those rounds
  never restocked — the stranding bug was feeding the latency problem. Fixed in
  `#1600`, and it is a **precondition** of the deferral: under deferral, bonus
  slots are appended after the player may already have finished, which would
  have flipped a completed round back to incomplete.
- **Baseline row read at 17:05 UTC** (see §3). Gate criteria: equality passed
  decisively (1 ms); bonus-cycle span populated; the third criterion — `rounds`
  carrying **both** phase values — was **not met**, only `bonus` was present.
  Merged anyway. Recorded rather than left unstated: a gate partially waived
  without comment is how gates stop being gates.
- **`#1601` merged and deployed.** 0139/0140 applied — but only after a manual
  `GET /login`, because **a deploy does not apply migrations, a request does**.
  Vercel does not boot a function until traffic arrives; the deployment sat
  READY with `register()` never having run. Never read READY as evidence that a
  migration applied.

### 2026-09-06 — checked, no new data; one time-boxed option open

`DailyBuildMetric` totals: `carry_forward=22`, `existing_queue=3`, `built=1`.
**Still no post-deferral built row** — the 17:05 UTC cron has not fired yet
today (checked 12:31 UTC). Phase 2's exit criterion is unmet purely because the
data does not exist yet, not because anything failed.

Resolved since the last entry: the third gate criterion's ambiguity. Initial
core generation **ran and is not phase-tagged** (`generate_call_count: 3`,
`round_count: 1`; bonus used ~2 calls, so ~1 core call recorded no span). It is
the gap reading, not the "core did not run" reading — see §3 *Known gap*. The
deferral attribution is unaffected.

**Open for Josh, expires at today's 17:05 UTC cron:** phase-tag the initial core
generation (open question 3)? One line, low value, and only improves rows
written after it deploys. Default if unanswered: skip it, and let it ride the
general instrumentation cleanup.

### 2026-09-06 (later) — Phase 2 passed; Phase 3's first reading; a real anomaly found checking a fifth thing

Ran `npm run check:build-latency` at 17:09 UTC. `DailyBuildMetric` now holds
**4 `outcome='built'` rows** (1 pre-deferral, 3 post): totals
`carry_forward=43, existing_queue=4, built=4, partial_carry_forward=1`.

**Phase 2 — all four exit criteria passed**, on build
`123cd09b-b28b-4760-809b-537d45b9884d` (started 2026-09-06T15:41:04.395Z):

- `deferred: true` — `after()` ran.
- `span_ms: 22282`, `user_visible_ms: 21022` — both populated, the continuation
  completed.
- `target_size = 5` on all 3 queues built since — the write-at-persist fix
  works.
- 4 `generate-questions` LLM events since that build, all 4 carrying a
  non-null `build_id` — **AsyncLocalStorage crosses the `after()` boundary.**
  This was the largest unverified assumption in the whole plan and it holds.

**Phase 3 — first reading, n=3: median saving 1,362ms** (individual rows:
1260ms, 1529ms, 1362ms). Far below the ~7.6s pre-registered prediction. Two
things narrow down why, one benign and one not.

**Benign: the bonus generation itself now runs much faster than the baseline
suggested.** All three post-deferral bonus rounds took 437–544ms for
`chunks: 2` — the pre-deferral baseline's *same-shaped* bonus round
(`chunks: 2`) took **7,646ms**, a ~15x difference. The three post-deferral
rows agree tightly with each other and disagree sharply with the single
baseline; the baseline's build was also the slowest ever observed overall
(45.9s, more than double the ~21s figure quoted earlier). Most likely reading:
**the baseline was an atypically slow build, not a typical one**, and the true
"cost of bonus" the deferral is removing was probably always closer to
~500ms–1.5s than to ~7.6s. If that holds up over more rows, the honest
description of this effort becomes "the deferral removes roughly a second and
a half of wait," not "~7.6s" and certainly not the original "~15s." Still real,
still worth having, just smaller than hoped.

**Not benign: one of the three rows shows a data-integrity anomaly I could not
resolve.** Build `123cd09b` recorded `final_size: 5` (5 core slots persisted)
and `deferred_domain_count: 2`. Its persisted queue
(`f3d9dc54-3a45-4b1f-852a-8b881503a0f6`) has exactly **5 total slots**, and two
of them — `slot_index` **3 and 4** — carry `presence_source_id` (bonus
markers). That leaves only **3 real core slots**, not 5, even though
`target_size` correctly says 5 (the target-size fix is doing its job: this
queue is now *visibly* short rather than silently certified as complete).

What makes this hard to explain: `slots` in the orchestrator is declared
`const` and only ever grows via `.push()` (confirmed by reading the full
function — no reassignment anywhere). `noteFinalSize(slots.length)` recorded
5 moments before `appendDeferredBonusSlots(userId, plan.candidates,
slots.length)` reads the same array's `.length` again — those two reads
cannot legitimately differ. Yet the appended slots landed at index 3 and 4,
which is where `slots.length` would have been if the core count were 3, not
5. I traced this as far as DB evidence allows (the full `LlmUsageEvent` history
for this build_id, every `GeneratedQuestion` row in the window, confirming
there is only one `DailyQueue` row for this user+date) and could not identify
the mechanism with confidence — the two live hypotheses (a second, unrecorded
concurrent build for the same user+date; or some path that mutates `slots`
that I have not found by reading) are both incomplete explanations of the
exact indices observed.

**Not asserting a root cause I have not confirmed.** Logged as open question 5
above, `needs-decision`. The other two post-deferral rows (`final_size` 6 and
6, persisted queues with 8 total slots, 2 bonus each — fully consistent) show
no such anomaly, so this is not universal, but it happened on 1 of 3 observed
builds, which is not rare enough to dismiss.

**Recommendation updated accordingly — see §5.** The instrument's own
validation (Phase 2) succeeded in full. What's now blocking confidence in the
result (Phase 3) is a correctness question the instrument was never built to
catch, found only because a fifth check was run that the exit criteria didn't
require.

### 2026-09-06 (later still) — the anomaly row was deleted; Phase 3 split in two

Two things happened to this doc's evidence base, one unhelpful and one useful.

**The anomalous row is gone from the database.** Open question 5's row —
`build_id 123cd09b-b28b-4760-809b-537d45b9884d`, `final_size 5`, the queue with
3 real core slots and bonus slots appended at indices 3 and 4 — belonged to
**Rue Prova**, the disposable production fixture created for that day's
reminder-ask verification walkthrough. Deleting the fixture cascaded it away:
`DailyBuildMetric.user_id` is `references(users.id, { onDelete: 'cascade' })`,
so the metric row and its `DailyQueue` went with the account. Phase 3's n drops
from 3 to 2, and the two survivors are the clean `final_size 6` ones.

What survives, and is enough to keep the trace alive:

- **15 `LlmUsageEvent` rows for that `build_id`** — no user FK, so untouched.
  This is the call-level history the previous Update reasoned from.
- **The row's own contents**, quoted verbatim in that Update.

What is lost is the persisted queue itself — the ability to re-inspect the slot
array that made the anomaly visible. **The reproduction step in §5 is now the
only route to it**, which raises that recommendation's priority rather than
lowering it.

*Process note worth keeping:* diagnosis evidence generated by a disposable test
fixture inherits the fixture's lifetime. If a walkthrough produces a row this
doc depends on, either copy the row into the doc immediately (as was done here,
luckily) or leave the account alive until the question closes.

**Phase 3's exit criterion is now split** into 3a (mechanism, valid at n=1) and
3b (population, needs volume) — see Phase 3 above for why the single-number
version was misleading. `npm run check:build-latency` implements both.

The 3a reading on the two surviving rows:

```
2026-09-06T17:03:54Z  saved 1529ms  bonus 501ms  residual 1028ms  [PASS]
2026-09-06T17:05:14Z  saved 1362ms  bonus 437ms  residual  925ms  [PASS]
residual spread: 925..1028ms over 2 rows — stable
```

**The saving is consistently ~1s larger than the bonus generation it removes.**
On both rows the deferral is worth about three times the bonus `generationMs`,
and the residual barely moves between them. That reads as fixed non-generation
overhead — chunk orchestration, the queue write, the `after()` boundary itself —
that the per-round `generationMs` never counted and the deferral removes along
with the generation. If it holds at n=4, the honest headline for this work is
not "saves the bonus generation time" but "saves the bonus generation time plus
about a second of fixed overhead," which is a materially better result than the
median alone suggests.

Two rows is not enough to bank that. It does not change §5: the slot-collision
anomaly still gates trusting any of these numbers.

### 2026-09-06 (later still still) — open question 5 reproduced and confirmed

Did what §5 said was next: reproduced locally rather than continuing to infer
from timestamps. Since the production evidence row was gone (deleted along
with the walkthrough fixture that owned it — see the entry above), the only
route left was rebuilding the race from the real functions.

`scripts/build-latency-anomaly.verify.ts` (self-cleaning, safe to re-run)
calls `persistDailyQueue` and `createDailyQueueItemFromPresence` directly —
the same functions `queue-orchestrator.ts` calls — no mocks:

1. "Build WIN": persists 5 real core questions. Succeeds (nothing else exists
   for that user+date yet).
2. "Build LOSE": persists 3 different real core questions for the SAME
   user+date. `persistDailyQueue`'s `onConflictDoNothing` correctly no-ops the
   insert and correctly returns WIN's 5-slot row — proving that half of the
   system is NOT the bug.
3. Build LOSE's deferred bonus tail runs anyway (nothing tells it it lost),
   appending 2 bonus questions via `createDailyQueueItemFromPresence` at
   positions 3 and 4 — Build LOSE's OWN core count, oblivious to the loss.

Result, first run, no tuning:

```
Total slots: 5                    (doc: 5)
Bonus slot indices: [3, 4]        (doc: [3, 4])
WIN's core questions destroyed: 2 of 5   (doc: 2, since only 3 of 5 survived)

REPRODUCED
```

Exact match. **Root cause confirmed**: `persistDailyQueue`'s return value —
which tells a caller whether ITS insert won or lost the race — is discarded at
every call site in `queue-orchestrator.ts`. A losing build has no way to know
it lost, and its deferred bonus append proceeds using its own (losing,
discarded) core count as the position, landing inside whichever build actually
won and silently overwriting real questions there.

This is NOT a one-row artifact. It is what this code reliably does any time
two builds race to persist the same user+date — which requires `inFlightFills`
(an in-memory `Map`, scoped to a single server instance) to fail to prevent the
race, most plausibly because the two builds run on two different serverless
instances that don't share that Map. Confirming THAT half — why two builds
raced for the same user in production, specifically — was not attempted here;
the reproduction above proves the DAMAGE MECHANISM deterministically by
construction (no race condition needed to demonstrate it), which was the
actual open question. Root-causing why the race happens at all in production
is a smaller, separate question and matters less now that the damage mechanism
is confirmed and fixable regardless of the trigger.

**Status change: open question 5 moves from "root cause not confirmed" to
"root cause confirmed, fix not yet designed."** Updated §2 item 5 and §5
accordingly. Recommendation is now to fix this before trusting Phase 3
further — not because Phase 3's numbers are necessarily wrong, but because
every build with this shape is now a KNOWN, not suspected, way to lose a real
question, and letting the cron keep running against it isn't neutral.

Did not implement a fix. The design choice (check-and-skip vs.
recompute-against-winner vs. an upstream lock) belongs to whoever picks this up
next, not to this diagnosis pass.

### 2026-09-07 (diagnosis-review) — a fourth built row, n=3; the concurrency fix still isn't built

**NEEDS DECISION (unchanged):** the fix for open question 5 — check-and-skip,
recompute-against-winner, or an upstream lock — still hasn't been designed or
built. Nothing below changes that; it's still the gate on trusting Phase 3.

Ran `npm run check:build-latency` (read-only, safe, as documented in §6):

```
DailyBuildMetric totals: carry_forward=65  existing_queue=6  built=4
Phase 2: unchanged, still passes on the original row.
Phase 3 (3 usable rows, up from 2):
  2026-09-06T17:03:54  saved 1529ms  bonus  501ms  residual 1028ms  [PASS]
  2026-09-06T17:05:14  saved 1362ms  bonus  437ms  residual  925ms  [PASS]
  2026-09-07T17:05:14  saved 2154ms  bonus  527ms  residual 1627ms  [PASS]  <- new
  residual spread: 925..1627ms over 3 rows -- wide; explain before relying on it.
  3b median saving: 1529ms (was 1362ms at n=2)
```

A genuine new row landed at today's 17:05 UTC cron. `target_size` matched on
all 3 built-since rows (3/3/0 mismatches) — **no repeat of the slot-collision
anomaly** on this reading. That is reassuring about frequency, not about the
mechanism: it does not mean the race was fixed, only that it didn't fire
today. Confirmed by reading the code, not inferring from the absence of
symptoms: `git log --oneline -- src/server/daily/queue-orchestrator.ts` still
stops at `#1601` (the deferral itself), and the current uncommitted working
tree (branch `claude/domain-drift-safety-net`) touches unrelated files only —
`persistDailyQueue`'s return value is still discarded at line 1467, and
`appendDeferredBonusSlots` still receives local `slots.length` at line 1485,
exactly as reproduced in the 2026-09-06 entry above. §5's recommendation
stands unaddressed.

The residual (the ~1s of saving beyond the bonus generation itself) widened
from a tight 925–1028ms band to 925–1627ms with this third row — the script's
own output already flags this as "wide; explain before relying on it." Not
investigated further this pass; worth watching whether it stabilizes or keeps
spreading as more rows accumulate.

**PR `#1601` reconfirmed `MERGED` to `main`** via `gh pr view` — no other PR
is referenced by this doc.

Still open: what the concurrency fix should be (not designed, not built);
whether the ~1.5s median (n=3) holds up with more volume; open questions 3
and 4 (phase-tagging core generation, whether the +2 bonus earns its spend)
untouched since they were last deferred.

### 2026-09-07 — the fix landed: check-and-skip

Implemented the "check-and-skip" option named above as the one to design.
Chose it over the alternatives for a specific reason: recompute-against-winner
would mean the loser's bonus questions get appended to a queue it doesn't own,
using a *different* build's friend-presence context — plausible-looking but
never actually decided by anything that build's own logic reasoned about. An
upstream lock is the strictly correct fix for the underlying race (two builds
should never both reach persist for one user+date) but is a bigger, riskier
change than the immediate need, which is to stop the DAMAGE, not necessarily
the race itself. Check-and-skip fixes the damage unconditionally, regardless of
why the race happens.

**What changed:**

- `persistDailyQueue` (`src/server/db/queries/daily.ts`) now returns
  `{ row, won: boolean } | null` instead of `DailyQueueRow | null`. `won` says
  whether THIS call's insert is the one that landed. The type's own doc comment
  states the invariant it exists to enforce: every caller must check `won`
  before doing anything further with its own `slots` or a position derived
  from them.
- `queue-orchestrator.ts`'s one call site now checks it. On `won: false`, the
  build stops **before** the deferred bonus tail — no `appendDeferredBonusSlots`
  call, no borrow-back-adjacent logic, nothing that assumes `slots` reflects
  what's actually persisted. A new `BuildOutcome` value,
  `'lost_persist_race'`, records this distinctly from `'built'` so Phase 3
  analysis (which already filters on `outcome='built'`) is unaffected. On a
  `null` result (no row at all — a pathological case, e.g. a concurrent
  delete), the build also stops, logging an error rather than proceeding
  against nothing.
- The generated questions a losing build made are not wasted: as already
  established for dropped overflow questions, `generateDailyQuestions` persists
  them with `usedInQueue: false`, and `pickBankSource` draws the viewer's own
  never-served rows — they bank for next time.

**Verified two ways.** `scripts/build-latency-anomaly.verify.ts` now runs two
scenarios against the real database, both passing: Scenario A still
reproduces the historical damage when a caller deliberately ignores `won`
(proving the mechanism is real and the type change didn't accidentally paper
over it); Scenario B proves the fix — a losing build that checks `won` and
skips the tail leaves the winner's queue at exactly 5 slots, 0 destroyed, 0
spurious appends. Three new unit tests in `queue-floor.test.ts` cover the same
three cases (`won: false` skips, `won: true` proceeds, `null` stops without
crashing) through `fillDailyQueueForUser` itself, not just the isolated
primitives. All existing tests updated for the new return shape and still
pass — 555 pass, 1 unrelated pre-existing flake in
`budgeted-concurrency.test.ts` (0 references to `persistDailyQueue`,
confirmed to pass on its own).

**Not done, and deliberately out of scope for this pass:** the upstream
question of *why* two builds raced for the same user+date in production in the
first place. `inFlightFills` (the in-memory single-flight map) only coalesces
concurrent builds within one server instance; if the two builds that produced
the original anomaly ran on two different serverless instances, that map
would never have seen the second one. Confirming that mechanism specifically
would need production concurrency evidence this diagnosis doesn't have.
Fixing the damage doesn't require it: check-and-skip is correct regardless of
why a second build exists.

**Status change: open question 5 moves from "root cause confirmed, fix not
designed" to "fixed and verified."** §2 item 5 and §5 updated. Phase 3 numbers
are no longer gated by this — the mechanism that could silently corrupt a
winner's queue is closed, independent of how often the underlying race
actually occurs in production.

### 2026-09-07 (later) — #1620 merged; n=3, and the "stable residual" claim from n=2 does not hold

`#1620` (the persist-race fix) merged and deployed. `npm run check:build-latency`
re-run for a fresh reading — a third genuine post-deferral build landed
(2026-09-07T17:05:14.513Z), taking Phase 3 to n=3.

```
saved 1529ms  bonus  501ms  residual 1028ms
saved 1362ms  bonus  437ms  residual  925ms
saved 2154ms  bonus  527ms  residual 1627ms   <- new row
```

**Retracting the "stable" claim from the n=2 entry above.** At n=2 the residual
sat in a 103ms band (925–1028ms) and read as fixed, non-generation overhead.
The third row's residual is 1627ms — 60% above the previous high end, not a
tight cluster. Two rows agreeing was not yet evidence of stability; it was
just two rows. The honest statement now is: the deferral saves the bonus
generation time **plus some overhead that itself varies**, not "plus a fixed
~1s." Whether that overhead correlates with anything (bonus domain count,
total build size, time of day) is unanswered and would need more rows to say.

**3b population, updated: median saving 1529ms** (n=3, was 1362ms at n=2).
Still far below the ~7.6s pre-registered prediction, for the reason already
recorded above (the baseline build was atypically slow). This number will keep
moving at this volume (~1 genuine build/day) — treat every reading here as
provisional until the doc says otherwise.

**Not re-litigated:** the fix itself (§ above) is unaffected by any of this —
it stops data corruption regardless of what the latency numbers turn out to
say.

### 2026-09-08 — a concrete hypothesis for why two builds race (still unconfirmed by production data)

The 2026-09-07 entry above left "why does the race happen at all" explicitly
out of scope. Picked it back up by reading the actual call graph — not
guessing — to name the trigger surface precisely.

**Five independent call sites can each try to build the same user's queue for
the same day**, all converging on `fillDailyQueueForUser(userId)`:

| Trigger | File | Fires when |
|---|---|---|
| Login pre-warm | `src/server/daily/prewarm.ts` via `src/app/api/auth/verify-otp/route.ts:235` | Every returning-user login, via `after()` — background, non-blocking |
| Onboarding pre-warm | same `prewarmDailyQueue`, `trigger: 'onboarding'` | Onboarding completion |
| Home-page prefetch | `src/components/TodaysFiveCard.tsx:237` | **Every mount** of the home-page card, if today's queue doesn't exist yet |
| `/daily` page POST | `src/app/api/daily/queue/route.ts:153` | Whenever the player actually opens `/daily` |
| Cron | `src/app/api/cron/daily-assignments/route.ts` | Three idempotent passes daily, 17:05 / 17:30 / 18:00 UTC |

**Why `inFlightFills` doesn't catch it:** it's a plain in-memory `Map`
(`queue-orchestrator.ts:218`), and `vercel.json` has `"fluid": true` —
confirmed, not assumed. Fluid Compute reuses instances under steady load but
scales out under concurrent requests, with no guarantee two near-simultaneous
requests for the same user land on the same instance. The in-process map
was always documented as a cost optimization, not the correctness boundary
(see its own comment) — this just confirms the boundary it doesn't cover is
real and reachable.

**Leading hypothesis, ranked by how routine the timing is:** login and the
home page are adjacent in the user's flow. OTP verifies, `after()` schedules
the pre-warm in the background on *that* instance, the browser redirects to
`/`, and `TodaysFiveCard` mounts immediately and fires its **own** independent
POST to `/api/daily/queue` — a fresh HTTP request with no guarantee of
landing on the pre-warm's instance. This isn't an edge case: it's the
ordinary path for any returning user who logs in before that day's queue
exists (early risers ahead of the 17:05 UTC cron, or anyone outside the
cron's effective window entirely). The cron-vs-live-user overlap this doc
already suspected is real too, but narrower — it only applies in the
~17:00–18:05 UTC band, versus this pair's daily, per-user recurrence.

**What production data does and doesn't say, checked directly:**
- Zero `outcome='lost_persist_race'` rows since `#1620` deployed
  (2026-09-07T19:31 UTC) — expected and not informative yet: there has been
  no build traffic of any kind since the flip/fix window, per the
  `check:build-latency` / `check:gate-flags` reads earlier today.
- Zero historical same-user-same-day double-`built` rows in
  `DailyBuildMetric` either. But the one *known* real occurrence of this race
  (the anomaly that started this whole investigation) was on the disposable
  `Rue Prova` test fixture, and that row was cascade-deleted when the fixture
  was cleaned up (see the 2026-09-06 "later still" entry above). So the
  surviving telemetry structurally can't see the one confirmed case — real
  frequency is genuinely unmeasured, not zero.

**Not built, on purpose — this is reconnaissance, not a fix:** confirming
which pair of triggers actually collides in production needs a real
`lost_persist_race` row to inspect. When one appears, cross-reference that
user's `logLatency('daily_queue_prewarm', ...)` timestamp against their
`/daily`-POST or home-page-prefetch server-timing log for the same
few-second window — that would pin down which of the four candidate pairs
above is the actual mechanism, rather than leaving it ranked by plausibility.

### Next steps
1. Watch for the first `outcome='lost_persist_race'` row and, when one
   lands, correlate its timing against the user's login/prewarm and
   page-load logs per the paragraph above.
2. Everything else already listed above (Phase 3 population reading,
   question 4 on the bonus's own cost) is unchanged.

### 2026-09-08 (diagnosis-review) — no change; still n=3, still zero races

Re-checked everything this doc depends on, read-only:

- **`npm run check:build-latency`** — `DailyBuildMetric` totals now
  `carry_forward=65, existing_queue=9, built=4` (`existing_queue` up from 6
  at the last review; ordinary traffic, not investigated further). Still
  **no new `outcome='built'` row** since 2026-09-07T17:05:14Z — today's
  17:05 UTC cron result isn't in yet at review time, or fell through to
  `existing_queue`/`carry_forward`. Phase 3 stays at **n=3**, same three
  rows, same numbers: saved 1529/1362/2154ms, residual 1028/925/1627ms
  (925–1627ms spread, still "wide; explain before relying on it" per the
  script's own flag), median saving 1529ms.
- **`outcome='lost_persist_race'` count, queried directly**: still **0**
  rows in `DailyBuildMetric`. Confirms the 2026-09-08 entry above — no
  change, still uninformative about real-world frequency rather than
  evidence the race stopped happening (the one confirmed historical
  occurrence lived on a since-deleted disposable fixture, so the surviving
  telemetry structurally can't see it either way, per that entry).
- **PR `#1620`** reconfirmed `MERGED` to `main`. **`#1626`** ("diagnosis:
  name the trigger surface for the daily-build persist-race," the entry
  already in this file above) also confirmed `MERGED` to `main`
  (2026-09-08T00:51 UTC) — this file's content already matched `main`
  exactly (verified by diff), only the frontmatter `related-pr` list was
  missing it; corrected above.
- **Code check**: `git log --oneline -5` on `queue-orchestrator.ts` and
  `daily.ts` shows no commits past `#1620` — the check-and-skip fix is
  still the last thing to touch this path, consistent with "nothing to
  re-verify about the mechanism itself."

**No open decision changed.** The five triggers named in the 2026-09-08
entry above are still ranked by plausibility only; nothing new narrows them
down, since that still needs an actual `lost_persist_race` row to
correlate against.

### Next steps
1. Watch for the first `outcome='lost_persist_race'` row and, when one
   lands, correlate its timing against the user's login/prewarm and
   page-load logs per the 2026-09-08 entry above.
2. Everything else already listed above (Phase 3 population reading,
   question 4 on the bonus's own cost) is unchanged.

### 2026-09-12 (diagnosis-review) — no new Phase 3 data readable this session; later PRs confirmed NOT to touch the persist-race fix

**Same environment note as the other diagnosis files reviewed today:** no
`DATABASE_URL`/`ANTHROPIC_API_KEY` in this session and no connected Supabase
project, so `npm run check:build-latency` could not be run and
`DailyBuildMetric` / `outcome='lost_persist_race'` could not be queried.
Phase 3 stays at the last known reading (n=3, median saving 1529ms, residual
925–1627ms).

Checked what git can confirm instead:
- `git log -- src/server/daily/queue-orchestrator.ts src/server/db/queries/daily.ts`
  shows three commits since the last review touching one of the two files:
  `#1635` (friend-domain backfill diversity cap, `queue-orchestrator.ts`
  only, +38/-2, unrelated to persist logic), `#1646` (the question-lifecycle
  PR, `daily.ts` +6/-0), and `#1662` (the R3–R9 prompt batch, `daily.ts`
  +183/-3 — the 3 deletions are the sub-angle-dedupe rewrite, nowhere near
  the persist-race code). **None touch `persistDailyQueue`'s
  `{ row, won }` contract or the orchestrator's bail-on-loss check** —
  confirmed by re-reading both directly: the `PersistDailyQueueResult` type,
  its three return sites, and the `if (!persistResult.won)` check are
  byte-identical to what `#1620` shipped.
- PRs `#1620` and `#1626` reconfirmed `MERGED` to `main`.

**No decision-resolving change.** Status stays `active`. Open question 5
stays fixed/closed; questions 3 and 4 stay open and untouched; the
`lost_persist_race` watch and the Phase 3 population reading both need a
session with DB access to advance.

### Next steps (unchanged)
1. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
2. Phase 3 population reading, question 4 (bonus cost) — unchanged.

### 2026-09-14 (diagnosis-review) — no change; still no DB access this session

**Environment note:** no `.env`/`.env.local` present (`ls .env*` shows only
`.env.example`) and `mcp__Supabase__list_projects` returns zero projects, so
`npm run check:build-latency` could not be run and `DailyBuildMetric` /
`outcome='lost_persist_race'` could not be queried, same constraint as the
last two reviews. Phase 3 stays at the last known reading (n=3, median
saving 1529ms, residual 925–1627ms).

Checked what git can confirm instead:
- `git log --since=2026-09-12 -- src/server/daily/queue-orchestrator.ts
  src/server/db/queries/daily.ts src/server/daily/build-context.ts` —
  **zero commits.** Nothing has touched the persist-race fix, the two
  build-latency columns, or the orchestrator's bail-on-loss check since the
  last review; `#1620`'s `{ row, won }` contract is still the last change to
  this path.
- `git log --all --grep=revert --since=2026-09-05` — no reverts of `#1620`
  or `#1626`, and both remain in `main`'s ancestry (only fast-forwarded this
  session, never rebased), so their merged state is unchanged from the last
  direct API confirmation.
- Nine commits landed on `main` since the last review (#1670–#1683); none
  touch the daily-build/queue-orchestrator path — spot-checked their file
  lists directly rather than assumed.

**No decision-resolving change.** Status stays `active`. Open question 5
stays fixed/closed; questions 3 and 4 stay open and untouched; the
`lost_persist_race` watch and the Phase 3 population reading both still need
a session with DB access to advance.

### Next steps (unchanged)
1. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
2. Phase 3 population reading, question 4 (bonus cost) — unchanged.

### 2026-09-15 (diagnosis-review) — DB access restored; n grows 3→15; the "stable residual" question reopens far wider than before, driven by two new large outliers

**Environment note:** this session has a live, read-only Supabase MCP
connection to the production project (`grixooyecvnugpxvcbct`) — the first
DB access this doc has had since the 2026-09-08 entries (2026-09-12 and
2026-09-14 both had none). All numbers below are directly queried.

**`outcome='lost_persist_race'` is still 0 rows**, cumulative, all time.
Unchanged conclusion: still uninformative about real-world race frequency
either way (the one confirmed historical occurrence lived on a
since-deleted disposable fixture, so surviving telemetry structurally
can't see it).

**Phase 3a (mechanism) still holds on every row**: `span_ms - user_visible_ms`
is ≥ that row's own bonus `generationMs` on all 15 post-deferral `built`
rows queried (full history, not just the 3 previously known). No row
violates the "can't save more than the work was worth" floor.

**Phase 3b (population) — n jumped from 3 to 15, and the median moved a
lot: 1,529ms → 8,678ms.** Full table (`saved` = `span_ms - user_visible_ms`,
`residual` = `saved` − that row's bonus-phase `generationMs`):

| started_at | saved | bonus | residual |
|---|---:|---:|---:|
| 2026-09-06 17:03:54 | 1,529 | 501 | 1,028 |
| 2026-09-06 17:05:14 | 1,362 | 437 | 925 |
| 2026-09-07 17:05:14 | 2,154 | 527 | 1,627 |
| 2026-09-08 17:05:15 | 8,241 | 7,021 | 1,220 |
| 2026-09-09 17:05:14 | 8,678 | 7,473 | 1,205 |
| **2026-09-09 17:05:16** | **38,116** | 610 | **37,506** |
| 2026-09-10 17:05:16 | 17,701 | 16,169 | 1,532 |
| 2026-09-11 17:05:17 | 10,221 | 6,479 | 3,742 |
| 2026-09-12 17:05:16 | 18,117 | 16,821 | 1,296 |
| 2026-09-13 00:42:18 | 1,618 | 907 | 711 |
| 2026-09-13 17:05:15 | 2,193 | 932 | 1,261 |
| 2026-09-13 17:05:18 | 20,563 | 19,190 | 1,373 |
| **2026-09-14 17:05:19 (87e51589)** | **24,688** | 941 | **23,747** |
| 2026-09-14 17:05:19 (01087e38) | 12,745 | 11,966 | 779 |
| 2026-09-14 23:40:02 | 1,436 | 727 | 709 |

Median saving (n=15): **8,678ms**. Residual spread widened from the
already-flagged "925–1627ms, wide" band at n=3 to **709ms – 37,506ms**
at n=15 — over 50x, not a gradual widening.

**Two rows are dramatic outliers, and neither matches a known failure
signature.** `84e717bd…` (2026-09-09 17:05:16) and `87e51589…` (2026-09-14
17:05:19) both show `deferred: true` with `span_ms` fully populated — not
the "continuation dropped" signature this doc's own §6 already watches
for — yet their residual (the part of the saving NOT explained by bonus
`generationMs`) is 20–40x every other row's. Something took an extra
23.7–37.5 seconds on these two builds that isn't bonus generation and isn't
explained by anything this doc currently measures. Not investigated
further this pass (out of scope for a review — this is reconnaissance, not
a fix), but naming both build_ids here so whoever picks this up next
doesn't have to re-find them.

**No recurrence of the original slot-collision anomaly (open question 5):**
`target_size = 5` and `final_size ≥ target_size` on all 15 rows (final_size
5, 6, or 7 — no `final_size < target_size` case like the historical
3-slot corruption). The #1620 fix continues to show no sign of the old
damage pattern.

**This does not resolve open question 4** (is the +2 bonus worth its
generation cost) — if anything it makes the honest answer noisier: most
builds save low-single-digit seconds, but a minority save (or cost,
depending on framing) 20-40 seconds for reasons not yet understood. Not
flipping status to `needs-decision`: there's no clean yes/no ready for
Josh here, just a widened uncertainty band and two named outliers worth a
closer look whenever someone has time to trace them (correlate against
Vercel function logs for those two timestamps, the way the original
persist-race investigation did).

### Next steps (revised)
1. **New:** trace why builds `84e717bd-…` (2026-09-09T17:05:16Z) and
   `87e51589-…` (2026-09-14T17:05:19Z) show 20-40x the residual of every
   other post-deferral row, despite normal `deferred`/`span_ms`/`final_size`
   fields — needs Vercel function logs for those windows, not just DB data.
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — now has more data but a wider,
   not narrower, uncertainty band; still unresolved.

### 2026-09-16 (diagnosis-review) — n grows 15→18; a THIRD large-residual build found on 2026-09-15; still zero races, still no slot-collision recurrence

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
2026-09-15.

**`outcome='lost_persist_race'` is still 0 rows**, cumulative, all time. No
change from every prior reading.

**`DailyBuildMetric` totals:** `built=19` (1 pre-deferral baseline + 18
post-deferral, up from 15 post-deferral at the last review),
`carry_forward=238`, `existing_queue=27`, `partial_carry_forward=2`.

**Three new post-deferral rows since the last review**, all `deferred:
true`, `target_size=5`, `final_size` 5 or 6 (no recurrence of the
open-question-5 slot-collision shape):

| started_at | saved | bonus (`generationMs`) | residual |
|---|---:|---:|---:|
| 2026-09-15 11:22:10 | 7,611 | 6,925 | 686 |
| 2026-09-15 17:05:17 | 15,546 | 14,662 | 884 |
| **2026-09-15 17:05:18** | **25,482** | 12,405 | **13,077** |
| 2026-09-16 00:39:40 | 1,471 | 766 | 705 |

**A third dramatic-residual build, `cff84520-…` (2026-09-15 17:05:18Z),
different in shape from the first two.** The two previously-named outliers
(`84e717bd-…`, `87e51589-…`) had *small* bonus-phase `generationMs` (610ms,
941ms) paired with a *huge* residual (23.7s, 37.5s) — the anomaly lived
entirely outside bonus generation. This one's own bonus generation was
already large (12,405ms) and its residual (13,077ms) is elevated well above
the normal 700–3,700ms band but far below the two prior outliers. Whether
this is the same underlying mechanism at a different magnitude, or a
different mechanism that happens to also inflate the residual, is not
established — not investigated further this pass (still reconnaissance, not
a fix), but naming it here so whoever traces the first two doesn't have to
separately re-find this one.

**Worth noting on the same timestamp:** `a78fdf84-…` (17:05:17) and
`cff84520-…` (17:05:18) started **one second apart**, both from the same
17:05 UTC cron pass, both `deferred: true`, both `final_size: 6` — two
builds completing in close succession with very different bonus-generation
costs (14,662ms vs 12,405ms). `outcome='lost_persist_race'` is 0 for both,
so this is not the persist-race this doc already fixed; presumably two
different users' builds landing in the same cron tick, which is unremarkable
given `USER_CONCURRENCY=4`. Flagging only because it's adjacent to the new
anomaly, not because it is one itself.

**3b population, updated: median saving 9,449.5ms** (n=18, was 8,678ms at
n=15). Residual spread is still 709ms–37,506ms — the new rows don't move
either end of that range, they add a third point inside it.

**No code change since the last review:** `git log --since=2026-09-15` on
`queue-orchestrator.ts`, `daily.ts`, and `build-context.ts` returns nothing.

**No decision-resolving change.** Status stays `active`. Question 4 (is the
bonus worth its generation cost) remains open and, if anything, the case for
looking harder at it keeps strengthening: bonus generation alone now
regularly runs 6–19 seconds on top of whatever residual overhead is present.

### Next steps (revised)
1. Trace why `84e717bd-…` (2026-09-09), `87e51589-…` (2026-09-14), and now
   `cff84520-…` (2026-09-15) show outsized residuals — needs Vercel function
   logs for those windows, not just DB data. Three occurrences in 18 rows
   (~17%) is no longer a tail case worth deferring indefinitely.
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved, and bonus
   generation cost itself (not just the residual) is trending up.

### 2026-09-16 (later, diagnosis-review) — second same-day check; no new built row

Re-queried a few hours after the entry above, same live Supabase access.
`DailyBuildMetric` totals unchanged: `built=19` (1 baseline + 18
post-deferral — no new row since this morning), `outcome='lost_persist_race'`
still **0**, cumulative all time. No new PRs, and `git log` since the entry
above confirms zero commits touching `queue-orchestrator.ts`, `daily.ts`, or
`build-context.ts`.

**No decision-resolving change.** Status stays `active`. Phase 3's n stays
at 18 post-deferral rows; the three named outlier builds (2026-09-09,
2026-09-14, 2026-09-15) are still untraced.

### Next steps (unchanged)
1. Trace the three outsized-residual builds — needs Vercel function logs.
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved.

### 2026-09-17 (diagnosis-review) — one new built row, no new outlier; still zero races; median saving rises to 10,221ms (n=19)

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
2026-09-15/16.

**One new post-deferral row since the last review**, from yesterday's 17:05
UTC cron: `44703a3f-…` (2026-09-16 17:05:17Z), `deferred: true`,
`target_size=5`, `final_size=6` — no recurrence of the open-question-5
slot-collision shape.

```
saved 14,072ms   bonus (generationMs) 13,215ms   residual 857ms   <- new, normal band
```

The residual (857ms) sits comfortably inside the pre-outlier 700–3,700ms
band — this row is **not** a fourth instance of the large-residual anomaly
that hit three of the last nine rows. **3b population, updated: median
saving 10,221ms** (n=19, was 9,449.5ms at n=18) — one row, small move.

**`outcome='lost_persist_race'` is still 0 rows**, cumulative, all time. No
change from every prior reading.

**No code change since the last review** to this doc's tracked paths
(`queue-orchestrator.ts`, `daily.ts`, `build-context.ts`) — `git log
--since=2026-09-16` on all three returns nothing. Two commits did land on
`main` since the last review (`#1698`, `#1699`, a bank-dedup/subject-entity
change), both confirmed by diff to touch `generate-questions.ts` only in
ways unrelated to persist logic or build-latency instrumentation — noted
for completeness, not a hit on this doc's tracked paths.

**No decision-resolving change.** Status stays `active`. The three named
outlier builds (2026-09-09, 2026-09-14, 2026-09-15) remain untraced.

### Next steps (unchanged)
1. Trace the three outsized-residual builds — needs Vercel function logs.
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved.

### 2026-09-18 (diagnosis-review) — one new built row, normal residual; median saving rises to 11,483ms (n=20); still zero races, still no fourth outlier

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**One new post-deferral row since the last review**, from yesterday's 17:05
UTC cron: `97066d39-…` (2026-09-17 17:05:18Z), `deferred: true`,
`target_size=5`, `final_size=6` — no recurrence of the open-question-5
slot-collision shape.

```
saved 14,293ms   bonus (generationMs) 13,418ms   residual 875ms   <- normal band
```

The residual (875ms) sits comfortably inside the pre-outlier 700–3,700ms
band — this is **not** a fourth instance of the large-residual anomaly that
hit three of the last twenty rows. **3b population, updated: median saving
11,483ms** (n=20, was 10,221ms at n=19).

**`outcome='lost_persist_race'` is still 0 rows**, cumulative, all time. No
change from every prior reading. `DailyBuildMetric` totals: `built=21`,
`carry_forward=286`, `existing_queue=30`, `partial_carry_forward=2`.

**No code change since the last review** to this doc's tracked paths
(`queue-orchestrator.ts`, `daily.ts`, `build-context.ts`) — the only two
commits on `main` since the last review (`#1697` design-canon, `#1700` a UI
text-wrap fix) touch neither file, confirmed by diffing their changed-file
lists directly.

**No decision-resolving change.** Status stays `active`. The three named
outlier builds (2026-09-09, 2026-09-14, 2026-09-15) remain untraced.

### Next steps (unchanged)
1. Trace the three outsized-residual builds — needs Vercel function logs.
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved.

### 2026-09-19 (diagnosis-review) — no new built row; still zero races; a new, adjacent-but-different queue-insert path shipped in #1703, worth a name-check only

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**`DailyBuildMetric` totals: `built=21`** — byte-identical to the last
review (no new `outcome='built'` row since `97066d39…`,
2026-09-17T17:05:18Z). `carry_forward=309` (up from 286),
`existing_queue=30` (flat), `partial_carry_forward=4` (up from 2).
**`outcome='lost_persist_race'` is still 0 rows**, cumulative, all time —
unchanged from every prior reading.

Phase 3 stays at the last known reading (n=20 post-deferral + 1 baseline,
median saving 11,483ms) — no new row to add one.

**Not a hit on this doc's tracked paths, but close enough to name:** `#1703`
("fix(daily): carry-forward no longer erases yesterday's round or
suppresses today's reminder"), merged 2026-09-18T21:18:38Z, touches
`src/server/db/queries/daily.ts` and `src/server/daily/queue-orchestrator.ts`
— both files this doc watches — but changes a **different** function,
`carryForwardQueueWithSlots`, not `persistDailyQueue`. Read the diff
directly: `persistDailyQueue`'s `{ row, won }` contract and the
orchestrator's `if (!persistResult.won)` bail-out (the `#1620` fix this doc
tracks) are untouched. What changed instead: `carryForwardQueueWithSlots`
used to `UPDATE` the PRIOR day's queue row in place (re-dating it onto
today), which silently erased that row's answered slots and reset its
reminder-sent stamps; it now `INSERT`s a fresh row for today and only
strips the carried slot indices from the prior row, leaving its answered
history intact. It has its own first-writer-wins guard (catches Postgres
`23505` on the new insert, returns `false` for the caller to fall through
on a race) — a different mechanism from `persistDailyQueue`'s `won` flag,
but the same design intent. Not the mechanism `#1620` fixed, not a
regression of it, and no `lost_persist_race` rows appeared after it shipped
(still 0) — flagging only because it's a same-file, same-domain write-path
change, not because anything here needs Josh's decision.

**No decision-resolving change.** Status stays `active`. The three named
outlier builds (2026-09-09, 2026-09-14, 2026-09-15) remain untraced.

### Next steps (unchanged)
1. Trace the three outsized-residual builds — needs Vercel function logs.
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved.

### 2026-09-21 (diagnosis-review) — two new built rows, both normal residual; median saving unchanged at 11,483ms (n=22); still zero races; three outlier builds remain untraced; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**`DailyBuildMetric` totals:** `built=23` (up from 21), `carry_forward=357`,
`existing_queue=30`, `partial_carry_forward=4`. **`outcome='lost_persist_race'`
is still 0 rows**, cumulative, all time.

**Two new post-deferral rows since the last review**, both `deferred: true`,
`target_size=5`, neither reproducing the open-question-5 slot-collision
shape (`final_size` 6 on both):

| started_at | saved | bonus (`generationMs`) | residual |
|---|---:|---:|---:|
| 2026-09-19 17:05:18Z | 15,295 | 14,450 | 845 |
| 2026-09-20 17:05:18Z | 7,913 | 6,708 | 1,205 |

Both residuals sit comfortably inside the normal 700–3,700ms band — neither
is a fourth instance of the large-residual anomaly that hit the three named
outlier builds (2026-09-09, 2026-09-14, 2026-09-15). Phase 3a (mechanism)
holds on both: `saved ≥` that row's own bonus `generationMs`.

**3b population: median saving unchanged at 11,483ms** (n=22, up from
n=20) — the two new rows landed on either side of the middle of the
distribution without moving it.

**No code change since the last review:** zero commits landed on `main` at
all since the 2026-09-19 diagnosis-review commit (confirmed via `git log`),
so `queue-orchestrator.ts`, `daily.ts`, and `build-context.ts` are
byte-identical to the last review.

**No decision-resolving change.** Status stays `active`. The three named
outlier builds (2026-09-09, 2026-09-14, 2026-09-15) remain untraced.

### Next steps (unchanged)
1. Trace the three outsized-residual builds — needs Vercel function logs.
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved.

### 2026-09-23 (diagnosis-review) — one new built row, normal residual; median saving rises to 13,408.5ms (n=24); still zero races; three outlier builds remain untraced; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**`DailyBuildMetric` totals:** `built=25` (up from 24), `carry_forward=405`,
`existing_queue=31`, `partial_carry_forward=4`. **`outcome='lost_persist_race'`
is still 0 rows**, cumulative, all time.

**One new post-deferral row since the last review**, from yesterday's 17:05
UTC cron: `653f7bc4-…` (2026-09-22 17:05:18.484Z), `target_size=5`,
`final_size=6` — no recurrence of the open-question-5 slot-collision shape.

```
saved 15,708ms   bonus (generationMs) 14,783ms   residual 925ms   <- normal band
```

The residual (925ms) sits comfortably inside the normal 700–3,700ms band —
not a fourth instance of the large-residual anomaly that hit the three
named outlier builds (2026-09-09, 2026-09-14, 2026-09-15). Phase 3a
(mechanism) holds: `saved ≥` this row's own bonus `generationMs`.

**3b population: median saving 13,408.5ms** (n=24, up from 12,745ms at
n=23) — one row, moved the median up since it landed above the prior
midpoint.

**No code change since the last review:** `git log --since=2026-09-22` on
`queue-orchestrator.ts`, `daily.ts`, and `build-context.ts` returns nothing.

**No decision-resolving change.** Status stays `active`. The three named
outlier builds (2026-09-09, 2026-09-14, 2026-09-15) remain untraced.

### Next steps (unchanged)
1. Trace the three outsized-residual builds — needs Vercel function logs.
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved.

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**`DailyBuildMetric` totals:** `built=24` (up from 23), `carry_forward=381`,
`existing_queue=30`, `partial_carry_forward=4`. **`outcome='lost_persist_race'`
is still 0 rows**, cumulative, all time.

**One new post-deferral row since the last review**, from yesterday's 17:05
UTC cron: `da48262f-…` (2026-09-21 17:05:19.605Z), `target_size=5`,
`final_size=6` — no recurrence of the open-question-5 slot-collision shape.

```
saved 18,833ms   bonus (generationMs) 18,032ms   residual 801ms   <- normal band
```

The residual (801ms) sits comfortably inside the normal 700–3,700ms band —
not a fourth instance of the large-residual anomaly that hit the three
named outlier builds (2026-09-09, 2026-09-14, 2026-09-15). Phase 3a
(mechanism) holds: `saved ≥` this row's own bonus `generationMs`.

**3b population: median saving 12,745ms** (n=23, up from 11,483ms at
n=22) — one row, moved the median up since it landed above the prior
midpoint.

**No code change since the last review:** zero commits landed on `main` at
all since the 2026-09-21 diagnosis-review commit (confirmed via `git log`),
so `queue-orchestrator.ts`, `daily.ts`, and `build-context.ts` are
byte-identical to the last review.

**No decision-resolving change.** Status stays `active`. The three named
outlier builds (2026-09-09, 2026-09-14, 2026-09-15) remain untraced.

### Next steps (unchanged)
1. Trace the three outsized-residual builds — needs Vercel function logs.
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved.

### 2026-09-24 (diagnosis-review) — four new built rows; two show large residuals, joining the outlier cluster (now 5 of 28, ~18%); median saving flat at 13,408.5ms; still zero races; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**`DailyBuildMetric` totals:** `built=29` (up from 25), `carry_forward=427`,
`existing_queue=32`, `partial_carry_forward=5`. **`outcome='lost_persist_race'`
is still 0 rows**, cumulative, all time.

**Four new post-deferral rows since the last review**, all `deferred: true`,
`target_size=5`:

| build_id | started_at | saved | bonus (`generationMs`) | residual |
|---|---|---:|---:|---:|
| `a79b0faf-…` | 2026-09-23 11:17:28Z | 1,372 | 663 | 709 — normal band |
| `42f757d7-…` | 2026-09-23 17:05:13Z | 18,853 | 844 | **18,009 — elevated** |
| `8753461a-…` | 2026-09-23 17:05:14Z | 27,854 | 728 | **27,126 — outlier-class** |
| `851b49c6-…` | 2026-09-23 17:05:22Z | 1,659 | 755 | 904 — normal band |

Two of the four are unremarkable. **Two are not**, both from the same
17:05 UTC cron pass one second apart: `8753461a-…`'s residual (27,126ms) is
squarely in the same magnitude as the three previously-named outliers
(23,747 / 37,506 / 13,077ms) — a small bonus-generation cost (728ms) paired
with a huge unexplained residual, the exact shape of the first two named
outliers (`84e717bd-…`, `87e51589-…`). `42f757d7-…`'s residual (18,009ms)
sits between the normal band and the outlier band — elevated but not as
extreme, closer to `cff84520-…`'s shape (large bonus cost *and* an inflated
residual) than to the pure-residual outliers.

**This raises the outlier count from 3 to effectively 5 of 28 post-deferral
rows (~18%)** — no longer a small tail. Per the standing next-step, tracing
this needs Vercel function logs this session doesn't have; naming
`8753461a-…` and `42f757d7-…` here (alongside the still-untraced
`84e717bd-…`, `87e51589-…`, `cff84520-…`) so whoever picks up the trace has
the full set, not just the original three.

**Phase 3a (mechanism) still holds** on all four new rows: `saved ≥` each
row's own bonus `generationMs`.

**3b population: median saving 13,408.5ms** (n=28, unchanged from n=24) —
the new rows split two-and-two around the existing midpoint, so the median
itself didn't move even though the outlier cluster grew.

**No code change since the last review:** `git log --since=2026-09-23` on
`queue-orchestrator.ts`, `daily.ts`, and `build-context.ts` returns nothing.
One commit landed on `main` since the last review (`#1709`, "Argue your
point — reason-backed recheck"); read the diff — touches
`src/server/answers/`, not this doc's tracked build/queue paths.

**No decision-resolving change.** Status stays `active`. The outlier-trace
next step is now more urgent given the growth from 3 to 5 occurrences, but
still needs access this session doesn't have.

### Next steps (revised)
1. **Trace the now-five outsized-residual builds** — needs Vercel function
   logs. Named: `84e717bd-…` (09-09), `87e51589-…` (09-14), `cff84520-…`
   (09-15), `42f757d7-…` and `8753461a-…` (both 09-23).
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved, and the growing
   outlier share makes it harder to answer with a single number.

### 2026-09-25 (diagnosis-review) — two new built rows, one joins the elevated-residual cluster (now 6 of 30, 20%); median saving flat at 13,408.5ms (n=30); still zero races; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**`DailyBuildMetric` totals:** `built=31` (up from 29), `carry_forward=451`,
`existing_queue=32`, `partial_carry_forward=5`. **`outcome='lost_persist_race'`
is still 0 rows**, cumulative, all time.

**Two new post-deferral rows since the last review**, both `deferred: true`,
`target_size=5`, `final_size=6` — no recurrence of the open-question-5
slot-collision shape:

| build_id | started_at | saved | bonus (`generationMs`) | residual |
|---|---|---:|---:|---:|
| `d88523fa-…` | 2026-09-24 17:05:17.91Z | 1,722 | 861 | 861 — normal band |
| `758748d3-…` | 2026-09-24 17:05:18.461Z | 21,794 | 7,100 | **14,694 — elevated** |

`d88523fa-…` is unremarkable. `758748d3-…` joins the elevated-residual
cluster — not as extreme as the four pure/near-pure outliers (23.7k–37.5k),
but well above the normal 700–3,700ms band, closer in shape to `cff84520-…`
(large bonus cost *and* an inflated residual) than to the small-bonus/huge-
residual pattern of the first two named outliers. **This raises the
elevated/outlier count to 6 of 30 post-deferral rows (20%)** — named here
alongside the existing five so whoever traces them has the complete set:
`84e717bd-…` (09-09), `87e51589-…` (09-14), `cff84520-…` (09-15),
`42f757d7-…` and `8753461a-…` (09-23), `758748d3-…` (09-24). Not traced this
pass — still needs Vercel function logs this session doesn't have.

**Phase 3a (mechanism) still holds** on both new rows: `saved ≥` each row's
own bonus `generationMs`.

**3b population: median saving 13,408.5ms** (n=30, up from n=28) —
recomputed over the full 30-row post-deferral population; the new rows
landed on either side of the existing midpoint, so the median value itself
is unchanged even though n grew.

**No code change since the last review:** `git log --since=2026-09-24` on
`queue-orchestrator.ts`, `daily.ts`, and `build-context.ts` returns nothing.
No new PRs landed on `main` at all since the 2026-09-24 diagnosis-review
commit.

**No decision-resolving change.** Status stays `active`. The outlier-trace
next step is now more urgent still (3→5→6 occurrences across successive
reviews), but still needs access this session doesn't have.

### Next steps (unchanged)
1. **Trace the now-six outsized/elevated-residual builds** — needs Vercel
   function logs. Named: `84e717bd-…` (09-09), `87e51589-…` (09-14),
   `cff84520-…` (09-15), `42f757d7-…` and `8753461a-…` (09-23),
   `758748d3-…` (09-24).
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved, and the growing
   outlier share makes it harder to answer with a single number.

### 2026-09-26 (diagnosis-review) — three new built rows, two more join the outlier cluster (now 8 of 32, 25%); median saving rises to 14,311.5ms (n=32); still zero races; one new PR touches queue-orchestrator.ts but not the tracked persist-race path

**Environment note:** no `.env` file in this session (only `.env.example`),
and no `node_modules` installed at all, so `npm run check:build-latency`
itself fails immediately (`ERR_MODULE_NOT_FOUND: dotenv`) rather than
reporting "no DB access" — a different failure mode than the 2026-09-12/14
reviews, but the same practical result for that one command. Worked around
it the way the 2026-09-15-onward reviews already do: a live, read-only
Supabase MCP connection to the production project (`grixooyecvnugpxvcbct`)
is available, so the same read-only queries the script would run were
issued directly against `DailyBuildMetric`.

**`DailyBuildMetric` totals:** `built=33` (1 baseline + 32 post-deferral,
up from 31 total / 30 post-deferral at the last review — see discrepancy
note below), `carry_forward=464`, `existing_queue=41`,
`partial_carry_forward=5`. **`outcome='lost_persist_race'` is still 0
rows**, cumulative, all time — no change from every prior reading.

**Three new post-deferral rows since the last-named build (`758748d3-…`,
2026-09-24T17:05:18.461Z)**, all from yesterday's 17:05 UTC cron pass, all
`deferred: true`, `target_size=5`, `final_size=6`:

| build_id | started_at | saved | bonus (`generationMs`) | residual |
|---|---|---:|---:|---:|
| `4f9efefa-…` | 2026-09-25 17:05:16.166Z | 31,229 | 750 | **30,479 — outlier-class** |
| `76790f46-…` | 2026-09-25 17:05:21.271Z | 26,823 | 739 | **26,084 — outlier-class** |
| `a000b944-…` | 2026-09-25 17:05:21.898Z | 14,330 | 13,510 | 820 — normal band |

**Two of the three are new outliers, both the small-bonus/huge-residual
shape** (750ms and 739ms of bonus generation paired with 30.5s and 26.1s of
unexplained residual) — the same pattern as `84e717bd-…` and `87e51589-…`,
not the "large bonus + inflated residual" shape of `cff84520-…` /
`758748d3-…`. **This raises the outlier/elevated count from 6 of 30 to 8 of
32 (25%)**, continuing the same successive-review growth this doc has
tracked (3→5→6→8) without narrowing the mechanism. Full named set now:
`84e717bd-…` (09-09), `87e51589-…` (09-14), `cff84520-…` (09-15),
`42f757d7-…` and `8753461a-…` (09-23), `758748d3-…` (09-24), and today's
`4f9efefa-…` and `76790f46-…` (09-25). Not traced this pass — still needs
Vercel function logs this session doesn't have.

**Phase 3a (mechanism) still holds** on all three new rows: `saved ≥` each
row's own bonus `generationMs`.

**3b population: median saving 14,311.5ms** (n=32, up from 13,408.5ms at
n=30), computed directly via `percentile_cont(0.5)` over all post-deferral
rows, not just the three new ones.

**Discrepancy noted, not chased down:** counting post-deferral rows with
`started_at <=` the last-reviewed build's timestamp gives **29**, not the
**30** the 2026-09-25 entry stated. The three new rows above are confirmed
new (all dated after that timestamp), so this is a pre-existing one-row
mismatch in either that entry's count or this one's filter, not evidence of
a deleted or miscounted row today. Flagging honestly rather than silently
reconciling it; doesn't change the direction or magnitude of anything above
by more than one row.

**One new commit touches a tracked file, but not the tracked mechanism:**
`#1710` ("fix(daily): stop unanswered bonus/second-look slots from carrying
into next day as slot 0"), merged 2026-09-25T10:52:45Z — after the
2026-09-25 review's git check (which correctly found nothing as of its
06:20 UTC run) and before this one. Confirmed merged via
`mcp__github__pull_request_read`. Read the diff directly: it changes
`topUpAndCarryForwardPartialQueue` in `queue-orchestrator.ts` (now exported)
to filter carried slots through `getCoreSlots` instead of taking every
unanswered slot, so a lone unanswered +2/Second-look slot no longer gets
re-indexed to `slot_index 0` of the next day's queue. It does **not** touch
`persistDailyQueue`'s `{ row, won }` contract in `daily.ts`, the
orchestrator's `if (!persistResult.won)` bail-out, or anything in
`build-context.ts` — confirmed by reading the commit's file list (only
`queue-orchestrator.ts` + its test file changed). Open question 5's fix is
unaffected; this is a different bug in an adjacent function.

PRs `#1620` and `#1626` reconfirmed `MERGED` to `main` via
`mcp__github__pull_request_read` (`merged: true`, unchanged from every
prior reading). `#1710` also confirmed `MERGED`.

**No decision-resolving change.** Status stays `active`. The outlier-trace
next step is more urgent still (3→5→6→8 occurrences across successive
reviews, now a quarter of all post-deferral rows), but still needs Vercel
access this session doesn't have. Question 4 (is the bonus worth its cost)
remains open and unresolved.

### Next steps (unchanged)
1. **Trace the now-eight outsized/elevated-residual builds** — needs Vercel
   function logs. Named: `84e717bd-…` (09-09), `87e51589-…` (09-14),
   `cff84520-…` (09-15), `42f757d7-…` and `8753461a-…` (09-23),
   `758748d3-…` (09-24), `4f9efefa-…` and `76790f46-…` (09-25).
2. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
3. Question 4 (is the bonus worth its cost) — unresolved, and the growing
   outlier share (now 25%) makes it harder to answer with a single number.

### 2026-09-27 (diagnosis-review) — three new built rows: one more outlier (now 9 of 35, 26%), and the FIRST-EVER `deferred: false` row on a real build, with no bonus phase at all; median saving flat at 14,293ms (n=35); still zero races; no new code touching the tracked persist-race path

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**`DailyBuildMetric` totals:** `built=36` (1 baseline + 35 post-deferral, up
from 33 total / 32 post-deferral at the last review), `carry_forward=486`,
`existing_queue=52`, `partial_carry_forward=5`. **`outcome='lost_persist_race'`
is still 0 rows**, cumulative, all time.

**Three new post-deferral rows since the last review, all from the
2026-09-26 17:00–17:05 UTC cron window:**

| build_id | started_at | deferred | span_ms | user_visible_ms | saved | bonus (`generationMs`) | residual |
|---|---|---|---:|---:|---:|---:|---:|
| `4bf5cfb6-…` | 17:00:37.802Z | true | 39,587 | 37,974 | 1,613 | 900 | 713 — normal band |
| `4206ffb0-…` | 17:03:40.219Z | **false** | 50,757 | 50,616 | 141 | — (`rounds: []`, 0 bonus rounds) | n/a |
| `87cf2e9a-…` | 17:05:20.294Z | true | 37,555 | 11,653 | **25,902** | 740 | **25,162 — outlier-class** |

**Two things worth naming precisely.**

1. **`87cf2e9a-…` joins the outlier cluster** — the same small-bonus/huge-
   residual shape as `84e717bd-…`, `87e51589-…`, `4f9efefa-…`, and
   `76790f46-…` (740ms of bonus generation paired with 25.2s of unexplained
   residual). **This raises the outlier/elevated count to 9 of 35
   post-deferral rows (26%)**, continuing the same successive-review growth
   this doc has tracked (3→5→6→8→9). Not traced this pass — still needs
   Vercel function logs this session doesn't have. Full named set: the
   eight from the last review plus today's `87cf2e9a-…`.
2. **`4206ffb0-…` is the first `deferred: false` row this doc has ever
   recorded on a genuine post-deferral build** (`rounds: []`,
   `round_count: 0`, `generate_call_count: 3` — no bonus phase ran at all).
   This is exactly the second failure signature §6 has warned about since
   this doc opened but never actually seen: *"`deferred: false` on a cron
   build → `after()` was unavailable and the tail ran inline. Correct, but
   not faster — and it means the deferral is inert on the one path that
   matters."* `saved` on this row is a negligible 141ms, consistent with
   the tail running inline rather than being deferred. Landed inside the
   same 17:05 UTC cron window as the other two rows above (17:03:40, one
   minute before), so this looks like an ordinary cron-triggered build
   where `after()` simply wasn't available on that invocation — not a
   crash or an error (no anomalous `final_size`, `target_size=5` as usual).
   Not investigated further this pass (reconnaissance, not a fix), but
   naming it because it's a new occurrence of a previously-only-theoretical
   failure mode, worth watching for a repeat.

**Phase 3a (mechanism) holds** on the two rows with a bonus phase
(`saved ≥` each row's own bonus `generationMs`); not applicable to
`4206ffb0-…` (no bonus phase recorded to check against).

**3b population: median saving 14,293ms** (n=35, up from 14,311.5ms at
n=32) — essentially flat; the new rows split around the existing
distribution without moving the median materially.

**No code change since the last review** to `queue-orchestrator.ts`,
`daily.ts`, or `build-context.ts` — the one commit landing on `main` since
the last review's commit that touches a tracked file
(`generate-questions.ts`, via `#1717`) does not touch any of these three
paths; confirmed by diffing its file list directly. `#1717` and `#1720`
both confirmed `merged: true` via the GitHub API — neither is relevant to
this doc's tracked persist-race mechanism (see
`question-lifecycle-quality-plan.md` and
`answer-leak-domain-drift-plan.md`'s own entries today for what each is
relevant to instead).

**No decision-resolving change.** Status stays `active`. The outlier-trace
next step is more urgent still (3→5→6→8→9 occurrences across successive
reviews, now over a quarter of all post-deferral rows), but still needs
Vercel access this session doesn't have. The new `deferred: false` sighting
is a second, independent thing worth tracing if it recurs. Question 4 (is
the bonus worth its cost) remains open and unresolved.

### Next steps (revised)
1. **Trace the now-nine outsized/elevated-residual builds** — needs Vercel
   function logs. Named: `84e717bd-…` (09-09), `87e51589-…` (09-14),
   `cff84520-…` (09-15), `42f757d7-…` and `8753461a-…` (09-23),
   `758748d3-…` (09-24), `4f9efefa-…` and `76790f46-…` (09-25), `87cf2e9a-…`
   (09-26).
2. **New:** watch for a repeat of `4206ffb0-…`'s `deferred: false` /
   no-bonus-phase shape — the first such row this doc has ever recorded on
   a real build. A second occurrence would be worth tracing via Vercel logs
   for whether `after()` availability is becoming less reliable.
3. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
4. Question 4 (is the bonus worth its cost) — unresolved, and the growing
   outlier share (now 26%) makes it harder to answer with a single number.

### 2026-09-28 (diagnosis-review) — a second `deferred: false` row lands the very next cron cycle, with a different shape than the first (four core rounds, 89.5s span); two new outlier-class residuals, one an all-time high (82.9s); outlier/elevated cluster grows from 9 to 11 of 39 (28%); median saving flat at 14,293ms; still zero races

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**`DailyBuildMetric` totals:** `built=40` (1 baseline + 39 post-deferral, up
from 36/35 at the last review), `carry_forward=508`, `existing_queue=61`,
`partial_carry_forward=5`. **`outcome='lost_persist_race'` is still 0
rows**, cumulative, all time — no change from every prior reading.

**Four new post-deferral rows since the last review, three from the
2026-09-27 17:05 UTC cron window and one late-night build:**

| build_id | started_at | deferred | span_ms | user_visible_ms | saved | bonus (`generationMs`) | residual |
|---|---|---|---:|---:|---:|---:|---:|
| `9c0361e9-…` | 17:05:16.027Z | **false** | 89,474 | 89,353 | 121 | — (4 `core`-phase rounds, no bonus round) | n/a |
| `90da8604-…` | 17:05:20.165Z | true | 87,647 | 4,224 | **83,423** | 545 | **82,878 — new all-time high, more than double the prior max** |
| `ae49589e-…` | 17:05:20.947Z | true | 87,102 | 59,703 | 27,399 | 785 | **26,614 — outlier-class** |
| `526edf0d-…` | 23:35:51.810Z | true | 26,253 | 24,321 | 1,932 | 923 | 1,009 — normal band |

**Three of the four are anomalous, and two things here are new, not just
more of the same pattern:**

1. **`90da8604-…`'s residual (82,878ms) is the largest this doc has ever
   recorded** — more than double the previous high (`4f9efefa-…`,
   30,479ms, 2026-09-25). Same small-bonus/huge-residual shape as the other
   outliers in that family (`84e717bd-…`, `87e51589-…`, `4f9efefa-…`,
   `76790f46-…`, `87cf2e9a-…`) — 545ms of bonus generation paired with 82.9
   seconds of unexplained residual.
2. **`ae49589e-…` joins the outlier cluster too** (26,614ms residual) — two
   new outliers in the same cron window, both landing within one second of
   `9c0361e9-…`, the window's third anomalous row.
3. **`9c0361e9-…` is only the second `deferred: false` row this doc has
   ever recorded on a real build — and it's shaped differently from the
   first.** The first (`4206ffb0-…`, 2026-09-26) had `rounds: []` and a
   negligible 141ms `saved` — consistent with "the tail ran inline, fast,
   nothing unusual besides the missing deferral." This one has **four
   recorded `core`-phase rounds** (totaling ~43.7s of `generationMs`) but a
   span of **89.5 seconds** — roughly 45.8s of the build is unaccounted for
   by generation time, even before considering that no bonus phase ran at
   all. This is a different failure signature from the first `deferred:
   false` row, not a repeat of it — it looks like a slow build in its own
   right, with the deferral separately inert on top of that.

**This raises the outlier/elevated count from 9 of 35 to 11 of 39 (28%)** —
continuing the same successive-review growth this doc has tracked
(3→5→6→8→9→11), now joined by a second `deferred: false` occurrence that
last review's next-step #2 specifically asked to watch for — but with a
shape unlike the first, so this reads as two distinct unexplained patterns
rather than one recurring one. Full named outlier set: `84e717bd-…`
(09-09), `87e51589-…` (09-14), `cff84520-…` (09-15), `42f757d7-…` and
`8753461a-…` (09-23), `758748d3-…` (09-24), `4f9efefa-…` and `76790f46-…`
(09-25), `87cf2e9a-…` (09-26), `90da8604-…` and `ae49589e-…` (09-27). Named
`deferred: false` set: `4206ffb0-…` (09-26, `rounds: []`), `9c0361e9-…`
(09-27, 4 core rounds, 89.5s span). Neither cluster traced this pass —
still needs Vercel function logs this session doesn't have.

**Phase 3a (mechanism) still holds** on all three rows with a bonus phase:
`saved ≥` each row's own bonus `generationMs`. Not applicable to
`9c0361e9-…` (no bonus phase recorded to check against, same as the first
`deferred: false` row).

**3b population: median saving 14,293ms** (n=39, unchanged from n=35 at the
last review) — the new rows split around the existing distribution without
moving the median, even though the cluster driving the spread got both
wider and more extreme.

**No code change since the last review** to `queue-orchestrator.ts`,
`daily.ts`, or `build-context.ts` — the seven commits landing on `main`
since the last review (`#1722` friend-news notifications, `#1723`
category-name matching, `#1724`–`#1729` knowledge-graph safety work) touch
none of them, confirmed by diffing each commit's file list directly. `#1722`
does touch `src/app/api/cron/daily-assignments/route.ts` (adding
friend-news lines to the SMS/email daily reminder), but only downstream of
an already-built queue — it reads `queue`, never calls into
`persistDailyQueue` or the orchestrator, and doesn't touch build timing.

**No decision-resolving change.** Status stays `active`. The outlier-trace
next step is more urgent still — now covering two distinct unexplained
patterns (the residual outliers and the `deferred: false` rows) rather than
one, both still needing Vercel access this session doesn't have. Question 4
(is the bonus worth its cost) remains open and unresolved.

### Next steps (revised)
1. **Trace the now-eleven outsized/elevated-residual builds** — needs
   Vercel function logs. Named above; the newest, `90da8604-…`, is now the
   largest single residual ever recorded (82.9s) and worth prioritizing if
   only one can be traced first.
2. **Watch for a third `deferred: false` occurrence** — now two, with
   different shapes (`rounds: []` vs. four recorded core rounds plus an
   89.5s span). A third would make this a real trend rather than two
   isolated incidents, and the two different shapes suggest more than one
   mechanism could be at play.
3. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
4. Question 4 (is the bonus worth its cost) — unresolved, and the growing
   outlier share (now 28%) makes it harder to answer with a single number.

### 2026-09-29 (diagnosis-review) — three new built rows, one normal, two more join the outlier cluster (now 13 of 42, 31%); median saving flat at 14,311.5ms; still zero races; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**`DailyBuildMetric` totals:** `built=43` (1 baseline + 42 post-deferral, up
from 40/39 at the last review), `carry_forward=530`, `existing_queue=61`,
`partial_carry_forward=5`. **`outcome='lost_persist_race'` is still 0
rows**, cumulative, all time — no change from every prior reading.

**Three new post-deferral rows since the last review, all from the
2026-09-28 17:05 UTC cron window:**

| build_id | started_at | span_ms | user_visible_ms | saved | bonus (`generationMs`) | residual |
|---|---|---:|---:|---:|---:|---:|
| `322ada51-…` | 17:05:18.812Z | 89,345 | 80,035 | 9,310 | 8,022 | 1,288 — normal band |
| `05589486-…` | 17:05:18.875Z | 82,317 | 21,020 | 61,297 | 722 | **60,575 — outlier-class** |
| `459c10fc-…` | 17:05:19.335Z | 81,924 | 27,083 | 54,841 | 732 | **54,109 — outlier-class** |

**Two of the three are new outliers, both the small-bonus/huge-residual
shape** (722ms and 732ms of bonus generation paired with 60.6s and 54.1s of
unexplained residual) — the same pattern as `84e717bd-…`, `87e51589-…`,
`4f9efefa-…`, `76790f46-…`, `87cf2e9a-…`, and the prior review's all-time-high
`90da8604-…` (82.9s, still the record — neither of today's two beats it).
**This raises the outlier/elevated count from 11 of 39 to 13 of 42 (31%)** —
continuing the same successive-review growth this doc has tracked
(3→5→6→8→9→11→13), now practically a third of all post-deferral rows. Not
traced this pass — still needs Vercel function logs this session doesn't
have. Full named outlier set now includes today's `05589486-…` and
`459c10fc-…` alongside every prior entry's named set.

**No third `deferred: false` occurrence** — all three new rows show
`deferred: true`. The two named `deferred: false` rows (`4206ffb0-…`
09-26, `9c0361e9-…` 09-27) remain the only two on record.

**Phase 3a (mechanism) holds** on all three new rows: `saved ≥` each row's
own bonus `generationMs`.

**3b population: median saving 14,311.5ms** (n=42, unchanged from n=39 at
the last review) — computed via `percentile_cont(0.5)` over all post-deferral
rows. The one normal-band row and two extreme outliers landed such that the
median itself didn't move even though the outlier cluster grew again.

**No code change since the last review:** `git log` confirms zero commits
landed on `main` at all since the 2026-09-28 diagnosis-review commit (which
is also `HEAD`), so `queue-orchestrator.ts`, `daily.ts`, and
`build-context.ts` are byte-identical to the last review.

**No decision-resolving change.** Status stays `active`. The outlier-trace
next step is more urgent still (3→5→6→8→9→11→13 occurrences across
successive reviews, now practically a third of all post-deferral rows), but
still needs Vercel access this session doesn't have. Question 4 (is the
bonus worth its cost) remains open and unresolved.

### Next steps (unchanged)
1. **Trace the now-thirteen outsized/elevated-residual builds** — needs
   Vercel function logs. The all-time-high residual remains `90da8604-…`
   (82.9s, 2026-09-27); today's two new outliers (60.6s, 54.1s) don't beat
   it but keep the cluster growing.
2. Watch for a third `deferred: false` occurrence — still only two on
   record, unchanged this reading.
3. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
4. Question 4 (is the bonus worth its cost) — unresolved, and the growing
   outlier share (now 31%) makes it harder to answer with a single number.

### 2026-09-30 (diagnosis-review) — four new built rows, two more join the outlier cluster (now 15 of 46, 33%); median saving up to 14,812.5ms; still zero races, no `deferred: false` repeat; no new code touching the tracked persist-race path

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**`DailyBuildMetric` totals:** `built=47` (1 baseline + 46 post-deferral, up
from 43/42 at the last review), `carry_forward=552`, `existing_queue=65`,
`partial_carry_forward=5`. **`outcome='lost_persist_race'` is still 0
rows**, cumulative, all time — no change from every prior reading.

**Four new post-deferral rows since the last review, three from the
2026-09-29 17:05 UTC cron window and one later same-day build:**

| build_id | started_at | deferred | span_ms | user_visible_ms | saved | bonus (`generationMs`) | residual |
|---|---|---|---:|---:|---:|---:|---:|
| `60ca59e1-…` | 17:05:14.200Z | true | 60,150 | 30,044 | 30,106 | 954 | **29,152 — outlier-class** |
| `767afbe7-…` | 17:05:16.639Z | true | 57,585 | 32,073 | 25,512 | 766 | **24,746 — outlier-class** |
| `93408f6e-…` | 17:05:22.119Z | true | 69,748 | 49,747 | 20,001 | 18,769 | 1,232 — normal band (this build's own bonus round ran long, ~18.8s, which is most of the saving) |
| `7755ab01-…` | 21:18:27.915Z | true | 42,377 | 40,818 | 1,559 | 828 | 731 — normal band |

**Two of the four are new outliers, both the same small-bonus/huge-residual
shape** this doc has tracked since 2026-09-09 — this raises the
outlier/elevated count from 13 of 39 (last full count, 2026-09-29 morning)
to **15 of 46 (33%)**, continuing the same successive-review growth
(3→5→6→8→9→11→13→15). Not traced this pass — still needs Vercel function
logs this session doesn't have. `93408f6e-…` is a useful negative case: its
saving (20,001ms) is large but almost entirely explained by an unusually
long bonus generation round itself (18,769ms), not by unexplained residual —
Phase 3a's mechanism check holds on it cleanly, unlike the outlier rows.

**No third `deferred: false` occurrence** — all four new rows show
`deferred: true`. The two named `deferred: false` rows (`4206ffb0-…`
09-26, `9c0361e9-…` 09-27) remain the only two on record.

**Phase 3a (mechanism) holds** on all four new rows: `saved ≥` each row's
own bonus `generationMs`.

**3b population: median saving 14,812.5ms** (n=46, up from 14,311.5ms at
n=42) — the largest median reading yet, driven by the two new outliers
pulling the distribution upward even though the cluster's overall share
(33%) is only modestly higher than last review's 31%.

**No code change since the last review:** `git log --since=2026-09-29` on
`queue-orchestrator.ts`, `daily.ts`, and `build-context.ts` returns nothing.
Three commits landed on `main` since the last review (`#1731` activity
wording fix, `#1732` QA findings + Sonnet 5.5 support, `#1733` mastery
finest-area credit fix) — confirmed by diffing each commit's file list
directly, none touch this doc's three tracked files.

**No decision-resolving change.** Status stays `active`. The outlier-trace
next step is more urgent still (3→5→6→8→9→11→13→15 occurrences across
successive reviews, now a third of all post-deferral rows), but still needs
Vercel access this session doesn't have. Question 4 (is the bonus worth its
cost) remains open and unresolved.

### Next steps (unchanged)
1. **Trace the now-fifteen outsized/elevated-residual builds** — needs
   Vercel function logs. The all-time-high residual remains `90da8604-…`
   (82.9s, 2026-09-27); today's two new outliers (29.2s, 24.7s) don't beat
   it but keep the cluster growing.
2. Watch for a third `deferred: false` occurrence — still only two on
   record, unchanged this reading.
3. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
4. Question 4 (is the bonus worth its cost) — unresolved, and the growing
   outlier share (now 33%) makes it harder to answer with a single number.

### 2026-10-01 (diagnosis-review) — PR #1734 changes the tracked persist conflict mechanism, additively not a reversion; four new built rows, one joins the outlier cluster (16 of 50, 32%); median saving flat; still zero races

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**`DailyBuildMetric` totals:** `built=51` (1 baseline + 50 post-deferral, up
from 47/46 at the last review), `carry_forward=574`, `existing_queue=65`,
`partial_carry_forward=5`. **`outcome='lost_persist_race'` is still 0
rows**, cumulative, all time — no change from every prior reading.

**Four new post-deferral rows since the last review, all from the
2026-09-30 17:05 UTC cron window:**

| build_id | deferred | span_ms | user_visible_ms | saved | bonus (`generationMs`) | residual |
|---|---|---:|---:|---:|---:|---:|
| `ec84abbe-…` | true | 45,889 | 38,562 | 7,327 | 776 | 6,551 — between bands, not classified either way |
| `8e98f96e-…` | true | 56,915 | 25,312 | 31,603 | 17,726 | 13,877 — large bonus itself, not the small-bonus shape; closer to `93408f6e-…`'s "negative case" pattern |
| `a10db236-…` | true | 38,112 | 15,518 | 22,594 | 784 | **21,810 — outlier-class, the established small-bonus/huge-residual shape** |
| `d524b774-…` | true | 37,302 | 35,337 | 1,965 | 1,118 | 847 — normal band |

**One of the four is a clean new outlier** (`a10db236-…`): 784ms of bonus
generation paired with 21,810ms of unexplained residual, the same shape as
every prior outlier in this cluster. **This raises the outlier/elevated
count from 15 of 46 to 16 of 50 (32%)** — the share is essentially flat
versus last review's 33% even though the raw count grew, since three of the
four new rows don't fit the pattern. `8e98f96e-…` is a borderline case
worth naming precisely rather than folding in either direction: its
residual (13,877ms) sits inside the historical outlier range, but unlike
every named outlier its bonus `generationMs` (17,726ms) is itself large, not
small — the same shape `93408f6e-…` showed on 2026-09-30's prior entry
(`saving is large but almost entirely explained by an unusually long bonus
round itself`). Not adding it to the named outlier set. Full outlier set
unchanged from last review plus today's `a10db236-…`.

**No third `deferred: false` occurrence** — all four new rows show
`deferred: true`. The two named `deferred: false` rows (`4206ffb0-…`
09-26, `9c0361e9-…` 09-27) remain the only two on record.

**Phase 3a (mechanism) holds** on all four new rows: `saved ≥` each row's
own bonus `generationMs`.

**3b population: median saving 14,812.5ms** (n=50, same value as last
review's n=46) — the new rows split around the existing distribution
without moving the median at all.

**Significant code change to this doc's own tracked mechanism, read by
diff, not title: `#1734`** ("fix(daily): unfriend/block no longer wipes a
round; empty rounds get rebuilt"), merged 2026-09-30T06:47:49-04:00. This
touches `persistDailyQueue` directly — the exact function open question 5's
fix lives in — but is an **additive fix for a different, adjacent bug, not
a reversion of the persist-race fix**. What changed:

- `persistDailyQueue`'s conflict strategy moved from `onConflictDoNothing`
  to `onConflictDoUpdate` with a `setWhere: jsonb_array_length(slots) = 0`
  fence. Read directly: a conflict against an **already-populated** row
  still produces an empty `RETURNING` and `won: false`, exactly as before —
  the invariant this doc's open question 5 cares about (a losing build can
  never overwrite a served queue) is explicitly preserved, and the updated
  `persist-daily-queue-race.test.ts` now asserts the fenced `doUpdate` shape
  rather than the old `doNothing` shape, so the regression guard moved with
  the code rather than going stale.
- The bug this targets is different: a build that lost the race to an
  **empty** row (`slots: []`) used to conflict and discard its own real
  slots exactly like a populated row did (QA 2026-09-29, C1) — stranding the
  player on "not ready yet" for the whole day, since the orchestrator and
  `GET /api/daily/queue` both treat an empty row as "no queue." The new
  `setWhere` lets a build's insert overwrite only that specific empty-row
  case. New coverage: `empty-round-recovery.pg.test.ts` (a new real-Postgres
  test) and a new `daily-empty-round.yml` CI workflow. A related fix in the
  same PR, `drop-severed-bonus.ts`, fixes a NULL-handling bug in the
  unfriend/block slot-removal predicate that was deleting every unanswered
  CORE slot (not just severed bonus ones) — unrelated to the persist-race
  mechanism but explains the PR's "unfriend/block no longer wipes a round"
  half.
- `scripts/build-latency-anomaly.verify.ts` itself was **not** touched by
  this PR.

**Not run this pass** (writes to the database, not a casual status check
per this doc's own §7 convention — only run on demand before merging a
change that touches this exact contract): `npm run
verify:build-latency-anomaly`'s Scenario A/B should be re-run against the
new `onConflictDoUpdate` strategy to directly confirm the winner's
populated queue is still untouchable, rather than relying on the test-file
diff alone. Flagging as the leading new item rather than running a
write-capable script from a reconnaissance pass.

**No other code change since the last review:** `git log --since=2026-09-29`
on `queue-orchestrator.ts`, `daily.ts`, and `build-context.ts` shows only
`#1734` (above). Two other commits landed on `main` since the last review
(`#1735` font self-hosting, `#1736` knowledge-map/profile polish) — neither
touches any of this doc's three tracked files.

**No decision-resolving change.** Status stays `active`. The outlier-trace
next step is unchanged (still needs Vercel access this session doesn't
have). Question 4 (is the bonus worth its cost) remains open and
unresolved. The new item is confirming Scenario A/B against `#1734`'s
updated conflict strategy, not a change to any of the four enumerated open
questions.

### Next steps (revised)
1. **New:** re-run `npm run verify:build-latency-anomaly` to confirm
   Scenario A/B still pass against `#1734`'s `onConflictDoUpdate` +
   `setWhere` conflict strategy — the test-file diff strongly suggests they
   will, but this doc's own §7 convention is to verify on demand rather than
   infer from a diff alone.
2. **Trace the now-sixteen outsized/elevated-residual builds** — needs
   Vercel function logs. The all-time-high residual remains `90da8604-…`
   (82.9s, 2026-09-27).
3. Watch for a third `deferred: false` occurrence — still only two on
   record, unchanged this reading.
4. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
5. Question 4 (is the bonus worth its cost) — unresolved.

### 2026-10-02 (diagnosis-review) — six new built rows; three new outliers including the 4th-largest residual on record; `#1738`/`#1739` touch tracked files but not `persistDailyQueue`; verify-script re-run still not done

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same
as yesterday. `node_modules` installed cleanly this session, but
`DATABASE_URL` is still absent, so `npm run check:build-latency` and `npm
run verify:build-latency-anomaly` can't run directly here — the read-only
half was reproduced by hand against the same `DailyBuildMetric` table
(fetched all `outcome='built'` rows with `deferred IS NOT NULL`, computed
`saved`/`bonus`/`residual` with the exact same formula as
`scripts/build-latency-check.mjs`'s `bonusCostMs`, verified the n=50 median
reproduces last review's 14,812.5ms exactly before trusting the new
number). `verify:build-latency-anomaly` is write-capable and stays unrun
per this doc's own §7 convention.

**`DailyBuildMetric` totals:** `built=57` (1 baseline + 56 post-deferral, up
from 51/50), `carry_forward=596`, `existing_queue=68`, `partial_carry_forward=5`.
**`outcome='lost_persist_race'` is still 0 rows**, cumulative, all time.

**Six new post-deferral rows since the last review** — four from the
2026-10-01 17:05 UTC cron, two from an ad-hoc 2026-10-02 00:09/00:10 UTC
build (same user, back-to-back):

| build_id | deferred | span_ms | user_visible_ms | saved | bonus | residual |
|---|---|---:|---:|---:|---:|---:|
| `60cd9c31-…` | true | 64,091 | 37,406 | 26,685 | 866 | **25,819 — outlier-class** |
| `00bc82e4-…` | true | 59,049 | 12,554 | 46,495 | 872 | **45,623 — outlier-class, 4th-largest on record** |
| `4332883f-…` | true | 76,749 | 53,768 | 22,981 | 21,345 | 1,636 — large-bonus-itself shape, not an outlier |
| `9f217fa4-…` | true | 54,791 | 26,698 | 28,093 | 741 | **27,352 — outlier-class** |
| `b32cc3ac-…` | true | 44,441 | 43,189 | 1,252 | 547 | 705 — normal band |
| `6cf8fc8e-…` | true | 18,199 | 16,882 | 1,317 | 545 | 772 — normal band |

**Three of six are clean new outliers** (`60cd9c31-…`, `00bc82e4-…`,
`9f217fa4-…`), all the established small-bonus/huge-residual shape.
`00bc82e4-…`'s 45,623ms residual is the **4th-largest ever recorded**,
behind only `90da8604-…` (82,878ms, 2026-09-27), `05589486-…` (60,575ms,
2026-09-28), and `459c10fc-…` (54,109ms, 2026-09-28) — ranked by
recomputing residuals across all 54 `deferred: true` rows, not estimated.
The all-time high is unchanged. `4332883f-…` repeats the "large bonus
itself, not a small-bonus/huge-residual case" shape seen in `8e98f96e-…`
(09-30) and `93408f6e-…` (09-29) — correctly not added to the named
outlier set. The two ad-hoc 2026-10-02 rows are both normal band.

**This raises the outlier/elevated count from 16 of 50 (32%) to 19 of 56
(34%)** — consistent with the established ~⅓ share, not a new trend.

**No third `deferred: false` occurrence** — all six new rows show
`deferred: true`. The two named `deferred: false` rows (`4206ffb0-…`
09-26, `9c0361e9-…` 09-27) remain the only two on record.

**Phase 3a (mechanism) holds** on all six new rows: `saved ≥` each row's
own bonus-phase `generationMs`, including the closest margin yet
(`4332883f-…`: 22,981 ≥ 21,345).

**3b population: median saving 15,420.5ms** (n=56, up from 14,812.5ms at
n=50) — reproduced the n=50 figure exactly before trusting this, per the
environment note above.

**Two commits touch this doc's tracked files since yesterday, neither
touches `persistDailyQueue` or the race mechanism** — confirmed by reading
both diffs directly, not by title:
- `#1739` ("newly added topics get a welcome slot; at most one house pick
  per Five") touches `queue-orchestrator.ts` — adds a house-pick cap
  (`DAILY_QUEUE_MAX_HOUSE_PICKS`) and a welcome-slot domain-selection path.
  Domain/slot selection, not the persist/conflict step.
- `#1738` ("don't serve a fact that's already waiting on the home feed")
  touches `db/queries/daily.ts` — adds a third source (`feedItems` waiting
  cards) to `getRecentFactKeys`'s de-dup set. `persistDailyQueue` itself
  (same file, line 1253) is untouched — confirmed `grep -c persistDailyQueue`
  on both diffs returns 0.
- `build-context.ts` unchanged. The other two commits since yesterday
  (`#1740`, `#1737`) don't touch any of this doc's three tracked files.

**Not run this pass** (write-capable, per this doc's own §7 convention):
`npm run verify:build-latency-anomaly`'s Scenario A/B re-run against
`#1734`'s conflict strategy — still outstanding from yesterday, now two
days unconfirmed. Carrying forward as the leading next step again.

**No decision-resolving change.** Status stays `active`. Question 4 (is the
bonus worth its cost) remains open and unresolved.

### Next steps (unchanged)
1. Re-run `npm run verify:build-latency-anomaly` to confirm Scenario A/B
   against `#1734`'s conflict strategy — now two reviews overdue.
2. **Trace the now-nineteen outsized/elevated-residual builds** — needs
   Vercel function logs. The all-time-high residual remains `90da8604-…`
   (82.9s, 2026-09-27); `00bc82e4-…` (45.6s, 2026-10-01) is now 4th.
3. Watch for a third `deferred: false` occurrence — still only two on
   record.
4. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
5. Question 4 (is the bonus worth its cost) — unresolved.

### 2026-10-03 (diagnosis-review) — four new built rows from the 2026-10-02 cron, two more outliers; two previously-tracked rows have vanished from the table entirely (same cascade-delete shape as the 2026-09-06 "Rue Prova" incident); `verify:build-latency-anomaly` now three reviews overdue

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.
`node_modules` installs cleanly but `DATABASE_URL` is still absent, so
`npm run check:build-latency` can't run directly — reproduced its exact
read-only computation by hand: pulled every `outcome='built'` row (all
columns needed: `span_ms`, `user_visible_ms`, `rounds`) via the Supabase
MCP connection and ran the identical `saved = span_ms - user_visible_ms`,
`bonus = Σ rounds[phase='bonus'].generationMs`, `residual = saved - bonus`
arithmetic in a disposable local script, same formula `build-latency-check.mjs`
uses. `verify:build-latency-anomaly` is write-capable and stays unrun per
this doc's own §7 convention — now overdue for a **third** consecutive
review.

**`DailyBuildMetric` totals:** `built=59` (1 pre-deferral baseline + 2
`deferred:false` + 56 `deferred:true`), `carry_forward=618`,
`existing_queue=68`, `partial_carry_forward=5`. **`outcome='lost_persist_race'`
is still 0 rows**, cumulative, all time.

**Four new rows, all from the 2026-10-02 17:05 UTC cron:**

| build_id | span_ms | user_visible_ms | saved | bonus | residual |
|---|---:|---:|---:|---:|---:|
| `60cd9c31-…`* | — | — | — | — | *(already counted last review)* |
| `dd795b32-…` | 55,225 | 26,921 | 28,304 | 875 | **27,429 — outlier-class** |
| `b6477f44-…` | 58,302 | 43,353 | 14,949 | 12,635 | 2,314 — large-bonus-itself shape, not an outlier |
| `0a04d863-…` | 47,445 | 22,196 | 25,249 | 1,026 | **24,223 — outlier-class** |
| `c552e482-…` | 30,052 | 22,874 | 7,178 | 6,341 | 837 — normal band, closest Phase-3a margin yet |

**Two of four are clean new outliers** (`dd795b32-…`, `0a04d863-…`), the
established small-bonus/huge-residual shape. `b6477f44-…` repeats the
"large bonus itself, not small-bonus/huge-residual" shape seen before
(`4332883f-…` 10-01, `8e98f96e-…` 09-30). `c552e482-…`'s margin
(7,178 ≥ 6,341, 837ms) is the tightest Phase-3a margin on record, edging out
`4332883f-…`'s 1,636ms from 2026-10-01 — Phase 3a (saved ≥ that row's own
bonus `generationMs`) still holds on every row, including this one.

**A data-integrity oddity, flagged rather than silently absorbed into the
numbers:** yesterday's review listed two ad-hoc 2026-10-02 00:09/00:10 UTC
rows (truncated ids `b32cc3ac-…`, `6cf8fc8e-…`, both normal-band, saved
1,252ms/1,317ms). **Neither exists in `DailyBuildMetric` any more** — a
direct `LIKE` search on both id prefixes returns zero rows. The dataset's
total `deferred:true` count is unchanged at 56 (same as yesterday) despite
four new arrivals, which arithmetically means at least two rows besides
these were also removed between reviews; only these two were specifically
confirmed missing, the rest not individually traced. This is the same
shape as the 2026-09-06 "Rue Prova" incident documented earlier in this
file: `DailyBuildMetric.user_id` cascades on account deletion, so a
disposable test account's builds can vanish from this doc's evidence base
without warning. Not investigated further this pass (reconnaissance only,
and the vanished rows were normal-band, not load-bearing for any open
question) — noting it so a future reviewer isn't confused by the
non-monotonic row count.

**3b population: median saving 16,704.5ms** (n=56, up from 15,420.5ms also
at n=56 — same count, different composition per the note above).

**Outlier/elevated count (residual ≥ 15,000ms): 19 of 56 (34%)** —
numerically unchanged from yesterday's reading, though two of today's new
rows are newly in the set (`dd795b32-…`, `0a04d863-…`), implying others
aged out with the vanished rows above. All-time high residual is still
`90da8604-…` (82,878ms, 2026-09-27); `00bc82e4-…` (45,623ms, 2026-10-01)
holds 4th place.

**No third `deferred: false` occurrence** — all four new rows show
`deferred: true`. The two named `deferred: false` rows (`4206ffb0-…`
09-26, `9c0361e9-…` 09-27) remain the only two on record.

**No commits touch this doc's tracked files since yesterday.** `#1741`
touches `src/server/db/queries/daily.ts` but only the catch-up/hidden-question
path — zero references to `persistDailyQueue` (confirmed by grep on the
diff). `#1742` touches `generate-questions.ts`, `domain-selection.ts`, and
`pool.ts` — none of this doc's three tracked files
(`queue-orchestrator.ts`, `db/queries/daily.ts`'s persist logic,
`build-context.ts`).

**No decision-resolving change.** Status stays `active`. Question 4 (is the
bonus worth its cost) remains open and unresolved.

### Next steps (unchanged)
1. Re-run `npm run verify:build-latency-anomaly` to confirm Scenario A/B
   against `#1734`'s conflict strategy — now **three** reviews overdue.
2. Trace the nineteen outsized/elevated-residual builds — needs Vercel
   function logs. All-time-high residual still `90da8604-…` (82.9s,
   2026-09-27); `00bc82e4-…` (45.6s, 2026-10-01) still 4th.
3. Watch for a third `deferred: false` occurrence — still only two on
   record.
4. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
5. Question 4 (is the bonus worth its cost) — unresolved.

### 2026-10-04 (diagnosis-review) — four new built rows from the 2026-10-03 cron, one new outlier; outlier share flat at ~⅓; `verify:build-latency-anomaly` now four reviews overdue; no code touches the persist mechanism

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.
`node_modules` installs cleanly but `DATABASE_URL` is still absent, so
`npm run check:build-latency` can't run directly — reproduced the exact
`saved`/`bonus`/`residual` computation in SQL (summing `rounds[phase=
'bonus'].generationMs` per row via `jsonb_array_elements`) directly against
`DailyBuildMetric`, same formula `build-latency-check.mjs` uses.
`verify:build-latency-anomaly` is write-capable and stays unrun per this
doc's own §7 convention — now overdue for a **fourth** consecutive review.

**`DailyBuildMetric` totals:** `built=63` (up from 59), `carry_forward=640`,
`existing_queue=68`, `partial_carry_forward=5`. **`outcome='lost_persist_race'`
is still 0 rows**, cumulative, all time.

**Four new rows, all from the 2026-10-03 17:05 UTC cron:**

| build_id | span_ms | user_visible_ms | saved | bonus | residual |
|---|---:|---:|---:|---:|---:|
| `8cbea7bf-…` | 59,538 | 45,138 | 14,400 | 8,793 | 5,607 — normal band |
| `34e4d4fb-…` | 53,070 | 51,380 | 1,690 | 796 | 894 — normal band |
| `affdcdd4-…` | 68,457 | 47,131 | 21,326 | 16,427 | 4,899 — large-bonus-itself shape, not an outlier |
| `5c406183-…` | 66,636 | 37,297 | 29,339 | 7,764 | **21,575 — outlier-class** |

**One of four is a clean new outlier** (`5c406183-…`): 7,764ms of bonus
generation paired with 21,575ms of unexplained residual, the established
small-bonus/huge-residual shape. `affdcdd4-…` repeats the "large bonus
itself, not small-bonus/huge-residual" shape seen repeatedly before
(`4332883f-…`, `8e98f96e-…`, `b6477f44-…`).

**Outlier/elevated count (residual ≥ 15,000ms), recomputed over the full
population, not estimated:** `n=60` (up from 56), **20 of 60 (33.3%)** —
essentially flat versus yesterday's 19/56 (34%).

**3b population: median saving 16,704.5ms** (n=60) — recomputed directly
via SQL over the full `deferred:true` population; the value is
byte-identical to yesterday's reading at n=56, a coincidence of where the
new rows land in the distribution, not a stale number (reproduced fresh,
not carried forward).

**No third `deferred: false` occurrence** — all four new rows show
`deferred: true`. The two named `deferred: false` rows (`4206ffb0-…`
09-26, `9c0361e9-…` 09-27) remain the only two on record.

**Phase 3a (mechanism) holds** on all four new rows: `saved ≥` each row's
own bonus `generationMs`.

**No commits touch this doc's tracked mechanism since yesterday.** The only
commits since the last review are `#1743`/`#1744` (bank-difficulty-
loosening work, new doc opened for it today) and two unrelated "Cassian"
pilot commits. Diffed `#1743`/`#1744` directly: `#1743` touches only
`pickBankSource`/`bankMissReasonFromCounts` in `src/server/db/queries/daily.ts`
— zero references to `persistDailyQueue` (grepped the diff). `#1744` adds
new `BankAttempt` fields and `bankLooseTierMaxPerBuild`/`bankLooseTiers` to
`build-context.ts` and `generate-questions.ts` — additive fields alongside
the existing ones, not a change to `persistDailyQueue`'s conflict strategy
or `queue-orchestrator.ts`'s race-check logic (also grepped, zero matches).

**No decision-resolving change.** Status stays `active`. Question 4 (is the
bonus worth its cost) remains open and unresolved.

### Next steps (unchanged)
1. Re-run `npm run verify:build-latency-anomaly` to confirm Scenario A/B
   against `#1734`'s conflict strategy — now **four** reviews overdue.
2. Trace the twenty outsized/elevated-residual builds — needs Vercel
   function logs. All-time-high residual still `90da8604-…` (82.9s,
   2026-09-27); `00bc82e4-…` (45.6s, 2026-10-01) still 4th.
3. Watch for a third `deferred: false` occurrence — still only two on
   record.
4. Watch for the first `outcome='lost_persist_race'` row — needs DB access.
5. Question 4 (is the bonus worth its cost) — unresolved.
