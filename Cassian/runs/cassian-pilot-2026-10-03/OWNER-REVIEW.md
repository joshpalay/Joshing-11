# Cassian pilot: owner review and source adjudication

Updated 2026-10-04. This is an aggregate report for the fixed 12-topic, 24-candidate pilot. Candidate text, declared topic names, answer submissions, notes, and source-by-source adjudication remain in ignored private working files; the repository is public. The independent audit examined all 24 original snapshots against external sources, including candidates that the machine held or the admin never saw.

## Review completion and interpretation

The admin was shown 23 cards and answered all 23. Twenty-two have an overall rating: **20 Good, 1 Reject, 1 Unsure**. The remaining answered card was the malformed Placeholder-key item previously reported and excluded from future allocation; do not request a rating for it. One pilot candidate was not shown under the allocation/novelty rules. The optional panel-note control was used once for a candidate correction, not for an actual missing-topic report.

| Writer | Cards shown | Rated Good | Independently keep as written | Revise | Reject |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sonnet 5.5 baseline | 12 | 10 | 8 of 12 | 1 of 12 | 3 of 12 |
| Haiku 4.5 candidate | 11 | 10 | 5 of 12 | 3 of 12 | 4 of 12 |

The owner was rating the experience of answering each question and explicitly said they could not verify every explanation. **Good is not a factual-accuracy verdict.** Among the 20 Good ratings, independent review found 12 keep, 4 needing revision, and 4 invalid as written. This is useful evidence that the questions were appealing, and equally strong evidence that human appeal ratings cannot replace source checks.

Of the 10 candidates the implemented core gates passed, source review found 8 keep and 2 revise, with no reject. Of the 14 held candidates, review found 5 keep, 2 revise and 7 reject. Thus the gates caught real errors but also held sound questions. A gate's written reason can itself be wrong; the owner's `Pass/Revise/Reject/Unsure` choice is a disposition opinion, not source verification. The current label “Was the machine gate right?” conflates those two ideas. Before another review batch, make the choices and any correction-note path clearer; one correction was saved in the generic panel-note control.

## Cost per audited usable question

For this fixed pilot, split the single source retrieval for each topic equally between its two writer arms; assign each arm its own writer and quality/factual-gate costs. This is an accounting allocation for a paired writer test, not a forecast for cold independent runs. A **keep** is an independently source-checked candidate usable as written; revise and reject do not count as usable.

| Writer | Shared-source allocation | Writer + gates | Total allocated | Audited keeps | Cost per audited keep |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sonnet 5.5 | $0.659614 | $0.356019 | $1.015633 | 8 | **$0.1270** |
| Haiku 4.5 | $0.659614 | $0.224766 | $0.884380 | 5 | **$0.1769** |

Haiku's writer calls alone cost less, but its lower usable yield made it **more expensive per audited keep in this pilot**. The sample is only 12 topics per arm, so this is a reason **not to switch production writers yet**, not proof that Sonnet will always win. These figures exclude later answer grading and the separate no-explanation gate replay; those are Cassian follow-up costs, not costs of creating the original 24 candidates.

## Decision and next measurement

Keep the production writer and no-repeat/quality gates unchanged. The completed review does not justify a Haiku switch, removal of the factual gate, or ordinary-player exposure of Cassian questions. Explanation-only recovery exists, but the saved-question replay found one source-confirmed case; another newly passed item still had a bad premise. A prospective answer-only creation test remains an option, with its fixed-usable-target replacement metric defined in [EXPLANATION-YIELD.md](../../EXPLANATION-YIELD.md).

Prioritize a **read-only bank-supply and reuse analysis** next, because the owner's $5/month goal depends more on avoiding entire generation, source, and gate cycles than on saving writer-output tokens. Measure eligible unused stock by topic and tier, answered-out facts, cross-player reuse, fresh generation calls per built Daily Five, and how these change after the deployed bank difficulty rule. `DailyBuildMetric` must be filtered to actual built queues. A larger bank saves ongoing money only to the extent that existing questions are reused across players or replenished more cheaply; moving the same generation to an earlier time is not a saving. Then decide whether the remaining Cassian budget is best spent on answer-only creation or reference retrieval reuse. Do not mix those arms in one comparison.

The live Cassian ledger at the review snapshot recorded **$2.059577 spent, $0 reserved**, leaving **$7.940423** of the authorized $10. That includes the original pilot, the bounded no-explanation factual-gate replay, and answer grading. These are internal list-price estimates, not provider invoices. No additional paid follow-up is authorized beyond the same remaining cap.
