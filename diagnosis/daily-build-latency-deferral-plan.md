---
name: daily-build-latency-deferral-plan
status: active
opened: 2026-09-04
last-reviewed: 2026-09-06
owner: Josh
related-pr: "#1601"
---

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

### Phase 2 — first post-deferral row · **PENDING**

**Exit criterion**, all on one row:
- `deferred: true` — `after()` actually ran
- `span_ms` populated — the continuation completed
- `target_size = 5` — write-at-persist works
- `borrowed_domain_count` / `deferred_domain_count` sane
- bonus-phase `LlmUsageEvent` rows carry a **non-null `build_id`** — ALS crossed
  the boundary

Four unknowns, one read.

### Phase 3 — the subtraction · **PENDING**

**Exit criterion:** median `span_ms - user_visible_ms` over `outcome='built'`
rows. Judge against the ~7.6s pre-registration, not against ~15s.

Volume note: ~1 genuine build/day, so this accumulates slowly. Three or four
rows is a usable read; one is not.

### Phase 4 — decide whether more is warranted

**Exit criterion:** with the deferral's real saving known, decide open question
4 — whether the +2 bonus earns its generation spend at all — and whether any
further latency work is justified against the remaining core time.

## 5. Recommendation (as of 2026-09-06)

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
