# Cassian targeted review: results

October 11, 2026. The owner explicitly approved the frozen eight-call comparison and saved-question/source transfer to Anthropic after the earlier approval block. All eight calls completed for **$0.133870**, below the $0.75 ceiling. The [prepared flow](TARGETED-REVIEW.md) and [reserve accounting](UNCERTAIN-RESERVE.md) merged in [#1773](https://github.com/joshpalay/Joshing-11/pull/1773) and [#1774](https://github.com/joshpalay/Joshing-11/pull/1774).

**This pipeline is not ready for a live writer trial.** Fresh quality review cleared two known false holds, but neither whole card could pass because its saved passage lacked factual coverage. The combined flow passed only two previously source-audited usable cards, passed one card needing an explanation correction, and left fifteen attempts unresolved. The next experiment should improve evidence supplied to writing and verification before adding more judge votes.

## Outcomes on the frozen cohort

All 24 original writer attempts, 22 owner ratings, two novelty exclusions and original attempt costs were retained. Quality review covered seven original holds plus four deterministically sampled passes; source verification covered all 22 eligible cards. Both reviewers used `claude-sonnet-5-5`, with unchanged prompts/request hashes, a 3,000-token response limit, 30-second timeout and zero retries. All responses ended normally; no malformed, truncated, missing-ID or invented-quotation response was accepted.

The table uses the frozen, previously reconciled source-Keep plus novelty label. Owner Good remains an appeal rating. A non-Keep pass is a card needing revision/rejection under that audit, not automatically a proved false answer.

| Writer / flow | Original attempts | Prior usable cards passed | Also owner Good | Non-Keep passes | Usable cards held | Usable cards unresolved | All unresolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sonnet / baseline | 12 | 3 | 3 | 2 | 1 | 0 | 0 |
| Sonnet / candidate | 12 | 0 | 0 | 0 | 0 | 4 | 7 |
| Haiku / baseline | 12 | 4 | 3 | 3 | 1 | 0 | 0 |
| Haiku / candidate | 12 | 2 | 2 | 1 | 0 | 3 | 8 |

Candidate totals: **3 passes, 6 holds, 15 review-required**. Two holds are the existing novelty exclusions; four come from quality review. No source reviewer returned a contradiction: across 66 question/answer/explanation assessments, 15 were supported and 51 unknown. Withholding a flawed card because evidence is absent is different from detecting its actual error. Seven of nine prior usable cards remained unresolved, so zero usable-card holds does not mean successful recovery.

## Human audit of reasons

Every fresh quality assessment and all source assessments were read against the frozen question, prompt and supplied passage. Exact quotations passed mechanical membership checks; that checks text presence, not truth or entailment. Labels and automated scores remain frozen, with the human audit saved separately.

- **Two genuine quality false holds cleared.** Context/translation clues no longer became alleged answer disclosure. Both final cards still require evidence; neither was released.
- **One bad role description was correctly held for its real defect.** This replaces an earlier invented answer-leak reason. A genuinely printed answer was also held correctly.
- **Three of eleven fresh quality reasons remain unsound under the retained rubric.** A surname/epithet was again treated as supplying an unstated full name, an interpretive/vague ask was approved, and an exact-word quotation question was held for fame/ease despite the prompt's explicit protection for exact wording. The epithet case retains its old-policy sensitivity. A whole card needing revision does not validate an unrelated quality reason.
- **One known explanation correction still passed.** The reviewer cited a merger passage but approved wording implying that a predecessor league merged into an already-existing successor. The supplied passage described the two predecessors forming that successor. Correct answer support did not ensure correct explanation support.
- **Supported fields sometimes waived coverage.** On three cards, the reviewer acknowledged an unprovided descriptive or explanatory claim while marking the field supported. One of these was a prior usable card that passed; the other two remained unresolved. This is a source-contract failure, not proof that those waived claims are false. One of the two gold-usable passes therefore still has a questionable automated evidence certificate.
- **Evidence gaps dominate.** Broad cached topic summaries omit many named facts, scenes and explanation details. Some saved source text also repeats a claim already disputed in the earlier audit. More reviewers reading the same incomplete or flawed packet cannot establish independent truth.

The private audit distinguishes factual uncertainty, reason validity and final card disposition. The same reviewer prepared the experiment and audited these development cases; this is not an independent blind holdout, and correlated model judgments are not independent evidence.

## Cost and latency

These are all-attempt modeled pipeline costs, retaining writer/cheap-quality cost for exclusions and replacing historical factual checking with the measured source review plus targeted quality review. Mixed-batch review cost is allocated by reviewed item count. Source retrieval was reused at zero new cost; replacement generation, normal history checks and grading are absent.

| Writer / flow | Attributed cost | Cost / prior usable card passed | Mean modeled core time |
| --- | ---: | ---: | ---: |
| Sonnet / baseline | $0.329643 | $0.109881 | 6.00 s |
| Sonnet / candidate | $0.337999 | Undefined: zero | 11.49 s |
| Haiku / baseline | $0.136709 | $0.034177 | 7.29 s |
| Haiku / candidate | $0.145976 | $0.072988 | 14.03 s |

Across writers, modeled cost rose from $0.466352 to $0.483976 while prior usable passes fell from seven to two. The smaller Haiku figure is not a validated deployment saving: one non-Keep card passed, evidence coverage still failed on a nominally usable pass, and unresolved cards/replacements have not been priced. These totals reuse historical calls rather than charging them again; the actual incremental experiment charge is $0.133870. The frozen historical Haiku costs differ from an earlier report by $0.0000005 due to stored cost precision.

Core time models writer plus the slower of quality/escalation and factual paths. Actual reviewer calls ran serially for recovery; their elapsed times totaled 50.126 s. Neither value measures cold topic-to-first-ready time or a deployed parallel pipeline. No monthly saving is established.

## Recovery, privacy and budget

Completed resume reported **zero new provider calls**, and read-only ledger checks before/after found unchanged spending and an identical old-run accounting snapshot. All eight trial calls are settled, with zero reservation for this run. The older failed structured-output call remains uncertain and halted with its full **$0.02** reservation; it was not retried, settled or released. Lifetime totals are **$4.110187 spent, $0.02 reserved, $5.869813 available** under the unchanged $10 cap. These are response-token price estimates and ledger reservations, not invoice reconciliation.

Free saved-reply scoring and quotation/ID checks reproduce the results. The underlying flow/accounting changes had 39 focused tests plus TypeScript/lint checks before execution; this follow-up changes documentation only. No new owner ratings, candidate publication, bank promotion, gameplay write, migration, production prompt/model switch or deployment is part of this result.

Private run: `_scratch/Cassian/cassian-targeted-review-v1-2026-10-11/`. Frozen manifest SHA-256: `1ee7dd22df2d79964e06be684fa19acd5016e6cc18b4bb77fce466b9cae03690`. Provenance, checkpoint, per-item human audit, source references, scores, code snapshot and final/resume ledger proofs remain ignored. Public reporting contains aggregates only.

## Next action

First audit claim coverage using the saved artifacts at zero model cost. Define a passage-backed contract: preserve source identity and exact passages for each requested fact and explanation claim; constrain the writer to those claims; leave absent evidence unresolved rather than allowing the checker to fill it from memory. Test this on both sound controls and the known explanation failures. A repair is a new draft, not retroactive acceptance of an original card.

Only after that contract works, freeze a small source-complete evaluation with some genuinely unseen cases and measure whole-pipeline yield, topic coverage, retrieval/replacement costs and cold ready time. Keep the cheap screen plus selective quality escalation as a candidate, not a reliability guarantee. Production writer/gates remain unchanged. Owner review is complete; no further card ratings or repeat of these eight calls is needed.
