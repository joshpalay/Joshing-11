---
name: question-lifecycle-quality-plan
status: active
opened: 2026-09-09
last-reviewed: 2026-10-07
owner: Josh
related-pr: "#1646, #1698, #1702, #1709, #1720"
---

# Diagnosis: question lifecycle quality and grading fairness

_Started 2026-09-09 · Owner: Josh · Working branch: `codex/post-game-welcome-tour`_

This is a living measurement track for the question-lifecycle changes made
after the 2026-09-09 audit. It records what the automated tests prove, what
production data can measure, and which decisions must wait for real evidence.

**To take a reading: `npm run check:question-lifecycle`.** It is read-only,
makes no model calls, and prints only aggregate counts and timings. It does not
print player answers, question text, stored answer text, or identity data.

The point-in-time audit and initial results remain in
[`../.reports/question-lifecycle-audit.md`](../.reports/question-lifecycle-audit.md)
and
[`../.reports/question-lifecycle-results.md`](../.reports/question-lifecycle-results.md).
This file should keep growing after those reports stop changing.

---

## 1. What triggered this

The audit followed questions from topic selection through generation, model
checks, storage, Daily Five selection, presentation, grading, rechecks, and
mastery updates. It found several confirmed risks:

- cosmetic answer cleanup erased meaningful symbols, so `C` could equal `C++`,
  `C major` could equal `C# major`, `5` could equal `-5`, and `1 5` could equal
  `1.5`;
- linked generated and canonical question copies could disagree;
- bank reuse dropped subject and embedding metadata;
- malformed model-check replies could look like clean passes;
- verification verdicts and trust tiers could disagree;
- retry layers could multiply grading calls;
- a stale Daily queue snapshot could overwrite a newer one;
- gate counters mixed player builds with maintenance work;
- Joshing-added onboarding topics could be described as friend-picked.

The fixes are covered by automated tests, but tests cannot show whether real
questions become more interesting, whether factual mistakes fall, or whether
players experience fairer grading. Those need repeated readings after release.

## 2. Open decisions

1. **Did the changes preserve the Daily Five?** Answer with short-build count,
   bank hit rate, build time, and failed model-check counts after release.
2. **Should `VERIFICATION_UNVERIFIABLE_HOLD_ENABLED` be enabled?** Answer only
   after the shadow `wouldFilter` count shows that holding those rows will not
   starve narrow topics.
3. **When should subject and sub-angle metadata become required?** Require it
   only after newly generated and newly copied rows reliably contain it.
4. **Did grading become fairer in real use?** Answer with reviewed disputes,
   accepted alternatives, grading reason codes, and a private labeled set. Raw
   dispute counts alone do not reveal the error rate.
5. **Did cost per usable and played question improve?** Current records measure
   model usage and builds, but do not yet connect every dollar to the final
   played slot. Decide whether that final link is worth adding after the scoped
   gate data is available.
6. **Are the old linked-copy differences intentional?** Review the 51-answer
   baseline separately. Do not bulk-copy one side over the other without human
   review.

## 3. What we know so far

### Initial production baseline

The following reading used aggregate, read-only queries. It was taken before
the new code was deployed.

| Signal | Baseline | What it means |
|---|---:|---|
| Daily builds in the trailing 14 days | 9 | Small sample; trend only |
| Builds below recorded target | 0 of 9 | The measured Daily Fives were complete |
| Player-visible build time | p50 25,243 ms; p95 53,820 ms; max 59,095 ms | Speed comparison point |
| Bank attempts | 65 hits; 33 misses | Reuse comparison point |
| Grading model calls | 91 | Volume comparison point |
| Grading model time | p50 1,014 ms; p95 1,424 ms | Speed comparison point |
| Estimated grading cost | about $0.125 total; $0.0014/call | Small compared with generation |
| Estimated generation cost | about $3.767 across 59 calls | Not yet cost per played question |
| Estimated quality-gate cost | about $2.0134 across 364 calls | Mixed with maintenance traffic |
| Recent generated rows | 194 | Trailing 14 days |
| Recent rows missing `subject_entity` | 162 of 194 | Too common to enforce immediately |
| Recent rows missing embedding | 162 of 194 | Similarity checks lose useful context |
| Recent `ok` rows still unverified | 4 | Trust promotion baseline |
| Recent `unverifiable` rows | 1 | Hold-policy shadow baseline |
| Live linked copies | 760 | Population checked for drift |
| Linked canonical-answer drift | 51 | Some may be intentional edits |
| Linked accepted-alternative drift | 1 | Should not grow after the fix |
| All-time grade disputes | 24 alternatives added; 36 rejected; 3 need human review | Too small for a stable accuracy rate |

### Offline grading baseline

`npm run eval:question-lifecycle` uses eight invented examples and makes no
model or database call. The old normalizer passed 4 of 8. The current
normalizer passes 8 of 8. This proves the four known symbol collisions are
fixed. It does not prove overall grading accuracy.

### Automated test map

| Area protected | Test or check | What a pass proves | What it cannot prove |
|---|---|---|---|
| Exact and alternative grading | `src/server/__tests__/grading-fail-toward-player.test.ts` | Exact answers and saved alternatives bypass the model; meaningful symbols do not collapse | Real synonym and alias accuracy |
| Grader retry ownership | `src/lib/llm.grading.test.ts` | One server request makes at most one grading model attempt and malformed replies stay unscored | Browser/network behavior in production |
| Daily answer concurrency | `src/app/api/daily/answer/__tests__/route.test.ts` | A stale slot snapshot returns `slot_changed` and does not write mastery | Frequency of real conflicts |
| Generated JSON contract | `src/server/daily/__tests__/generated-question-contract.test.ts` | Missing fact keys and unsupported shapes are rejected; optional metadata does not starve supply | Model output quality in the wild |
| Bank-copy preservation | `src/server/daily/__tests__/bank-pick-field-preservation.test.ts` | Subject, embedding, trust, and alternatives survive reuse | Quality of the stored metadata |
| Ask-to-answer state | `src/server/daily/__tests__/ask-to-answer.test.ts` | Completed, skipped, unavailable, and invalid checks stay distinguishable | Accuracy of a valid model verdict |
| Verification serving policy | `src/server/daily/__tests__/verification-gating.test.ts` | The unverifiable hold is measured while off and filters when enabled | Whether supply is large enough to enable it |
| Honest topic source | `src/app/onboarding/__tests__/OnboardingFlow.test.tsx` | Catalog topics display “From Joshing” in mixed and catalog-only lists | Whether players understand the label |
| Whole application | `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` | The implementation fits the existing application and type contracts | Product quality after release |
| Repeatable aggregate reading | `npm run check:question-lifecycle` | The same safe database measures can be compared over time | Interestingness, ambiguity, or unreported unfair grades |
| Existing gate rollout | `npm run check:gate-flags` | Answer-leak, domain-drift, and quality gate counts are visible | Clean player-only rates until migration 0145 is deployed |

Initial implementation verification: 703 test files passed and 6 skipped;
5,455 tests passed and 72 skipped; type checking passed; lint passed with zero
errors and five unrelated existing warnings; the production build passed.

### Measures that remain missing

- There is no large human-labeled set for factual accuracy, ambiguity,
  interestingness, or grading false positives and false negatives.
- `reason_code` is safe application-log data, but its distribution is not yet a
  database metric.
- Queue compare-and-set conflicts are logged, but no durable counter measures
  their rate.
- Cost per played question is not directly recorded.
- The linked-copy check shows total drift. It cannot by itself tell whether an
  old difference was deliberate or which write path created a new difference.

These gaps should be filled only when the decision needs them. Adding counters
that nobody will use would create more data without creating knowledge.

## 4. Plan

### Phase 0 — preserve a baseline and repeatable checks · **DONE**

Keep the audit, results report, offline eight-case comparison,
`check:question-lifecycle`, and this diagnosis track.

**Exit criterion:** another person can run the two commands and reproduce the
same kinds of results without seeing private data or spending model money.
**Met on 2026-09-09.**

### Phase 1 — deploy safely and take a 24-hour health reading

Apply migration `0145_gate_drop_scope` with the release. Confirm the application
starts, Daily Fives still reach target size, malformed checks are visible, and
queue conflicts are rare.

**Exit criterion:** no new short builds caused by the contract checks; no
sustained grading outage; and `GateDropStat.scope` is present so maintenance is
excluded from player-build gate totals.

### Phase 2 — compare seven days before and after

Run `npm run check:question-lifecycle` and compare bank hit rate, build p50/p95,
grading calls and time, dispute status, missing metadata on new rows, verification
state, and linked-copy drift. Run `npm run check:gate-flags` for the existing
answer-leak and domain-drift rollout.

**Exit criterion:** all measured Daily Fives reach target; no material speed or
model-call regression appears; new bank copies retain metadata; accepted-
alternative drift does not increase; and invalid check replies are visible.

### Phase 3 — make the verification-hold decision after 14 days

Use shadow `wouldFilter` logs together with eligible stock and short-build
counts. Review the one-row baseline for later `unverifiable` verdicts and every
new occurrence before changing the flag.

**Exit criterion:** Josh has enough evidence to explicitly enable or leave off
`VERIFICATION_UNVERIFIABLE_HOLD_ENABLED`. A zero count is evidence that the rule
is rarely needed, not proof that enabling it is safe for every narrow topic.

### Phase 4 — build a human quality set before claiming product improvement

Create a private, approved set from staff-reviewed questions and resolved
disputes. Label factual correctness, one-answer clarity, topic fit,
interestingness, accepted equivalents, false accepts, and false rejects. Do not
put production question or player-answer text in committed fixtures.

**Exit criterion:** the old and new paths are scored against the same labeled
examples. Claim a quality gain only when that comparison improves without a
material cost, speed, or Daily Five completion regression.

### Phase 5 — close or add the remaining measurement gaps

Add durable reason-code, queue-conflict, or played-question cost counters only
if Phases 1–4 show that logs and existing events cannot answer an open decision.

**Exit criterion:** each new counter names the decision it supports, its privacy
limits, and the condition under which collection can stop.

## 5. Recommendation (as of 2026-09-09)

Ship the code and migration together, then use the 24-hour, 7-day, and 14-day
readings above. Keep the unverifiable hold off. Keep subject and sub-angle
metadata optional. The present baseline shows that enforcing either rule now
could reduce question supply.

Treat the 8-of-8 offline result as a narrow correctness proof. Do not describe
question quality, factual accuracy, or overall grading fairness as improved
until the same real examples have been independently labeled and compared.

---

## Updates

### 2026-09-09

Opened this track after the full question-lifecycle audit and approved
implementation. Added a read-only aggregate diagnostic and an offline grading
comparison. Recorded the initial database baseline and the complete test-to-
metric map above. No production data was changed and no live model comparison
was run.

### 2026-09-12 (diagnosis-review) — Phase 0/1 code merged as #1646; readings still unavailable this session

**Environment note:** this session has no `.env`/`.env.local` (no
`DATABASE_URL`, no `ANTHROPIC_API_KEY`) and no connected Supabase project via
the MCP tool, so `npm run check:question-lifecycle` and
`npm run check:gate-flags` could not be run, and no aggregate counter could
be re-read. Everything below is from git/GitHub only.

What git/GitHub confirm:
- **PR #1646, "Improve question quality, grading fairness, and lifecycle
  tracking," merged to `main` 2026-09-10T10:23:28Z** — this is the
  implementation this doc was opened to track (its description matches this
  file almost verbatim, including migration `0145_gate_drop_scope` and
  `check:question-lifecycle`). Recorded in this file's `related-pr`
  frontmatter now, since it wasn't captured when the doc was opened one day
  before the PR merged.
