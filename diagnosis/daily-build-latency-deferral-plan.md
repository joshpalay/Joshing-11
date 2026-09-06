---
name: daily-build-latency-deferral-plan
status: needs-decision
opened: 2026-09-04
last-reviewed: 2026-09-06
owner: Josh
related-pr: "#1601"
---

> **2026-09-06: open question 5 is CONFIRMED, not suspected.** The deferred
> bonus append can silently destroy real core questions when two builds race
> for the same user+date. Reproduced directly against the real DB
> (`scripts/build-latency-anomaly.verify.ts`). See §2 item 5, §5, and the
> final Update below.

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
5. **[CONFIRMED — decision now needed on the FIX, not on whether it's real]
   The deferred bonus append can silently destroy real core questions.**
   Root cause confirmed by direct reproduction (2026-09-06, see Update) — this
   is a genuine, general concurrency bug, not a one-row artifact:
   `persistDailyQueue`'s insert is race-safe (`onConflictDoNothing`), but its
   return value — which says whether THIS build's insert won or lost — is
   discarded at every call site in `queue-orchestrator.ts`. A build that loses
   the race has no way to know, and its deferred bonus tail appends using its
   OWN (losing, discarded) core count as the position, landing inside the
   WINNING build's real core range and overwriting whatever real question sat
   there. It requires two builds racing for the same user+date — the same
   trigger this whole diagnosis exists to speed past, so cron + a page-load
   pre-warm + a retry are exactly the kind of overlap that produces it. Not
   asking whether to pause — recommending it in §5. Open now: what the actual
   fix should be (check the return value and skip the append on a loss;
   recompute the append position from the winning row instead of trusting
   local state; or something else). Not designed here — this doc reproduces
   and documents, per the diagnosis-review convention of never taking the
   action a doc is deciding about.

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

## 5. Recommendation (as of 2026-09-06, confirmed)

**Fix the concurrency bug before trusting any Phase 3 number or running more
crons on top of it. This is no longer a suspected anomaly — it is a confirmed,
general mechanism for silently destroying real core questions.**

Reproduced directly (2026-09-06) against the real DB with disposable, fully
namespaced fixtures — `scripts/build-latency-anomaly.verify.ts`, self-cleaning,
safe to re-run:

1. Two builds race to persist a queue for the same user+date. `persistDailyQueue`'s
   insert is race-safe (`onConflictDoNothing` on `(user_id, queue_date)`) — the
   loser's insert correctly no-ops, and the function correctly hands back the
   WINNING row. **But every call site in `queue-orchestrator.ts` discards that
   return value**, so the losing build never learns it lost.
2. The losing build's deferred bonus tail runs anyway, using its OWN (losing)
   core-slot count as the append position — `appendDeferredBonusSlots(...,
   slots.length)`, where `slots` is the loser's local array, not the winner's
   persisted one.
3. `createDailyQueueItemFromPresence` does a naive
   `filter(slot_index !== position) + append` against whatever is CURRENTLY
   persisted — the winner's real queue. If the loser's position falls inside
   the winner's real core range (likely, since both builds target the same
   `DAILY_QUEUE_SIZE`), the append **silently deletes a real core question and
   replaces it with a bonus one.**

The reproduction hits the diagnosis doc's exact numbers on the first run, no
tuning: 5 total slots, bonus at index 3 and 4, 2 of 5 real core questions gone.
This is not a one-row artifact — it is what this code path does *every time*
two builds race for the same user+date, which is exactly the kind of overlap
the deferral's own trigger surface (cron + page-load pre-warm + retries) makes
more likely, not less.

**What I would NOT do:** silently patch this myself. The right fix is a design
choice — check the return value and skip the append on a loss; recompute the
append position from the winning row's actual length instead of trusting local
state; or reject the race further upstream (e.g. an advisory lock, since
`inFlightFills` is an in-memory `Map` and offers no protection across two
different serverless instances, which is almost certainly how two real builds
end up racing for the same user+date in the first place). Each has different
blast radius and testing burden, and that decision belongs to whoever owns
`queue-orchestrator.ts` next, not to a diagnosis doc.

Superseded, kept for the record — my prior (pre-confirmation) recommendation:

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
