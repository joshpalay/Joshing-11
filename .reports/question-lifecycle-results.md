# Question lifecycle results

Date: 2026-09-09

Status: implementation and local verification complete. No production traffic or production data was changed.

## Baseline we can use

The baseline below was collected before implementation. It is anonymized and aggregate-only.

| Measure | Before-change baseline | Strength of baseline |
|---|---:|---|
| Offline meaningful-symbol grading cases | 4 of 8 correct | Strong for these eight exact cases; invented cases |
| Recent new-build player-visible time | median 25.243 s; p95 53.8202 s; max 59.095 s | Small sample: 9 builds in 14 days |
| Recent measured builds reaching target size | 9 of 9 | Small sample |
| Recent bank attempts | 65 hits; 33 misses | Useful directional baseline |
| Recent grading model time | median about 1,014 ms; p95 about 1,423.5 ms | 91 calls |
| Recent grading model estimated cost | about $0.125 total; about $0.0014/call | 91 calls |
| Recent generation estimated cost | about $3.767 | 59 calls; not yet divided cleanly by played question |
| Recent quality-gate estimated cost | about $2.0134 | 364 calls; contaminated by maintenance traffic |
| All-time grade disputes | 24 accepted alternatives; 36 rejected; 3 needing human review | Real cases, but too few for a stable error rate |
| Live generated rows missing subject | 730 of 2,202 | Strong database count |
| Live generated rows missing embedding | 1,211 of 2,202 | Strong database count |
| Linked copies with different answers | 51 of 760 | Strong drift count; some differences may be intentional |
| `ok` verified rows still marked unverified | 660 | Strong database count |

The repeatable 14-day check currently reports 194 unsuppressed generated rows. Of those, 162 lack `subject_entity`, 162 lack an embedding, 4 have an `ok` verdict but an `unverified` trust tier, and 1 has a later `unverifiable` verdict. These recent counts are the cleanest post-deploy baseline for the metadata and trust changes.

## Deterministic before-and-after result

Command:

```text
npm run eval:question-lifecycle
```

The command is offline. It uses invented examples. It sends no model request and reads no player data.

| Case | Old behavior | New behavior | Expected |
|---|---|---|---|
| `tosca` / `Tosca` | match | match | match |
| `The Beatles` / `Beatles` | match | match | match |
| `Beyonce` / `Beyoncé` | match | match | match |
| `Spider Man` / `Spider-Man` | match | match | match |
| `C` / `C++` | match | no match | no match |
| `C major` / `C# major` | match | no match | no match |
| `5` / `-5` | match | no match | no match |
| `1 5` / `1.5` | match | no match | no match |

Result: the old normalizer passed 4 of 8 cases. The new normalizer passed 8 of 8. This proves the four known false-positive collisions are fixed. It does not prove general grading accuracy.

## Automated checks run so far

- Focused question-lifecycle tests: 136 passed.
- Full test suite: 703 files passed and 6 skipped; 5,455 tests passed and 72 skipped.
- TypeScript type check: passed.
- Lint: passed with 0 errors and 5 existing warnings in unrelated files.
- Production build: passed.
- Offline grading comparison: passed 8 of 8 current cases.
- Read-only aggregate lifecycle check: ran successfully against the configured database.
- Existing gate-flag diagnostic: ran successfully. Its current sample is too small for a conclusion, and it correctly warns that old gate data still mixes maintenance work until migration `0145` is deployed.

The formatter-only diff was removed before these final checks. `git diff --check` also passed.

## How each update will be tracked

| Update | Signal | Healthy result |
|---|---|---|
| Safer deterministic grading | `reason_code` in grading logs; grading model call count | No known symbol collisions; exact matches avoid model calls |
| Accepted alternatives | Grade disputes and stored alternative counts | Fewer repeated accepted appeals for the same question and answer |
| Linked-copy synchronization | Periodic anonymized drift query | Answer and alternative drift moves toward zero |
| Bank metadata preservation | Missing `subject_entity` and embedding counts on new copies | New bank copies keep both fields |
| Structured generation contract | Generation retry/rejection logs and queue completeness | Invalid rows are rejected without increasing short Daily Fives |
| Explicit check state | Invalid/unavailable gate logs and failed-open counters | Malformed replies are visible instead of looking like clean passes |
| Verification serving policy | Shadow `wouldFilter` count | Enough eligible stock exists before enforcement is enabled |
| Gate cost accuracy | `GateDropStat.scope` | Player-build totals exclude maintenance and audit work |
| Queue concurrency safety | `slot_changed` responses | Conflicts are rare and no newer slot array is overwritten |
| Retry ownership | Grading calls per submitted answer | No server retry multiplied by browser retries |
| Honest topic provenance | Onboarding rendering test | Catalog additions always show “From Joshing” |
| Speed and cost | Existing build and LLM usage events | No material regression in p50/p95 build time or cost per build |

Run this read-only check against the configured database:

```text
npm run check:question-lifecycle
```

It prints aggregate counts and timings only. It does not print names, contact details, player answers, question text, or stored answer text. It also makes no model calls.

## What still cannot be claimed

- Question interestingness has not yet been shown to improve with a blinded human rating.
- Factual accuracy has not yet been measured on a large labeled sample.
- Overall grading false-positive and false-negative rates are unknown because there is no large labeled answer set.
- Cost per played question is still incomplete. The new scope fixes one source of contamination, but a final played-slot attribution is still missing.
- No live model comparison was run. That would spend money and was deliberately left as an opt-in evaluation.

## Recommended check windows after release

1. Check the first 24 hours for invalid model replies, short Daily Fives, queue conflicts, and grader outages.
2. Compare seven days before and after for bank hit rate, build p50/p95, model calls per build, disputes, and missing metadata on newly created rows.
3. Review after 14 days before enabling either trust-tier enforcement or the `unverifiable` hold.
4. Build a blinded, labeled set from future disputes and staff-reviewed generated questions. Keep player text private and store only approved evaluation labels.

## Rollback signals

- Revisit strict `fact_key` and `question_shape` validation if queue completion drops materially and retries cannot recover. Missing subject and sub-angle metadata is only logged for now, because the baseline showed that enforcing it immediately could starve the Daily Five.
- Leave `VERIFICATION_UNVERIFIABLE_HOLD_ENABLED` off if shadow counts show that it would starve topics.
- Revert compare-and-set behavior if conflict responses are common; investigate the writer causing concurrent queue changes first.
- Revert the grading matcher only if the protected-symbol tokens create a demonstrated new collision. None appeared in the current eight-case set.