- This doc's own header names the working branch as
  `codex/post-game-welcome-tour`; the PR that actually shipped this work has
  head ref `codex/question-lifecycle-quality`. `post-game-welcome-tour` is a
  different change (migration `0144`) — the header's branch name looks like
  a copy-paste slip from adjacent work. Not correcting the header text
  itself (not rewriting history above the Updates log), just flagging it
  here so a future reader isn't sent to the wrong branch.
- Migration `0145_gate_drop_scope.sql` is present and correctly journaled
  (`drizzle/meta/_journal.json` idx 145, `when` value in sequence after
  0144) — confirmed by reading the journal directly, not by trusting the PR
  description.
- No commits since `#1646` touch `verification-gating.ts`,
  `check-question-lifecycle`, or the answer-normalizer paths named in this
  doc's test map.

**Phase 1's exit criteria (no new short builds, no sustained grading outage,
`GateDropStat.scope` present and excluding maintenance traffic) cannot be
checked from here** — that needs the live DB reading this session doesn't
have. Status stays `active`; nothing here resolves an open decision.

### Next steps
1. Run `npm run check:question-lifecycle` and `npm run check:gate-flags` for
   the Phase 1/2 readings once a session with `DATABASE_URL` access is
   available.
2. Everything else (Phase 2 comparison, Phase 3 verification-hold decision,
   Phase 4 labeled set) unchanged.

### 2026-09-14 (diagnosis-review) — no change; still no DB access this session

**Environment note:** no `.env`/`.env.local` present (`ls .env*` shows only
`.env.example`) and `mcp__Supabase__list_projects` returns zero projects, so
neither `npm run check:question-lifecycle` nor `npm run check:gate-flags`
could be run, same constraint as the last review.

What git can confirm instead:
- `git log --since=2026-09-12 -- src/server/daily/__tests__/verification-gating.test.ts
  scripts/check-question-lifecycle.mjs` — **zero commits.** No code touching
  the unverifiable-hold path, the answer-normalizer, or the lifecycle
  checker has landed since the last review.
- `git log --all --grep=revert --since=2026-09-05` — no revert of `#1646`;
  it remains in `main`'s ancestry (fast-forwarded only this session), so the
  prior direct-API "MERGED 2026-09-10T10:23:28Z" confirmation still holds.
- Nine commits landed on `main` since the last review (#1670–#1683); none
  touch this doc's tracked paths — spot-checked file lists directly.

**Phase 1's exit criteria still cannot be checked from here.** Status stays
`active`; nothing here resolves an open decision.

### Next steps (unchanged)
1. Run `npm run check:question-lifecycle` and `npm run check:gate-flags` for
   the Phase 1/2 readings once a session with `DATABASE_URL` access is
   available.
2. Everything else (Phase 2 comparison, Phase 3 verification-hold decision,
   Phase 4 labeled set) unchanged.

### 2026-09-15 (diagnosis-review) — first real reading since this doc opened; Phase 1 exit criteria now confirmed MET; Phase 2 mostly clean with one ambiguous speed signal

**Environment note:** this session has a live, read-only Supabase MCP
connection to the production project (`grixooyecvnugpxvcbct`) — the first
DB access this doc has had since it opened on 2026-09-09 (both prior
reviews, 2026-09-12 and 2026-09-14, had none). Replicated
`scripts/check-question-lifecycle.mjs`'s exact queries by hand (script
itself needs `DATABASE_URL`, which still isn't in this session's `.env`)
against a trailing-14-day window, so every number below is directly
comparable to the §3 baseline table.

| Signal | Baseline (pre-deploy) | Now (trailing 14d) | Read |
|---|---:|---:|---|
| Daily builds | 9 | 16 | more volume, ordinary growth |
| Builds below target | 0 of 9 | **0 of 16** | still complete |
| Visible build p50 / p95 / max | 25,243 / 53,820 / 59,095 ms | **33,119 / 53,100 / 59,095 ms** | p50 up ~31% — see caveat below |
| Bank hits / misses | 65 / 33 (66.3%) | **84 / 90 (48.3%)** | hit rate down ~18pts |
| Grading calls | 91 | 87 | flat |
| Grading time p50 / p95 | 1,014 / 1,424 ms | 1,014 / 1,435 ms | flat — no outage |
| Recent generated rows | 194 | 164 | — |
| Missing `subject_entity` | 162/194 (83.5%) | **93/164 (56.7%)** | improved |
| Missing embedding | 162/194 (83.5%) | **97/164 (59.1%)** | improved |
| `ok` rows still unverified | 4 | 4 | flat |
| `unverifiable` (14d) | 1 | 0 | — |
| Linked copies | 760 | 791 | population grew, expected |
| Canonical-answer drift | 51 | **51 — unchanged** | zero new drift since the fix |
| Accepted-alternative drift | 1 | **1 — unchanged** | meets "should not grow" exactly |

**`GateDropStat.scope` confirmed present and functional** — queried the
column directly (exists) and pulled the scoped breakdown
(`scope='daily_build'`, trailing 14 days): `quality` gate 26/70 dropped
(37.1%, within the acceptable band), plus a much richer per-gate view than
this doc has ever had (`answer_cooldown`, `answer_leak`, `factual`,
`subject_cooldown`, `intra_batch_embedding`, `bank_pick_quality`,
`thin_declared`, `answered_history_embedding`, `recent_history`,
`batch_dedup`, and the per-defect `quality:*` breakdown — all newly
visible now that maintenance traffic is scoped out). **Two gates show
nonzero `failed_open` that no diagnosis doc has tracked before:
`batch_dedup` (7 of 70) and `recent_history` (1 of 70).** Not investigated
further this pass — flagging for awareness since a failing-open dedup/
history check could theoretically let a near-duplicate or recently-served
question through silently, but this is new territory, not something this
doc's open decisions currently cover.

**Phase 1's three exit criteria are now all directly verifiable, and all
three pass:** no short builds (0 of 16), no sustained grading outage (calls
and timing flat), and `GateDropStat.scope` is present and excluding
maintenance from player-build totals (confirmed above). This is the first
time any session has been able to check Phase 1 since the doc opened.

**Phase 2's five exit criteria: 4 clearly pass, 1 is ambiguous.** Target
reached (PASS), no model-call regression (PASS, flat), new bank copies
retain metadata better than before (PASS — missing-subject/embedding rates
dropped ~27 points each), accepted-alternative drift flat at 1 (PASS,
exact). The ambiguous one: **visible build p50 rose ~31% (25.2s → 33.1s)**,
which reads like it could be a "material speed regression" — but this is
very likely explained by the *same* two outlier builds the
`daily-build-latency-deferral-plan.md` review (also run today) found
independently: two of the 16 builds in this window show 20-40x the normal
bonus-phase residual (23.7s and 37.5s of unexplained time), which alone
would drag a 16-row p50 upward. Not claiming that's the full explanation —
just flagging that this doc's speed metric and that doc's anomaly are very
likely the same underlying builds, so whoever chases the outlier builds
should check both docs' numbers move together once it's understood.

**Bank hit-rate drop (66.3% → 48.3%) is plausibly explained by a documented,
intentional change**, not a regression: `question-drift-r1-r2-tracking.md`'s
R8 (shipped 2026-09-11) started writing real `empirical_correct_rate` /
`n_answered` counters for the first time, which activated
`rankAndFilterBankCandidates`'s existing dud-exclusion rule
(`empirical_correct_rate = 0` with `n_answered ≥ 5`) — previously inert
because the inputs were always null. A lower bank hit rate is the expected,
documented side effect of that rule finally having real data to act on, not
a new problem. Cross-referencing rather than re-deriving since that doc's
own 2026-09-11 entry already predicted this.

**Decision 2 (verification hold) and decision 5 (cost-per-played-question)**
still have no new data — the shadow `wouldFilter` count and per-question
cost link aren't stored anywhere this query can reach. **Decision 3
(require subject/sub-angle metadata)**: coverage improved substantially
(83.5%→~58% missing) but "reliably contain it" is still a stretch at
roughly half the rows lacking it — not yet resolvable. **Decision 4**
(fairer grading) still needs Phase 4's labeled set, not started.

**No decision-resolving change to §2.** Status stays `active` — Phase 1
passing is a phase-gate, not one of the six enumerated open decisions, and
the one ambiguous Phase 2 signal (build speed) needs the cross-doc anomaly
understood before it can be read either way.

### Next steps (revised)
1. Once the two outlier builds are traced (see
   `daily-build-latency-deferral-plan.md`'s 2026-09-15 entry), re-check
   whether this doc's build-time p50 recovers — that would settle the one
   ambiguous Phase 2 criterion.
2. Worth a look, new: `batch_dedup` (7/70) and `recent_history` (1/70)
   `failed_open` counts — not previously tracked by any diagnosis doc.
3. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-16 (diagnosis-review) — `batch_dedup` `failed_open` ticked up; the cross-doc build-speed outlier count grew to three; no decision moved

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
2026-09-15.

**`batch_dedup` / `recent_history` `failed_open`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 96 | 7 | 1 |
| `batch_dedup` | 96 | 1 | **9** |
| `quality` | 96 | 37 (38.5%) | 0 |

`batch_dedup`'s `failed_open` rose from 7 to 9 over one day; `recent_history`
unchanged at 1. Both remain small in absolute terms and neither has been
investigated for root cause — same "flagging for awareness, not yet this
doc's open decision" posture as the 2026-09-15 entry. `quality`'s scoped
drop rate (38.5%) stays inside the acceptable band, consistent with the
question-drift doc's own reading of the same shared gate today.

**The build-speed cross-reference now has a third data point.**
`daily-build-latency-deferral-plan.md`'s review today (also run this
session) found a **third** large-residual build on 2026-09-15
(`cff84520-…`, 13,077ms residual), in addition to the two named on
2026-09-15 (`84e717bd-…`, `87e51589-…`). This doc's own ambiguous Phase 2
speed signal (build p50 up ~31%) was attributed to those first two outliers
dragging a 16-row sample; with a third now on record and none yet traced
to a root cause, the same caveat applies with slightly more supporting
evidence, not less. Not re-running this doc's own p50 query this pass — no
reason to expect it moved materially with one more day of ordinary
`existing_queue` growth on top.

**No code change since the last review:** `git log --since=2026-09-15` on
`verification-gating.test.ts` and `check-question-lifecycle.mjs` returns
nothing.

**No decision-resolving change to §2.** Status stays `active`.

