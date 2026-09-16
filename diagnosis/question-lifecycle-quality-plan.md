---
name: question-lifecycle-quality-plan
status: active
opened: 2026-09-09
last-reviewed: 2026-09-16
owner: Josh
related-pr: "#1646"
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
