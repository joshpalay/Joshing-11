---
name: question-lifecycle-quality-plan
status: active
opened: 2026-09-09
last-reviewed: 2026-09-09
owner: Josh
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