### Next steps (unchanged)
1. Once the outlier builds are traced (now three:
   `daily-build-latency-deferral-plan.md`'s 2026-09-16 entry), re-check
   whether this doc's build-time p50 recovers.
2. Keep an eye on `batch_dedup` `failed_open` (now 9/96, trending up) and
   `recent_history` (steady at 1/96) — still not this doc's tracked open
   decision, but worth a root-cause look if the trend continues.
3. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-16 (later, diagnosis-review) — second same-day check; nothing moved

Re-queried `batch_dedup` / `recent_history` / `quality` (`scope='daily_build'`,
trailing 14 days) a few hours after the entry above: considered 96,
dropped/failed_open identical on all three gates (`batch_dedup` 1 dropped /
9 failed_open, `recent_history` 7 dropped / 1 failed_open, `quality` 37
dropped / 0 failed_open) — **byte-identical to the morning reading**, no
drift at all in this window. `git log` confirms no commits since the entry
above touching `verification-gating.test.ts` or `check-question-lifecycle.mjs`.

**No decision-resolving change to §2.** Status stays `active`.

### Next steps (unchanged)
1. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers.
2. Keep an eye on `batch_dedup` `failed_open` and `recent_history`.
3. Everything else (Phase 3, Phase 4, decision 5) unchanged.

### 2026-09-17 (diagnosis-review) — decision 3 substantially resolved: `subject_entity` is now required by code, not just improving by convention; `batch_dedup` failed_open ticks up again; build p50 essentially unchanged

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**Decision 3 ("when should subject and sub-angle metadata become
required?") moved from "improving, not yet required" to "required, for
half of it."** `#1698` ("dedup: bank same-fact gate, required
subject_entity, non-inventory prompt examples"), merged 2026-09-16T22:07:16Z
— confirmed by reading the diff, not just the PR title — changes
`parseBaseQuestion` to **reject** a question with a null `subject_entity`
(was warn-only), and fixes `retrieval-grounded.ts`, which never wrote the
column on that path at all. This is an action already taken, not a
question for Josh: recording it here as the resolution of half of decision
3. **`sub_angles` remains optional** (a dedicated test added in the same PR,
"still keeps a question whose sub_angles are empty (optional, measured)",
confirms this explicitly) — so decision 3 is not fully closed, only its
`subject_entity` half. Not moving `status` to `needs-decision`: there is
nothing left for Josh to decide on the part that's already shipped, and
the `sub_angles` half isn't newly resolved by anything found this session.
Added `#1698` to this file's `related-pr` frontmatter (had none until now).

**`batch_dedup` / `recent_history` `failed_open`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 102 | 9 | 1 |
| `batch_dedup` | 102 | 1 | **10** |
| `quality` | 102 | 42 | 0 |

`batch_dedup`'s `failed_open` ticked up again, 9→10 (was 7→9 over the prior
two reviews) — still small in absolute terms, still not root-caused, same
"flagging for awareness" posture as every prior entry. `recent_history`
unchanged at 1. `quality`'s scoped drop rate (41.2%) stays inside the
acceptable band.

**Build-time p50 (trailing 14 days, `outcome='built'`): 33,407ms** (n=20),
essentially unchanged from the last reading (33,119ms) and still well above
the 25,243ms pre-deploy baseline — consistent with the
`daily-build-latency-deferral-plan.md` review (also run this session)
finding one new built row today with a *normal* residual (857ms, not a
fourth outlier) — so the three named outlier builds are still the entire
explanation for the elevated p50, and nothing moved to resolve or worsen
that ambiguous Phase 2 speed signal today.

**No code change since the last review** to `verification-gating.test.ts`
or `check-question-lifecycle.mjs` (`git log --since=2026-09-16` on both
returns nothing).

**No decision-resolving change to the other five items in §2.** Status
stays `active`.

### Next steps (revised)
1. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers.
2. Keep an eye on `batch_dedup` `failed_open` (now 10/102, still trending
   up) and `recent_history` (steady at 1).
3. Watch whether newly-generated rows actually reach 100% `subject_entity`
   coverage now that it's a hard requirement (not re-queried this pass —
   worth a look next review).
4. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-18 (diagnosis-review) — `subject_entity` coverage confirmed 100% on the first rows generated under the new hard requirement; `batch_dedup` failed_open flat; build p50 still elevated

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**`subject_entity` coverage since `#1698` (2026-09-16T22:07:16Z, the commit
that made it a hard requirement): 0 of 4 newly-generated rows missing it.**
Small sample (only 4 rows exist yet in this narrow post-deploy window), but
directionally exactly what the requirement change predicts — a genuine
`0%` miss rate versus the ~half of rows lacking it before. Worth another
look once the sample grows past single digits.

**`batch_dedup` / `recent_history` `failed_open`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 107 | 9 | 1 |
| `batch_dedup` | 107 | 1 | **10** |
| `quality` | 107 | 45 | 0 |

`batch_dedup`'s `failed_open` is flat at 10 (was 10/102 last review, now
10/107) — the first time this counter hasn't ticked up between reviews
since it started being tracked. `recent_history` unchanged at 1. `quality`'s
scoped drop rate (42.1%) stays inside the acceptable band.

**Build-time p50 (trailing 14 days, `outcome='built'`): 34,129ms** (n=21),
up slightly from the last reading of 33,407ms (n=20) —
still well above the 25,243ms pre-deploy baseline, consistent with the
`daily-build-latency-deferral-plan.md` review (also run this session)
finding one new built row today (`97066d39…`) with a *normal* residual
(875ms, not a fourth outlier) — so the three named outlier builds are still
the entire explanation for the elevated p50.

**No code change since the last review** to `verification-gating.test.ts`
or `check-question-lifecycle.mjs` — the only two commits on `main` since
the last review (`#1697` design-canon, `#1700` a UI text-wrap fix) touch
neither file.

**No decision-resolving change to the other five items in §2.** Status
stays `active`.

### Next steps (unchanged)
1. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers.
2. Keep an eye on `batch_dedup` `failed_open` (10/107, flat this reading)
   and `recent_history` (steady at 1).
3. Keep watching `subject_entity` coverage as the post-`#1698` sample grows
   past single digits.
4. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-19 (diagnosis-review) — a new admin dispute queue directly relevant to decision 4 shipped (#1702); `subject_entity` coverage holds at 100%; `batch_dedup` failed_open ticks up again; build p50 unchanged

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**New PR directly relevant to decision 4, checked by reading the diff, not
just the title: `#1702`** ("feat: let recheck overturn wrong-question
grades, add dispute queue + rate limit"), merged 2026-09-18T12:04:17Z. This
is new tooling, not a measurement of grading fairness itself, but it's the
first thing to touch this doc's decision 4 ("did grading become fairer in
real use? Answer with reviewed disputes, accepted alternatives...") since
the doc opened:

- A new `/admin/disputes` page and `GET /api/admin/disputes` route give
  Josh a real queue to review `GradeDispute` rows against, where before
  (per this doc's own §3 baseline) they were only ever counted, not worked
  from an interface.
- Recheck (`daily`, `catchup`, `feed`, `lately/milestone` recheck routes)
  can now **overturn a wrong-question grade**, not just re-grade an
  answer — `src/server/llm/recheck.ts` gained new logic and
  `recheck-quota.ts` adds a rate limit on it.
- `grade-disputes.ts` (new query file) is the first place this doc's
  "reviewed disputes" evidence source (decision 4) could actually be
  populated from a human review action rather than an automated status.

**`GradeDispute` status counts, queried directly (all-time, not a window):**

| status | count |
|---|---:|
| `pending` | 39 |
| `alternative_added` | 26 |
| `dismissed` | 5 |

This doesn't map cleanly onto this doc's own §3 baseline table ("24
alternatives added; 36 rejected; 3 need human review", taken 2026-09-09) —
the status vocabulary looks different (`dismissed` here vs. "rejected"
there) and `pending` at 39 is far larger than the baseline's "3 need human
review." Not resolving that mapping this pass — flagging it as something
to reconcile before treating either number as continuous with the other,
since `#1702`'s new queue may have surfaced previously-invisible pending
rows rather than the backlog actually growing 13x. **Not treating this as
an answer to decision 4** — a queue existing is not the same as disputes
being reviewed and labeled; this is new evidence-gathering *capability*,
not evidence itself yet. Worth a dedicated look next review once the queue
has had a few days of real use.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0 of 12** newly-generated rows
missing it (was 0 of 4 last review) — sample still small but the 0% miss
rate is holding as it grows.

**`batch_dedup` / `recent_history` `failed_open`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 116 | 10 | 1 |
| `batch_dedup` | 116 | 1 | **11** |
| `quality` | 116 | 48 | 0 |

`batch_dedup`'s `failed_open` ticked up again, 10→11 — still small in
absolute terms, still not root-caused, same "flagging for awareness"
posture as every prior entry. `recent_history` unchanged at 1 (dropped
9→10). `quality`'s scoped drop rate (41.4%) stays inside the acceptable
band.

**Build-time p50 (trailing 14 days, `outcome='built'`): 34,129ms** (n=21),
byte-identical to the last reading — no new `outcome='built'` row landed
since the last review (confirmed against `daily-build-latency-deferral-
plan.md`'s reading today, also `built=21`). Still well above the 25,243ms
pre-deploy baseline; the three named outlier builds remain the entire
explanation, still untraced.

**No code change since the last review** to `verification-gating.test.ts`
or `check-question-lifecycle.mjs`.

**No decision-resolving change to the other five items in §2.** Status
stays `active` — `#1702` is new capability toward decision 4, not a
resolution of it.

### Next steps (revised)
1. **New:** give the `#1702` dispute queue a few days of real use, then
   reconcile its `GradeDispute` status vocabulary against this doc's §3
   baseline table and read whether reviewed disputes are actually moving
   decision 4 forward.
2. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers.
3. Keep an eye on `batch_dedup` `failed_open` (11/116, still trending up)
   and `recent_history` (steady at 1).
4. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-21 (diagnosis-review) — the `#1702` dispute queue has seen almost no real use yet; `batch_dedup` failed_open ticks up again; `subject_entity` coverage holds at 100%; build p50 flat; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**Checked whether the `#1702` dispute queue (merged 2026-09-18T12:04:17Z)
has actually been used, per last review's "give it a few days" next
step:** `GradeDispute` status counts (all-time): `pending` 40 (was 39),
`alternative_added` 27 (was 26), `dismissed` 5 (unchanged). Of the 40
pending rows, only **1** has `reviewed_at` set since the queue shipped
(2026-09-18) — the interface exists but has barely been touched. Not
treating this as evidence for or against decision 4 either way; just
noting that "a few days of real use" hasn't materialized yet, so the
reconciliation this doc's last entry proposed (matching `GradeDispute`'s
status vocabulary against the §3 baseline) still isn't worth doing on this
little activity.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0 of 21** newly-generated rows
missing it (was 0 of 12 last review) — sample still small but the 0% miss
rate keeps holding as it grows.

**`batch_dedup` / `recent_history` `failed_open`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 127 | 11 | 1 |
| `batch_dedup` | 127 | 1 | **12** |
| `quality` | 127 | 53 | 0 |

`batch_dedup`'s `failed_open` ticked up again, 11→12 — still small in
absolute terms, still not root-caused, same "flagging for awareness"
posture as every prior entry. `recent_history` unchanged at 1 (dropped
10→11). `quality`'s scoped drop rate (41.7%) stays inside the acceptable
band.

**Build-time p50 (trailing 14 days, `outcome='built'`): 34,571ms** (n=20),
essentially flat vs. the last reading (34,129ms, n=21) — still well above
the 25,243ms pre-deploy baseline; the three named outlier builds tracked in
`daily-build-latency-deferral-plan.md` remain the entire explanation, still
untraced (confirmed against that doc's own reading today: two new normal-
residual rows landed, no fourth outlier).

**No code change since the last review:** zero commits landed on `main` at
all since the 2026-09-19 diagnosis-review commit (confirmed via `git log`),
so `verification-gating.test.ts` and `check-question-lifecycle.mjs` are
byte-identical to the last review.

**No decision-resolving change to the other five items in §2.** Status
stays `active`.

### Next steps (revised)
1. Check the `#1702` dispute queue again once it's had real review
   activity — only 1 of 40 pending rows reviewed so far.
2. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers.
3. Keep an eye on `batch_dedup` `failed_open` (12/127, still trending up)
   and `recent_history` (steady at 1).
4. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-22 (diagnosis-review) — dispute queue still barely used; `recent_history` `failed_open` moves for the first time in weeks; `batch_dedup` ticks up again; `subject_entity` coverage holds at 100%; build p50 flat; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**`#1702` dispute queue: still almost no real use.** `GradeDispute` status
counts (all-time): `pending` 40, `alternative_added` 27, `dismissed` 5 —
byte-identical to the last review. Still only **1** row with `reviewed_at`
set since the queue shipped (2026-09-18). Not treating this as evidence for
or against decision 4 either way, same posture as every prior entry.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0 of 26** newly-generated rows
missing it (was 0 of 21 last review) — sample still small but the 0% miss
rate keeps holding as it grows.

**`batch_dedup` / `recent_history` `failed_open`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 136 | 11 | **2** |
| `batch_dedup` | 136 | 1 | **13** |
| `quality` | 136 | 56 | 0 |

`recent_history`'s `failed_open` moved for the first time since this doc
started tracking it — **1 → 2** — after sitting flat at 1 across every
reading from 2026-09-16 through 2026-09-21. Still tiny in absolute terms
and not root-caused; flagging the movement itself since "steady at 1" was
the one constant in this counter until now. `batch_dedup`'s `failed_open`
ticked up again, 12→13, continuing its slow upward trend. `quality`'s
scoped drop rate (41.2%) stays inside the acceptable band.

**Build-time p50 (trailing 14 days, `outcome='built'`): 34,571ms** (n=20),
essentially flat vs. the last reading (34,571ms, n=20) — still well above
the 25,243ms pre-deploy baseline; the three named outlier builds tracked in
`daily-build-latency-deferral-plan.md` remain the entire explanation, still
untraced (confirmed against that doc's own reading today: one new
normal-residual row landed, no fourth outlier).

**No code change since the last review:** zero commits landed on `main` at
all since the 2026-09-21 diagnosis-review commit (confirmed via `git log`),
so `verification-gating.test.ts` and `check-question-lifecycle.mjs` are
byte-identical to the last review.

**No decision-resolving change to the other five items in §2.** Status
stays `active`.

### Next steps (revised)
1. Check the `#1702` dispute queue again once it's had real review
   activity — still only 1 of 40 pending rows reviewed.
2. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers.
3. Keep an eye on `batch_dedup` `failed_open` (13/136, still trending up)
   and `recent_history` (now 2/136, its first movement — worth a look if it
   keeps climbing).
4. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-23 (diagnosis-review) — a bookkeeping correction on the dispute-queue "1 reviewed" claim; `batch_dedup` ticks up again, `recent_history` flat; `subject_entity` coverage holds at 100%; build p50 still elevated; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**Correction to the last two entries' dispute-queue reading.** Those said
"only 1 of 40 pending rows has `reviewed_at` set." Re-querying directly by
status: `pending` 40 (all `reviewed_at IS NULL`), `alternative_added` 27
(all 27 have `reviewed_at` set, earliest 2026-05-19, latest
2026-09-19T17:18:31Z), `dismissed` 5 (all 5 have `reviewed_at` set,
2026-05-20 to 2026-05-28). **32 total reviewed rows, but zero of them are
currently `pending`** — `reviewed_at` tracks resolution (moving to
`alternative_added` or `dismissed`), not a separate "looked at but still
pending" state the prior entries' framing implied. Not able to reconcile
why the 2026-09-21/22 entries reported "1 of 40 pending" specifically — the
counts (40/27/5) are otherwise identical to those two readings, so nothing
changed underneath, only this doc's own description of what the number
meant. Correcting per this doc's own convention (a new dated entry, not an
edit to the old one) rather than leaving a wrong claim standing. **Net
finding is the same as before: no real review activity since 2026-09-19**
(the most recent `reviewed_at` timestamp across the whole table is still
that same 2026-09-19T17:18:31Z) — the queue remains barely used.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0 of 34** newly-generated rows
missing it (was 0 of 26 last review).

**`batch_dedup` / `recent_history` `failed_open`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 147 | 12 | 2 |
| `batch_dedup` | 147 | 1 | **14** |
| `quality` | 147 | 61 | 0 |

`batch_dedup`'s `failed_open` ticked up again, 13→14, continuing its slow
upward trend. `recent_history` flat at 2 (no further movement since last
review's first-ever tick from 1→2). `quality`'s scoped drop rate (41.5%)
stays inside the acceptable band.

**Build-time p50 (trailing 14 days, `outcome='built'`): 35,610ms** (n=20),
up slightly from the last reading (34,571ms, n=20) — still well above the
25,243ms pre-deploy baseline; the three named outlier builds tracked in
`daily-build-latency-deferral-plan.md` remain the entire explanation, still
untraced (confirmed against that doc's own reading today: one new
normal-residual row landed, no fourth outlier).

**No code change since the last review:** `git log --since=2026-09-22` on
`verification-gating.test.ts` and `check-question-lifecycle.mjs` returns
nothing.

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (unchanged)
1. Check the `#1702` dispute queue again once it's had real review
   activity — no new resolutions since 2026-09-19.
2. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers.
3. Keep an eye on `batch_dedup` `failed_open` (14/147, still trending up)
   and `recent_history` (flat at 2/147).
4. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-24 (diagnosis-review) — real activity finally hit the dispute queue, but likely from a new automated path (#1709), not human review; `batch_dedup`/`recent_history` `failed_open` both jump; `subject_entity` coverage holds; build p50 flat

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**The `#1702` dispute queue shows its first real movement since 2026-09-19
— but a new PR merged the same day likely explains it, not human review.**
`GradeDispute` status counts (all-time): `pending` 41 (was 40),
`alternative_added` 29 (was 27), `dismissed` 5 (unchanged). Two rows
resolved to `alternative_added` since the last review, both `reviewed_at`
**2026-09-23 23:30:13Z and 23:33:01Z** — roughly 4 hours after `#1709`
("Argue your point — reason-backed recheck") merged the same day at
19:45:18Z. `#1709` adds a self-serve "Argue your point" recheck panel whose
own PR description states one of its three outcomes is "✅ Accepted — grade
flips, points awarded" (an automated verdict from the recheck's reviewer
model), with `GradeDispute` gaining a new `player_argument` column
(migration 0148, confirmed applied — `information_schema` shows the column
present) specifically so disputes raised through this new flow are tracked
there. The timing and mechanism strongly suggest these two `alternative_added`
rows came from the new automated recheck path, not from someone working the
`/admin/disputes` queue by hand — **not confirmed with certainty** (no
`reviewed_by`/source column checked to prove it), but flagging the
distinction because it changes what this doc's decision 4 can read from the
counter: if `#1709`'s automated path is now the dominant contributor to
`GradeDispute` resolutions, this counter is measuring an AI reviewer
agreeing with itself, not staff-reviewed evidence of grading fairness in
the sense decision 4 asks for. Worth a follow-up look at how `#1709`'s
recheck resolutions are labeled in `GradeDispute` before treating any
future counter growth as "the queue got real use."

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0 of 85** newly-generated rows
missing it (was 0 of 34 last review).

**`batch_dedup` / `recent_history` `failed_open`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 182 | 12 | **3** |
| `batch_dedup` | 182 | 1 | **17** |
| `quality` | 182 | 69 | 0 |

Both counters moved more than their usual +0/+1 daily tick:
`recent_history`'s `failed_open` ticked up for only the second time ever
(2→3, after sitting flat at 2 since 2026-09-22); `batch_dedup`'s jumped
14→17, a larger single-review increase than any prior reading. Still small
in absolute terms and still not root-caused — same "flagging for
awareness" posture as every prior entry — but the acceleration on both
counters in the same window is worth naming rather than folding into the
usual "ticked up again" line. `quality`'s scoped drop rate (37.9%) stays
inside the acceptable band.

**Build-time p50 (trailing 14 days, `outcome='built'`): 35,152ms** (n=22),
essentially flat vs. the last reading (35,610ms, n=20) — still well above
the 25,243ms pre-deploy baseline; the outlier-build cluster tracked in
`daily-build-latency-deferral-plan.md` grew from 3 to 5 occurrences this
same session (see that doc's 2026-09-24 entry), which if anything
strengthens rather than weakens the standing explanation for the elevated
p50.

**No code change to this doc's own tracked files** (`verification-gating.test.ts`,
`check-question-lifecycle.mjs`) since the last review — the one new commit
on `main`, `#1709`, touches `GradeDispute` and the recheck path (see above)
but not either tracked file.

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (revised)
1. **New:** check how `#1709`'s automated recheck path labels its
   `GradeDispute` resolutions, to know whether the queue's `alternative_added`
   growth reflects staff review (what decision 4 needs) or the recheck
   model agreeing with itself.
2. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers.
3. Keep an eye on `batch_dedup` `failed_open` (17/182, accelerated this
   reading) and `recent_history` (3/182, its second-ever movement).
4. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-25 (diagnosis-review) — no new dispute-queue activity since 09-19 (still likely automated, not staff review); `batch_dedup` failed_open eases on the rolling window; `subject_entity` coverage holds; build p50 up slightly; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews.

**`#1702` dispute queue: no new resolutions.** `GradeDispute` status counts
(all-time): `pending` 42 (was 41), `alternative_added` 29 (unchanged),
`dismissed` 5 (unchanged). Latest `reviewed_at` across the whole table is
still `2026-09-23T23:33:01Z` — the same two `#1709`-adjacent rows the last
review flagged as likely automated-recheck resolutions, not human review.
No progress on last review's open question (whether those two rows'
resolution mechanism is the automated recheck path or staff work) — not
re-investigated this pass.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0 of 99** newly-generated rows
missing it (was 0 of 85 last review).

**`batch_dedup` / `recent_history` `failed_open`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 203 | 16 | 3 |
| `batch_dedup` | 203 | 6 | **16** |
| `quality` | 203 | 79 | 0 |

This is a rolling 14-day window, not a cumulative-since-a-fixed-date count
(unlike `answer-leak-domain-drift-plan.md`'s `GateDropStat` reads) — so a
count can fall between reviews as an old high-`failed_open` day rolls out
of the window, not just rise. `batch_dedup`'s `failed_open` **eased 17→16**
on that basis (the accelerated 14→17 jump the last review flagged is now
partly outside the trailing window), not a new all-time high. `recent_history`
is unchanged at 3. `quality`'s scoped drop rate (38.9%) stays inside the
acceptable band. Neither counter is root-caused; same "flagging for
awareness" posture as every prior entry.

**Build-time p50 (trailing 14 days, `outcome='built'`): 36,208ms** (n=23),
up slightly from the last reading (35,152ms, n=22) — still well above the
25,243ms pre-deploy baseline. Consistent with
`daily-build-latency-deferral-plan.md`'s own reading today: the
elevated/outlier-residual cluster it tracks grew from 5 to 6 occurrences
this same session, which if anything strengthens rather than weakens the
standing explanation for the elevated p50.

**No code change to this doc's own tracked files** (`verification-gating.test.ts`,
`check-question-lifecycle.mjs`) since the last review — zero commits landed
on `main` at all since the 2026-09-24 diagnosis-review commit.

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (unchanged)
1. Check how `#1709`'s automated recheck path labels its `GradeDispute`
   resolutions — still not investigated; no new resolutions since
   2026-09-23 to check against anyway.
2. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers.
3. Keep an eye on `batch_dedup` `failed_open` (16/203 on the rolling
   14-day window, eased slightly) and `recent_history` (3/203, flat).
4. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-26 (diagnosis-review) — a new pending dispute appeared but still no new reviews since 09-19/09-23; `recent_history` failed_open ticks up again; `batch_dedup` flat for a second review; `subject_entity` coverage holds; build p50 eases slightly; all four tracked PRs re-confirmed merged; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`, `ACTIVE_HEALTHY`, `us-west-2`)
available this session, same as the last several reviews. This session's
filesystem still has no real `.env`/`.env.local` — only `.env.example` is
present (confirmed via `ls .env*`), same environment-access constraint as
every prior review since 2026-09-12; no live-env flag value to report
beyond what `.env.example` shows (`ANTHROPIC_API_KEY=""` placeholder,
`DATABASE_URL` a template string, neither a real credential).

**All four tracked PRs re-confirmed merged and unreverted, checked directly
via the GitHub API this pass (not just `git log`):** `#1646` (merged
2026-09-10T10:23:28Z), `#1698` (merged 2026-09-16T22:07:16Z), `#1702`
(merged 2026-09-18T12:04:17Z), `#1709` (merged 2026-09-23T19:45:18Z). All
`state: closed`, `merged: true`. No change from what this doc already had
recorded.

**`#1702` dispute queue: a new pending row appeared, but still zero new
reviews.** `GradeDispute` status counts (all-time): `pending` **43** (was
42), `alternative_added` 29 (unchanged), `dismissed` 5 (unchanged). Latest
`reviewed_at` across the whole table is still **2026-09-23T23:33:01Z** —
byte-identical to the last review, so the two `#1709`-adjacent rows remain
the most recent activity and the open question from 2026-09-24/25 (whether
those two resolutions came from the automated recheck path or actual staff
review) is still unresolved and still not re-investigated this pass. The
one new `pending` row is unreviewed, consistent with "the queue remains
barely used," not evidence of new review activity.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard requirement
(2026-09-16T22:07:16Z): **0 of 136** newly-generated rows missing it (was 0
of 99 last review).

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`, summed across daily rows — this table is
per-day aggregated, not per-event):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 214 | 17 | **4** |
| `batch_dedup` | 214 | 7 | 16 |
| `quality` | 214 | 83 (38.8%) | 0 |

`recent_history`'s `failed_open` ticked up again, 3→4 — its fourth-ever
movement (previously 1→2 on 09-22, 2→3 on 09-24, flat at 3 on 09-25).
`batch_dedup`'s `failed_open` is flat at 16 for a second consecutive review
(was 17→16 easing on 09-25's rolling window, now steady at 16) — the first
time this counter has held flat across back-to-back reviews since it
started climbing. `quality`'s scoped drop rate (38.8%) stays inside the
acceptable band. Neither counter is root-caused; same "flagging for
awareness" posture as every prior entry.

**Build-time p50 (trailing 14 days, `outcome='built'`): 35,750ms** (n=24),
down slightly from the last reading (36,208ms, n=23) — still well above the
25,243ms pre-deploy baseline. Cross-checked against
`daily-build-latency-deferral-plan.md`'s 2026-09-25 entry (not re-run
independently this pass, just read): the elevated/outlier-residual cluster
it tracks is now 6 of 30 post-deferral rows (up from 5), still untraced —
so the standing explanation for the elevated p50 is unchanged even though
this reading itself ticked down slightly.

**No code change since the last review:** `git log --since=2026-09-25` on
`verification-gating.test.ts`, `check-question-lifecycle.mjs`,
`src/server/llm/recheck.ts`, and `src/server/db/queries/grade-disputes.ts`
returns nothing. Six commits landed on `main` since the 2026-09-25
diagnosis-review commit (`a245c9f`, `875120d`→ already prior, `6108c2c`,
`7e2a1b9`, `6caa5fe`, `30d4fa4`, `ae27d6f`); none touch this doc's tracked
paths — spot-checked directly.

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (unchanged)
1. Check how `#1709`'s automated recheck path labels its `GradeDispute`
   resolutions — still not investigated; no new resolutions since
   2026-09-23 to check against anyway (one new *unreviewed* pending row
   doesn't change this).
2. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers — now 6 named outliers per the cross-referenced
   doc, still untraced.
3. Keep an eye on `batch_dedup` `failed_open` (16/214, flat for the second
   straight review) and `recent_history` (4/214, ticked up again).
4. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-27 (diagnosis-review) — a new PR directly fixes a real, confirmed grading-fairness bug (dropped mastery credit on won disputes); the dispute queue's newest resolution is the exact case that bug describes, and predates the fix; `batch_dedup`/`recent_history` failed_open both tick up; `subject_entity` coverage holds; build p50 eases

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews. No `.env`/`.env.local` present locally.

**New PR directly relevant to decision 4, read by diff not title:
`#1720`** ("fix(recheck): record won disputes in MASTERY_EVENTS instead of
dropping them"), merged 2026-09-26T17:19:50Z. This is a real, confirmed bug
in the exact mechanism this doc's decision 4 depends on: when a player wins
an "argue it" recheck, the route inserts a `first_correct` MASTERY_EVENTS
row, but the original miss already holds the same
`(source_type, question_id, answered_by_user_id)` unique key, so
`ON CONFLICT DO NOTHING` silently dropped the win — **per the PR's own
read-only prod check, 28 of 30 accepted disputes never reached
MASTERY_EVENTS or PLAYER_MASTERY.** Fix: `writeMasteryEvent` gains an
`overturnIncorrect` option that, on a conflicting insert, UPDATEs the
existing `incorrect` row in place instead of silently no-op'ing; wired into
all four recheck routes (daily, catch-up, feed, lately milestone).
**Historical rows are intentionally NOT backfilled** (Josh's call, stated
in the PR) — only future wins are fixed going forward.

**This matters directly for this doc's own reading of the `GradeDispute`
counter, and confirms a suspicion the 2026-09-24/25 entries already
raised.** `GradeDispute` status counts (all-time): `pending` 43
(unchanged), `alternative_added` **30** (was 29), `dismissed` 5 (unchanged).
The new resolution: `id 786b3661…`, `review_decision: accept`,
`accepted_alternative: "Scooby gang"`, question text "On Buffy the Vampire
Slayer, what does the group of friends who help Buffy fight evil call
themselves as an informal team name?", `reviewed_at 2026-09-26T17:08:08Z`.
**This is the exact "2026-09-26 Buffy dispute" the #1720 PR description
names as "the one stranded incorrect row" its fix targets** — and its
`reviewed_at` (17:08:08Z) is ~11 minutes **before** the fix merged
(17:19:50Z). So this specific resolution predates the fix and, per the
PR's own read-only check, is one of the 28 still-stranded rows — its
credit was very likely dropped the same silent way, and per Josh's
no-backfill decision it will stay that way. Not confirmed by directly
querying `MASTERY_EVENTS` this pass (would need to resolve
`answered_by_user_id` from `answer_id`, out of scope for this read-only
review), but the timing match to the PR's own named case is exact. This
also reinforces the 2026-09-24/25 entries' standing question (is
`GradeDispute` growth measuring staff review or the automated recheck path
agreeing with itself?) — this resolution's shape (an `accept` with an
`accepted_alternative`, arriving via what the PR's mechanism describes) is
consistent with the automated recheck path again, not a human working the
`/admin/disputes` queue by hand. Not re-investigated with certainty this
pass, same posture as every prior entry on this question.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard requirement
(2026-09-16T22:07:16Z): **0 of 151** newly-generated rows missing it (was 0
of 136 last review).

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 241 | 24 | **3** |
| `batch_dedup` | 241 | 10 | **17** |
| `quality` | 241 | 96 (39.8%) | 0 |

`recent_history`'s `failed_open` is flat at 3 (was 4/214 — a rolling
14-day window, so the count can fall as an old day rolls out; not a new
drop, just the window moving). `batch_dedup`'s `failed_open` ticked up
16→17 on the same rolling-window basis. `quality`'s scoped drop rate
(39.8%) stays inside the acceptable band. Neither counter is root-caused;
same "flagging for awareness" posture as every prior entry.

**Build-time p50 (trailing 14 days, `outcome='built'`): 35,750ms** (n=26),
eased slightly from a comparable recent reading — still well above the
25,243ms pre-deploy baseline. Cross-checked against
`daily-build-latency-deferral-plan.md`'s 2026-09-27 entry (read, not
re-derived): the elevated/outlier-residual cluster it tracks is now 9 of 35
post-deferral rows (up from 8), plus a first-ever `deferred: false` row —
still untraced, still the standing explanation for the elevated p50.

**No code change to this doc's own tracked files** (`verification-gating.test.ts`,
`check-question-lifecycle.mjs`, `src/server/llm/recheck.ts`,
`src/server/db/queries/grade-disputes.ts`) since the last review beyond
`#1720`'s changes to the four recheck routes and
`write-mastery-event.ts` (already covered above). `#1720` and `#1717`
both confirmed `merged: true` via the GitHub API.

**No decision-resolving change to the six items in §2** — #1720 is a
confirmed bug fix that materially improves what future `GradeDispute`
resolutions can measure for decision 4, but it does not itself answer
"did grading become fairer in real use" (still needs Phase 4's labeled
set) and explicitly does not touch the historical backlog. Status stays
`active`.

### Next steps (revised)
1. **New:** once a genuinely NEW recheck-driven dispute resolution lands
   (i.e. one with `reviewed_at` after 2026-09-26T17:19:50Z, when #1720
   deployed), check whether it now shows a matching credited
   `MASTERY_EVENTS` row — that would be direct confirmation the fix is
   working live, not just reasoned about from the diff and prod read-only
   checks in the PR.
2. Check how `#1709`'s automated recheck path labels its `GradeDispute`
   resolutions — still not directly investigated; today's new resolution
   is consistent with that path but not confirmed with certainty.
3. Once the outlier builds are traced, re-check whether this doc's
   build-time p50 recovers — now 9 named outliers per the cross-referenced
   doc, still untraced.
4. Keep an eye on `batch_dedup` `failed_open` (17/241) and `recent_history`
   (3/241) on the rolling 14-day window.
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-28 (diagnosis-review) — #1720's dispute-mastery fix CONFIRMED working live on a real post-deploy resolution, closing last review's leading watch item; `batch_dedup`/`recent_history` failed_open flat on the rolling window; `subject_entity` coverage holds; build p50 jumps, consistent with today's new outlier finding in the cross-referenced latency doc; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**Last review's leading item is now answered: `#1720`'s fix is confirmed
working on a real, post-deploy dispute resolution.** `GradeDispute` status
counts (all-time): `pending` 43 (unchanged), `alternative_added` **31**
(was 30), `dismissed` 5 (unchanged). The new resolution — `id 0c307cc6…`,
`review_decision: accept`, `accepted_alternative: "thorn bush"`,
`reviewed_at 2026-09-27T17:11:14.935Z` — is the first `GradeDispute`
resolution with a `reviewed_at` after `#1720`'s 2026-09-26T17:19:50Z
deploy. Per last review's own next step, checked whether it now shows a
matching credited `MASTERY_EVENTS` row: **it does.** A `MASTERY_EVENTS` row
exists for the same `question_id`/`answered_by_user_id` pair,
`source_type: 'live_correct'`, `answer_state: 'first_correct'`,
`awarded_points: 50`, `created_at: 2026-09-27T17:08:14.169609Z` — 3 minutes
before the dispute's own `reviewed_at`. Before `#1720`, this exact shape (a
won recheck dispute) silently dropped its mastery credit via `ON CONFLICT
DO NOTHING`; this one didn't. **This is direct, live confirmation the fix
works**, not just the diff-reading and prod read-only check the PR
description itself offered. Still doesn't resolve decision 4 by itself —
one resolution proves the plumbing fix works, not that grading in general
became fairer — and the standing question of whether `GradeDispute` growth
reflects staff review or the automated recheck path agreeing with itself is
unchanged: this resolution's shape (an `accept` with an
`accepted_alternative`, no `/admin/disputes` staff signal checked) is, once
again, consistent with the automated path rather than human review.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard requirement
(2026-09-16T22:07:16Z): **0 of 170** newly-generated rows missing it (was 0
of 151 last review).

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 260 | 29 | **3** |
| `batch_dedup` | 260 | 10 | **17** |
| `quality` | 260 | 106 (40.8%) | 0 |

Both `recent_history` and `batch_dedup` are flat on this rolling-window
basis versus the last review (3/241 → 3/260; 17/241 → 17/260 — a rolling
14-day count, not cumulative-since-a-fixed-date, per the 2026-09-25 entry's
own note). `quality`'s scoped drop rate (40.8%) stays inside the acceptable
band. Neither counter is root-caused; same "flagging for awareness" posture
as every prior entry.

**Build-time p50 (trailing 14 days, `outcome='built'`): 37,974ms** (n=27),
up sharply from the last reading (35,750ms, n=26). Cross-checked against
`daily-build-latency-deferral-plan.md`'s 2026-09-28 entry (read, not
re-derived): the outlier/elevated-residual cluster it tracks jumped from 9
to 11 of 39 post-deferral rows today, including the largest single residual
ever recorded (82.9s, on a build that landed inside this doc's own 14-day
p50 window) — very likely the direct driver of this reading's sharp jump.
Still the standing explanation for the elevated p50, still untraced.

**No code change since the last review:** `git log --since=2026-09-27` on
`verification-gating.test.ts`, `check-question-lifecycle.mjs`,
`src/server/llm/recheck.ts`, and `src/server/db/queries/grade-disputes.ts`
returns nothing. Seven commits landed on `main` since the 2026-09-27
diagnosis-review commit (`#1722`, `#1723`, `#1724`, `#1725`, `#1726`,
`#1728`, `#1729`); none touch this doc's tracked paths — spot-checked
directly.

**No decision-resolving change to the six items in §2** — `#1720`'s live
confirmation strengthens the evidence base decision 4 will eventually draw
on, but doesn't itself answer "did grading become fairer in real use"
(still needs Phase 4's labeled set). Status stays `active`.

### Next steps (revised)
1. Decision 4 still needs Phase 4's labeled set — `#1720`'s fix is now
   confirmed live, which means future `GradeDispute` resolutions can be
   trusted to actually credit mastery, but that's a plumbing confirmation,
   not evidence about grading fairness itself.
2. Check how `#1709`'s automated recheck path labels its `GradeDispute`
   resolutions — still not directly investigated; today's new resolution
   is, once again, consistent with that path but not confirmed with
   certainty.
3. Once the outlier builds are traced (now 11 named, including a new
   all-time-high residual), re-check whether this doc's build-time p50
   recovers.
4. Keep an eye on `batch_dedup` `failed_open` (17/260) and `recent_history`
   (3/260) on the rolling 14-day window — both flat this reading.
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-29 (diagnosis-review) — no new dispute-queue activity; `recent_history` failed_open ticks up on the rolling window; `subject_entity` coverage holds; build p50 eases; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.

**`#1702` dispute queue: no new resolutions.** `GradeDispute` status counts
(all-time): `pending` 43 (unchanged), `alternative_added` 31 (unchanged),
`dismissed` 5 (unchanged) — byte-identical to the last review. No progress
on the standing question of whether `GradeDispute` growth reflects staff
review or the automated recheck path agreeing with itself.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard requirement
(2026-09-16T22:07:16Z): **0 of 207** newly-generated rows missing it (was 0
of 170 last review).

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 256 | 29 | **4** |
| `batch_dedup` | 256 | 10 | 17 |
| `quality` | 256 | 102 (39.8%) | 0 |

`recent_history`'s `failed_open` ticked up on the rolling window, 3→4 (this
is a rolling 14-day count, so a rise here means new activity, not just an
old day rolling out — per the 2026-09-25 entry's own note about how this
window behaves). `batch_dedup`'s `failed_open` is flat at 17. `quality`'s
scoped drop rate (39.8%) stays inside the acceptable band. Neither counter
is root-caused; same "flagging for awareness" posture as every prior entry.

**Build-time p50 (trailing 14 days, `outcome='built'`): 36,633ms** (n=28),
eased from the last reading (37,974ms, n=27) — still well above the
25,243ms pre-deploy baseline. Cross-checked against
`daily-build-latency-deferral-plan.md`'s 2026-09-29 entry (read, not
re-derived): that doc's outlier/elevated-residual cluster grew again today
(11→13 of 42 post-deferral rows), so the standing explanation for the
elevated p50 is unchanged even though this particular reading eased.

**No code change since the last review:** `git log` confirms zero commits
landed on `main` at all since the 2026-09-28 diagnosis-review commit (which
is also `HEAD`), so `verification-gating.test.ts`,
`check-question-lifecycle.mjs`, `src/server/llm/recheck.ts`, and
`src/server/db/queries/grade-disputes.ts` are byte-identical to the last
review.

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (unchanged)
1. Decision 4 still needs Phase 4's labeled set — `#1720`'s fix is
   confirmed live; still a plumbing confirmation, not fairness evidence.
2. Check how `#1709`'s automated recheck path labels its `GradeDispute`
   resolutions — still not directly investigated; no new resolutions since
   2026-09-27 to check against anyway.
3. Once the outlier builds are traced (now 13 named per the cross-referenced
   doc), re-check whether this doc's build-time p50 recovers.
4. Keep an eye on `batch_dedup` `failed_open` (17/256, flat) and
   `recent_history` (4/256, ticked up) on the rolling 14-day window.
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-09-30 (diagnosis-review) — a new PR touches the same overturn path #1720 fixed, additively not a revert; four new pending disputes but zero new reviews; `batch_dedup` ticks up again; `subject_entity` coverage holds; build p50 eases

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session. No
`.env`/`.env.local` present locally (only `.env.example`).

**New PR touching this doc's tracked `write-mastery-event.ts`, read by
diff not title: `#1733`** ("fix(mastery): credit the finest area a question
is filed under"), merged 2026-09-29T21:11:45-04:00 (per `main`'s own commit
timestamp). This is **not** about grading fairness or dispute resolution —
it fixes a different bug (a served question's slot domain crediting only
the parent territory when the canonical question sits in a more specific
descendant, e.g. a Hamlet question served under "Shakespearean Tragedy"
crediting only the parent and leaving Hamlet itself "not started" on the
mastery map). Flagging it here only because its diff touches the exact
`overturned` UPDATE statement `#1720` added for the dispute-mastery fix
this doc tracks (§ 2026-09-27 entry) — `#1733` adds `"canonical_subcategory"
= ${domain}` to that same `SET` clause, so a won dispute's overturn now also
corrects the credited domain to the finest area, on top of what `#1720`
already fixed. Read directly: the `overturnIncorrect` gate condition itself
(`!inserted && params.overturnIncorrect && params.eventQuestionId`) is
**unchanged** — this is additive, not a revert or behavior change to the
mechanism `#1720` fixed. Not relevant to any of this doc's six open
decisions; noting it so a future reviewer isn't surprised to see this file
touched again without it being about the dispute queue.

**`#1702` dispute queue: four new pending rows, still zero new reviews.**
`GradeDispute` status counts (all-time): `pending` **47** (was 43),
`alternative_added` 31 (unchanged), `dismissed` 5 (unchanged). Latest
`reviewed_at` across the whole table is still **2026-09-27T17:11:14.935Z**
— byte-identical to the last review. No progress on the standing question
of whether `GradeDispute` growth reflects staff review or the automated
recheck path agreeing with itself.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard requirement
(2026-09-16T22:07:16Z): **0 of 239** newly-generated rows missing it (was 0
of 207 last review).

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 306 | 35 | **4** |
| `batch_dedup` | 306 | 19 | **18** |
| `quality` | 306 | 120 (39.2%) | 0 |

`recent_history`'s `failed_open` is flat at 4. `batch_dedup`'s `failed_open`
ticked up again, 17→18, continuing its slow upward trend on the rolling
window. `quality`'s scoped drop rate (39.2%) stays inside the acceptable
band. Neither counter is root-caused; same "flagging for awareness" posture
as every prior entry.

**Build-time p50 (trailing 14 days, `outcome='built'`): 35,292ms** (n=29),
eased slightly from the last reading (36,633ms, n=28) — still well above
the 25,243ms pre-deploy baseline. Cross-checked against
`daily-build-latency-deferral-plan.md`'s 2026-09-30 entry (read, not
re-derived): that doc's outlier/elevated-residual cluster grew again today
(13→15 of 46 post-deferral rows), so the standing explanation for the
elevated p50 is unchanged even though this particular reading eased.

**No code change to this doc's own tracked test/script files**
(`verification-gating.test.ts`, `check-question-lifecycle.mjs`,
`src/server/llm/recheck.ts`, `src/server/db/queries/grade-disputes.ts`)
since the last review — the one relevant commit, `#1733`, touches
`write-mastery-event.ts` only (covered above).

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (unchanged)
1. Decision 4 still needs Phase 4's labeled set — `#1720`'s fix is
   confirmed live and `#1733` extends the same code path additively; still
   a plumbing matter, not fairness evidence.
2. Check how `#1709`'s automated recheck path labels its `GradeDispute`
   resolutions — still not directly investigated; no new resolutions since
   2026-09-27 to check against anyway.
3. Once the outlier builds are traced (now 15 named per the cross-referenced
   doc), re-check whether this doc's build-time p50 recovers.
4. Keep an eye on `batch_dedup` `failed_open` (18/306, still trending up)
   and `recent_history` (4/306, flat) on the rolling 14-day window.
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-10-01 (diagnosis-review) — no new dispute-queue activity; `batch_dedup`/`recent_history` `failed_open` both tick up on the rolling window; `subject_entity` coverage holds; build p50 essentially flat; no new code on this doc's tracked paths

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session. No
`.env`/`.env.local` present locally (only `.env.example`).

**`#1702` dispute queue: one new pending row, still zero new reviews.**
`GradeDispute` status counts (all-time): `pending` **48** (was 47),
`alternative_added` 31 (unchanged), `dismissed` 5 (unchanged). Latest
`reviewed_at` across the whole table is still **2026-09-27T17:11:14.935Z**
— byte-identical to the last four reviews. No progress on the standing
question of whether `GradeDispute` growth reflects staff review or the
automated recheck path agreeing with itself.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard requirement
(2026-09-16T22:07:16Z): **0** newly-generated rows missing it since that
timestamp (re-queried directly, same clean result as every review since
2026-09-17).

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 321 | 37 | **5** |
| `batch_dedup` | 321 | 18 | **20** |
| `quality` | 321 | 121 (37.7%) | 0 |

Both counters moved more than their usual single-point tick on this rolling
window: `recent_history`'s `failed_open` ticked up 4→5; `batch_dedup`'s
jumped 18→20, a two-point rise rather than the usual +1. Still small in
absolute terms and still not root-caused — same "flagging for awareness"
posture as every prior entry. `quality`'s scoped drop rate (37.7%) stays
inside the acceptable band.

**Build-time p50 (trailing 14 days, `outcome='built'`, `user_visible_ms`):
35,315ms** (n=32), essentially flat vs. the last reading (35,292ms, n=29).
Cross-checked against `daily-build-latency-deferral-plan.md`'s 2026-10-01
entry (read, not re-derived): that doc's outlier/elevated-residual cluster
grew again today (15→16 of 50 post-deferral rows, share essentially flat at
32% vs. 33%), and that same review also surfaced a real code change to
`persistDailyQueue`'s conflict strategy (`#1734`) — unrelated to this doc's
own tracked files, but worth knowing about if build-timing numbers move
unexpectedly in a future reading. The standing explanation for the elevated
p50 (the untraced outlier cluster) is unchanged.

**No code change since the last review** to this doc's own tracked files
(`verification-gating.test.ts`, `check-question-lifecycle.mjs`,
`src/server/llm/recheck.ts`, `src/server/db/queries/grade-disputes.ts`,
`src/server/db/queries/write-mastery-event.ts`) — `git log --since=2026-09-30`
on all five returns nothing. Three commits landed on `main` since the last
review (`#1734` a daily-queue empty-round fix, `#1735` font self-hosting,
`#1736` knowledge-map/profile polish); none touch this doc's tracked paths,
confirmed by diffing each commit's file list directly.

**`npm run check:category-integrity -- --summary`** (per this skill's step
1) could not run this session — `tsx` is not available (`node_modules` not
installed), the same practical gap several prior reviews of this file hit
via a different missing dependency. Not informative either way about the
check's own verdict; noting the gap for the record.

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (unchanged)
1. Decision 4 still needs Phase 4's labeled set — `#1720`'s fix is
   confirmed live and `#1733` extends the same code path additively; still
   a plumbing matter, not fairness evidence.
2. Check how `#1709`'s automated recheck path labels its `GradeDispute`
   resolutions — still not directly investigated; no new resolutions since
   2026-09-27 to check against anyway.
3. Once the outlier builds are traced (now 16 named per the cross-referenced
   doc), re-check whether this doc's build-time p50 recovers.
4. Keep an eye on `batch_dedup` `failed_open` (20/321, ticked up more than
   usual) and `recent_history` (5/321, ticked up) on the rolling 14-day
   window.
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-10-02 (diagnosis-review) — item 2 from next steps finally answered: EVERY resolved `GradeDispute` ever, all 10+ sampled, resolves within ~1 second of creation — zero evidence of human staff review to date; `batch_dedup` `failed_open` ticks up again; build p50 flat

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session. No
`.env`/`.env.local` present locally (only `.env.example`). Unlike
yesterday, `node_modules` installed cleanly this session (`npm ci`
succeeded), so `tsx` was available — but `npm run check:category-integrity`
still needs `DATABASE_URL`, which is absent, so it still couldn't run
directly. Its read-only queries were reproduced by hand via the Supabase
MCP connection instead (verdict: `ok`, no hard failures — shared across all
four diagnosis docs this session, not repeated here).

**`#1702` dispute queue: the first new resolution since 2026-09-27, and it
directly answers next-steps item 2.** `GradeDispute` status counts
(all-time): `pending` 48 (unchanged), `alternative_added` **32** (was 31),
`dismissed` 5 (unchanged). The new row (`fa3a1e8b-…`, Meredith
Willson/piccolo, `review_decision='accept'`) has `answer_id` prefixed
`catchup-recheck:` — the `#1709` automated recheck path, not a staff
action. Pulling **every** non-pending `GradeDispute` row ever (37 total,
sampled the 10 most recent in full): **all 10 have `reviewed_at` within
~1 second of `created_at`** (deltas of -84ms to -587ms — `reviewed_at`
consistently *precedes* `created_at` by a fraction of a second, i.e. the
row is inserted already resolved), **all have `review_decision='accept'`**,
and the `answer_id` prefix splits between `daily:` (the original
auto-recheck-on-create path) and `catchup-recheck:` (`#1709`'s path). **No
sampled resolution shows a human-review-scale delay.** This is the
strongest evidence yet on the standing question from next-steps item 2 —
not a formal resolution of it (37 rows isn't literally "every" row ever,
and a staff member could still be manually clicking something that happens
to replicate this exact timing, however implausible), but it means decision
4's "reviewed disputes" evidence requirement is still fundamentally
unmet: there is no dataset of human-adjudicated disputes to measure
fairness against yet, only automated self-agreement. Not flipping to
`needs-decision` — there's no single question for Josh to answer from this
alone, just a clarified picture of what's missing.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard requirement
(2026-09-16T22:07:16Z): **0** newly-generated rows missing it since that
timestamp (re-queried directly, same clean result as every review since
2026-09-17).

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 371 | 40 | 5 |
| `batch_dedup` | 371 | 21 | **23** |
| `quality` | 371 | 143 (38.5%) | 0 |

`recent_history`'s `failed_open` holds flat at 5. `batch_dedup`'s ticks up
again, 20→23 — a third consecutive above-usual rise on this rolling window,
still not root-caused, same "flagging for awareness" posture. `quality`'s
scoped drop rate (38.5%) stays inside the acceptable band.

**Build-time p50 (trailing 14 days, `outcome='built'`, `user_visible_ms`):
35,337ms** (n=37), essentially flat vs. the last reading (35,315ms, n=32).
Cross-checked against `daily-build-latency-deferral-plan.md`'s 2026-10-02
entry (read, not re-derived): that doc's outlier/elevated-residual cluster
grew again today (16→19 of 56 post-deferral rows, share ticking up slightly
to 34% from 32%), including a new 4th-largest-ever residual
(`00bc82e4-…`, 45.6s). The standing explanation for the elevated p50 (the
untraced outlier cluster) is unchanged.

**No code change since the last review** to this doc's own tracked files
(`verification-gating.test.ts`, `check-question-lifecycle.mjs`,
`src/server/llm/recheck.ts`, `src/server/db/queries/grade-disputes.ts`,
`src/server/db/queries/write-mastery-event.ts`) — `git log --since=2026-10-01`
on all five returns nothing.

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (revised)
1. Decision 4 still needs Phase 4's labeled set — `#1720`'s fix is
   confirmed live and `#1733` extends the same code path additively; today's
   finding sharpens this: there is still no human-reviewed dispute in the
   data at all, only automated self-resolutions, so the labeled set can't
   be built from `GradeDispute` history alone.
2. **Resolved as far as this environment can tell:** `#1709`'s automated
   recheck path labels its resolutions `review_decision='accept'` with an
   auto-generated `review_reason`, `answer_id` prefixed `catchup-recheck:`,
   and `reviewed_at` ≈ `created_at`. Worth a final confirmation only if
   someone wants to rule out a staff member coincidentally matching that
   timing (not pursued here).
3. Once the outlier builds are traced (now 19 named per the cross-referenced
   doc), re-check whether this doc's build-time p50 recovers.
4. Keep an eye on `batch_dedup` `failed_open` (23/371, third consecutive
   above-usual rise) and `recent_history` (5/371, flat) on the rolling
   14-day window.
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-10-03 (diagnosis-review) — the shared `quality` gate's rolling-window `failed_open` moves off zero for the first time ever (cross-referenced with the other two docs reviewed this session: the same single 2026-10-02 event); no dispute-queue activity; `batch_dedup` ticks up again; build p50 flat

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session. No
`.env`/`.env.local` present locally (only `.env.example`). `node_modules`
installed cleanly but `DATABASE_URL` is still absent, so
`npm run check:category-integrity` still needs reproducing by hand — see
`answer-leak-domain-drift-plan.md`'s 2026-10-03 entry (reviewed the same
session) for the full verdict (`ok`, no hard failures) and detail; not
repeated here since the check is shared across all four diagnosis docs.

**`quality`'s `failed_open` on the trailing-14-day `scope='daily_build'`
window moves off zero for the first time since this doc started tracking
it.** Re-queried `batch_dedup` / `recent_history` / `quality`:

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 405 | 43 | 6 |
| `batch_dedup` | 405 | 23 | **25** |
| `quality` | 405 | 154 | **1** |

`quality`'s `failed_open` was 0 on every prior reading of this window; it
is now 1. Traced to a specific day: `day=2026-10-02, scope=daily_build,
considered=61, dropped=22, failed_open=1` — the same single event
`answer-leak-domain-drift-plan.md`'s 2026-10-03 entry (reviewed the same
session) found and discusses in more depth; not re-analyzing it twice, but
recording it here since this doc also watches the shared `quality` gate's
health. `batch_dedup`'s `failed_open` ticked up again, 23→25 — a fourth
consecutive above-usual rise on this rolling window, still not
root-caused. `recent_history`'s `failed_open` ticked up slightly, 5→6.
`quality`'s scoped drop rate (38.0%) stays inside the acceptable band.

**`#1702` dispute queue: no new activity.** `GradeDispute` status counts
(all-time): `pending` 48 (unchanged), `alternative_added` 32 (unchanged —
no new resolution since yesterday's one), `dismissed` 5 (unchanged).

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0 of 359** newly-generated rows
missing it (up from the prior count, still clean).

**Build-time p50 (trailing 14 days, `outcome='built'`, `user_visible_ms`):
35,292ms** (n=39), essentially flat vs. the last reading (35,337ms, n=37).
Cross-checked against `daily-build-latency-deferral-plan.md`'s 2026-10-03
entry (read, not re-derived): that doc's outlier/elevated-residual cluster
stayed at 19 of 56 (34%) with two new outliers entering as others dropped
out of the trailing window (see that doc for the detail, including two
previously-tracked rows that vanished from `DailyBuildMetric` entirely —
same cascade-delete shape as the 2026-09-06 "Rue Prova" incident). The
standing explanation for the elevated p50 (the untraced outlier cluster)
is unchanged.

**No code change since the last review** to this doc's own tracked files
(`verification-gating.test.ts`, `check-question-lifecycle.mjs`,
`src/server/llm/recheck.ts`, `src/server/db/queries/grade-disputes.ts`,
`src/server/db/queries/write-mastery-event.ts`) — `git log --since=2026-10-02`
shows two commits (`#1741`, `#1742`), neither touching any of the five.

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (revised)
1. Decision 4 still needs Phase 4's labeled set — unchanged, still no
   human-reviewed dispute in the data.
2. Once the outlier builds are traced (per the cross-referenced doc),
   re-check whether this doc's build-time p50 recovers.
3. **New:** watch whether `quality`'s rolling-window `failed_open` (now 1,
   first movement off zero) recurs or stays isolated.
4. Keep an eye on `batch_dedup` `failed_open` (25/405, fourth consecutive
   above-usual rise) and `recent_history` (6/405, ticked up slightly) on
   the rolling 14-day window.
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-10-04 (diagnosis-review) — no dispute-queue activity; `batch_dedup`/`recent_history` failed_open both tick up; build p50 continues climbing; `subject_entity` coverage holds; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.
`node_modules` installed cleanly but `DATABASE_URL` is still absent, so
`npm run check:category-integrity` still needs reproducing by hand — see
`answer-leak-domain-drift-plan.md`'s 2026-10-04 entry (reviewed the same
session) for the full verdict (`ok`, no hard failures, orphan-edge check
cross-validated directly this time) and detail; not repeated here since
the check is shared across all five diagnosis docs now.

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 440 | 47 | **8** |
| `batch_dedup` | 440 | 23 | **28** |
| `quality` | 440 | 169 (38.4%) | 1 |

`recent_history`'s `failed_open` ticked up 6→8 on this rolling window.
`batch_dedup`'s ticked up again, 25→28 — a fifth consecutive above-usual
rise, still not root-caused, same "flagging for awareness" posture as
every prior entry. `quality`'s `failed_open` holds flat at 1 (the single
2026-10-02 `daily_build`-scope event is still inside the trailing 14-day
window; no new occurrence). `quality`'s scoped drop rate (38.4%) stays
inside the acceptable band.

**`#1702` dispute queue: no new activity.** `GradeDispute` status counts
(all-time): `pending` 48 (unchanged), `alternative_added` 32 (unchanged),
`dismissed` 5 (unchanged) — byte-identical to yesterday.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0** newly-generated rows missing it
since that timestamp, re-queried directly.

**Build-time p50 (trailing 14 days, `outcome='built'`, `user_visible_ms`):
37,351.5ms** (up from 35,292ms last review) — continuing to climb, well
above the 25,243ms pre-deploy baseline. Cross-checked against
`daily-build-latency-deferral-plan.md`'s 2026-10-04 entry (read, not
re-derived): that doc's outlier/elevated-residual cluster grew again today
(19→20 of 60 post-deferral rows, share essentially flat at ~⅓), including
one new outlier from the 2026-10-03 cron. The standing explanation for the
elevated p50 (the untraced outlier cluster) is unchanged.

**No code change since the last review** to this doc's own tracked files
(`verification-gating.test.ts`, `check-question-lifecycle.mjs`,
`src/server/llm/recheck.ts`, `src/server/db/queries/grade-disputes.ts`,
`src/server/db/queries/write-mastery-event.ts`) — the only commits since
the last review are `#1743`/`#1744` (bank-difficulty-loosening, reviewed
in its own new doc today) and two unrelated "Cassian" pilot commits, none
touching any of the five.

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (revised)
1. Decision 4 still needs Phase 4's labeled set — unchanged, still no
   human-reviewed dispute in the data.
2. Once the outlier builds are traced (per the cross-referenced doc),
   re-check whether this doc's build-time p50 recovers.
3. Watch whether `quality`'s rolling-window `failed_open` (flat at 1) stays
   isolated or recurs again.
4. Keep an eye on `batch_dedup` `failed_open` (28/440, fifth consecutive
   above-usual rise) and `recent_history` (8/440, ticked up again) on the
   rolling 14-day window.
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-10-05 (diagnosis-review) — no dispute-queue activity; `batch_dedup`/`recent_history` failed_open both ease on the rolling window; build p50 essentially flat; `subject_entity` coverage holds; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.
`node_modules` installed cleanly (`npm ci`, `tsx` resolves this session),
but no `.env`/`.env.local` is present, so `npm run check:category-integrity`
still needs reproducing by hand — see
`answer-leak-domain-drift-plan.md`'s 2026-10-05 entry (reviewed the same
session) for the full verdict (`ok`, no hard failures, cross-validated
directly in SQL this time rather than only through the hand-copied JSON)
and detail; not repeated here since the check is shared across all five
diagnosis docs.

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 440 | 48 | **7** |
| `batch_dedup` | 440 | 23 | **27** |
| `quality` | 440 | 169 (38.4%) | 1 |

Both counters eased slightly on this rolling window — `recent_history`'s
`failed_open` 8→7, `batch_dedup`'s 28→27 — the first easing either has
shown in several reviews. This is the rolling-window behavior the doc
already names (a high-`failed_open` day rolling out of the 14-day window
lowers the count even with no new data), not evidence the underlying rate
improved; `considered` is unchanged at 440, consistent with no new
`daily_build`-scope day having landed yet today. `quality`'s `failed_open`
holds flat at 1 (the 2026-10-02 event stays the only one in the window).
`quality`'s scoped drop rate (38.4%) stays inside the acceptable band.

**`#1702` dispute queue: no new activity.** `GradeDispute` status counts
(all-time): `pending` 48 (unchanged), `alternative_added` 32 (unchanged),
`dismissed` 5 (unchanged) — byte-identical to the last four readings. Latest
`reviewed_at` across the whole table is still the 2026-09-27 automated-
recheck timestamp; no human-review activity since.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0** newly-generated rows missing it
since that timestamp, re-queried directly.

**Build-time p50 (trailing 14 days, `outcome='built'`, `user_visible_ms`):
37,297ms** (down slightly from 37,351.5ms last review) — essentially flat,
still well above the 25,243ms pre-deploy baseline. Cross-checked against
`daily-build-latency-deferral-plan.md`'s 2026-10-05 entry (read, not
re-derived): two new built rows landed from the 2026-10-04 cron, neither a
new outlier (one sat just under the 15,000ms threshold, the other was the
established "large bonus itself" shape) — the outlier share eased slightly
(33.3%→32.3%) rather than growing. The standing explanation for the
elevated p50 (the untraced outlier cluster) is unchanged.

**No code change since the last review** to this doc's own tracked files
(`verification-gating.test.ts`, `check-question-lifecycle.mjs`,
`src/server/llm/recheck.ts`, `src/server/db/queries/grade-disputes.ts`,
`src/server/db/queries/write-mastery-event.ts`) — all seven commits since
the last review are "Cassian" work (a new, unrelated admin review tool),
confirmed by diffing each commit's file list directly.

**No decision-resolving change to the six items in §2.** Status stays
`active`.

### Next steps (unchanged)
1. Decision 4 still needs Phase 4's labeled set — unchanged, still no
   human-reviewed dispute in the data.
2. Once the outlier builds are traced (per the cross-referenced doc),
   re-check whether this doc's build-time p50 recovers.
3. Watch whether `quality`'s rolling-window `failed_open` (flat at 1) stays
   isolated or recurs again.
4. Keep an eye on `batch_dedup` `failed_open` (27/440, eased slightly on
   the rolling window) and `recent_history` (7/440, eased slightly) — the
   doc's own rolling-window caveat applies, not a reversal of the trend.
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-10-06 (diagnosis-review) — first new `GradeDispute` submission in days (pending 48→49), but still no human-review activity; `batch_dedup`/`recent_history` failed_open tick up again; build p50 eases; `subject_entity` coverage holds; no new code

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session.
`node_modules` installed cleanly (`npm install`), but no `.env`/`.env.local`
is present, so `npm run check:category-integrity` still needs reproducing
by hand — see `answer-leak-domain-drift-plan.md`'s 2026-10-06 entry
(reviewed the same session) for the full verdict (`ok`, no hard failures)
and detail; not repeated here since the check is shared across all five
diagnosis docs.

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 450 | 48 | 7 |
| `batch_dedup` | 450 | 23 | 27 |
| `quality` | 450 | 173 (38.4%) | 1 |

`considered` rose 440→450 (one new day's worth of `daily_build`-scope
traffic entering the trailing window) while `recent_history`'s and
`batch_dedup`'s `failed_open` held exactly flat (7 and 27) — the new day
added no fresh failed-open events on either counter. `quality`'s
`failed_open` also holds flat at 1 (the 2026-10-02 event remains the only
one in the 14-day window). `quality`'s scoped drop rate (38.4%) stays
inside the acceptable band, unchanged from the last reading.

**`#1702` dispute queue: first new submission since this doc started
tracking day-to-day — but not new resolution activity.** `GradeDispute`
status counts (all-time): `pending` **49** (up from 48), `alternative_added`
32 (unchanged), `dismissed` 5 (unchanged). The new row (`1a72813a-…`,
created 2026-10-05T17:14:13Z) is a Batman "Victor Freeze" vs. "Victor
Fries" dispute — already carries an automated `review_decision='reject'`
("'Freeze' is the villain's codename, so 'Victor Freeze' is a different
name rather than a valid alternate spelling") but `reviewed_at` is still
`null`, so it sits in the `pending` bucket pending whatever confirms an
automated reject into a terminal status, same shape as the other
unresolved `pending` rows already in the queue. **No human-review
activity**: `max(reviewed_at)` across the whole table is still
2026-10-02T00:17:52Z (the Meredith Willson "piccolo" automated
self-resolution) — correcting a discrepancy in some prior entries' wording
("still the 2026-09-27 automated-recheck timestamp"), which was already
stale by the time it was written; the actual latest `reviewed_at` has been
2026-10-02's event since that date, not 2026-09-27. Not pursuing the
correction further — doesn't change decision 4's standing (still no
human-reviewed dispute to build Phase 4's labeled set from).

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0** newly-generated rows missing it
since that timestamp, re-queried directly.

**Build-time p50 (trailing 14 days, `outcome='built'`, `user_visible_ms`):
36,317ms** (n=44, down from 37,297ms at n≈39 last review) — easing
slightly but still well above the 25,243ms pre-deploy baseline. Cross-
checked against `daily-build-latency-deferral-plan.md`'s 2026-10-06 entry
(read, not re-derived): that doc's outlier/elevated-residual share also
eased slightly (32.3%→31.7%), and its own headline finding this
pass — a third `deferred: false` row — is unrelated to this doc's p50
reading. The standing explanation for the elevated p50 (the untraced
outlier cluster) is unchanged.

**No code change since the last review** to this doc's own tracked files
(`verification-gating.test.ts`, `check-question-lifecycle.mjs`,
`src/server/llm/recheck.ts`, `src/server/db/queries/grade-disputes.ts`,
`src/server/db/queries/write-mastery-event.ts`) — `git log --since=2026-10-05`
on all five returns nothing.

**No decision-resolving change to the six items in §2.** Status stays
`active`. The new `GradeDispute` submission is a data point, not a
resolution — decision 4 remains exactly where it was.

### Next steps (revised)
1. Decision 4 still needs Phase 4's labeled set — unchanged, still no
   human-reviewed dispute in the data (the new 2026-10-05 submission is
   pending, not reviewed).
2. Once the outlier builds are traced (per the cross-referenced doc),
   re-check whether this doc's build-time p50 recovers.
3. Watch whether `quality`'s rolling-window `failed_open` (flat at 1) stays
   isolated or recurs again.
4. Keep an eye on `batch_dedup` `failed_open` (27/450, flat) and
   `recent_history` (7/450, flat) on the rolling 14-day window.
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.

### 2026-10-07 (diagnosis-review) — `batch_dedup` `failed_open` ticks up by one (27→28), first movement on that counter in several reviews; no dispute-queue or human-review activity; build p50 keeps easing; no new code

**Environment note:** fresh container this session — `node_modules`
absent at start, `npm install` ran clean. No `.env`/`.env.local` present.
Live, read-only Supabase MCP connection to the production project
(`grixooyecvnugpxvcbct`) available. `check:category-integrity` reproduced
by hand this session — see `answer-leak-domain-drift-plan.md`'s
2026-10-07 entry (same session) for the full verdict (`ok`, no hard
failures, same soft-finding shape as every prior reading); not repeated
here since the check is shared across all five diagnosis docs.

**`batch_dedup` / `recent_history` / `quality`, re-queried (trailing 14
days, `scope='daily_build'`):**

| gate | considered | dropped | failed_open |
|---|---:|---:|---:|
| `recent_history` | 455 | 48 | 7 |
| `batch_dedup` | 455 | 23 | **28** |
| `quality` | 455 | 177 | 1 |

`considered` rose 450→455 (one new day's worth of `daily_build`-scope
traffic entering the trailing window). `recent_history`'s `failed_open`
holds flat at 7; `quality`'s holds flat at 1 (the 2026-10-02 event is
still the only one in the window). **`batch_dedup`'s `failed_open` ticked
up by one (27→28)** — the first movement on this specific counter since
this doc started watching it for recurrence. One event in a trailing
14-day window that already carries 27 isn't a new pattern on its own (this
counter has shown single-digit `failed_open` noise before), but flagging
it plainly since the next-steps item explicitly asked to watch for
exactly this. Not tracing the individual event further this pass (would
need to correlate against `LlmUsageEvent`/Vercel logs for the specific
day, same tooling gap noted elsewhere in this doc).

**`#1702` dispute queue: no new submission, no new resolution activity.**
`GradeDispute` status counts (all-time): `pending` **49** (unchanged since
2026-10-05's new submission), `alternative_added` 32 (unchanged),
`dismissed` 5 (unchanged). `max(reviewed_at)` across the whole table is
still **2026-10-02T00:17:52.816Z** — no human review since then. Decision
4 (Phase 4's labeled set) remains exactly where it was.

**`subject_entity` coverage holds at 100%** since `#1698`'s hard
requirement (2026-09-16T22:07:16Z): **0** newly-generated rows missing it
since that timestamp, re-queried directly.

**Build-time p50 (trailing 14 days, `outcome='built'`, `user_visible_ms`):
35,337ms** (n=45, down slightly from 36,317ms at n=44 last review) —
continuing to ease, still well above the 25,243ms pre-deploy baseline.
Cross-checked against `daily-build-latency-deferral-plan.md`'s 2026-10-07
entry (read, not re-derived): that doc's outlier/elevated-residual share
holds flat at 32.3% and its headline finding this pass (a new #2
all-time-high residual, 64.4s) is unrelated to this doc's p50 reading. The
standing explanation for the elevated p50 (the untraced outlier cluster)
is unchanged.

**No code change since the last review** to this doc's own tracked files
(`verification-gating.test.ts`, `check-question-lifecycle.mjs`,
`src/server/llm/recheck.ts`, `src/server/db/queries/grade-disputes.ts`,
`src/server/db/queries/write-mastery-event.ts`) — `git log` on all five
between the last-reviewed commit and today's `main` head returns nothing
(the only new commit, `#1755`, is the unrelated Save-button removal).

**No decision-resolving change to the six items in §2.** Status stays
`active`. The `batch_dedup` tick is a data point to watch, not a
resolution.

### Next steps (unchanged)
1. Decision 4 still needs Phase 4's labeled set — unchanged, still no
   human-reviewed dispute in the data.
2. Once the outlier builds are traced (per the cross-referenced doc),
   re-check whether this doc's build-time p50 recovers.
3. Watch whether `quality`'s rolling-window `failed_open` (flat at 1) stays
   isolated or recurs again.
4. **Watch closely:** `batch_dedup` `failed_open` just moved for the first
   time (27→28/455) — see if it recurs again next review or was a one-off.
   `recent_history` stays flat (7/455).
5. Everything else (Phase 3 verification-hold decision, Phase 4 labeled
   set, decision 5 cost link) unchanged.
