# Cassian bounded source-review cost screen

October 15, 2026. **Adopt nothing from this experiment.** The proposed reference failed its one allowed compatibility check. Stop this approach here; do not tune and rerun it. The compact response format was frozen but never dispatched, so actual format savings remain unknown. No production, bank, serving, gameplay or environment changes were made.

This closes the bounded task proposed in [SOURCE-REVIEW-NEXT.md](SOURCE-REVIEW-NEXT.md). It starts from main `567e124882ac783fbf04a251763f10bbb01d4f4e`; no later completed comparison or working reference was found. The unrelated original checkout and other worktrees were preserved. [Machine-readable metrics](compact-cost-metrics.json) accompany this report.

## Reference result

The reference used the existing v4 whole-card reconstruction prompt and schema, with the approved equivalent-answer policy supplied as input. It inspected question, answer, every variant and explanation independently of writer inventories. Existing Zod validation, exact-quote location and mechanical binding were reused; models did not calculate offsets. Later offline semantic contracts still depend on reviewed identities and relations, so those manual contracts were not substituted for model success.

The seven saved compatibility cases contained two sound controls and five challenges. They are development material, never unseen examples. One separate AI reviewer received only raw cards, passages, empty history and the approved rubric, without machine judgments or desired outcomes. That reviewer retained two, requested four revisions and left one formation/continuity interpretation unresolved. This is **separate AI review, not human verification**. A canonical full-name completeness question also remains noted separately; the surname-only variant defect is common ground. Unresolved policy was retained rather than relabeled to improve results.

| Frozen requirement / observation | Result |
| --- | ---: |
| Responses parsing and mechanically binding | 7/7 |
| Field records / claim records | 28 / 35 |
| Sound controls retained / falsely held | 2/2 / 0 |
| Unambiguous challenge cards held | 4/4 |
| Unambiguous challenges with every required correct reason | 3/4 |
| Determinate cases with complete correct judgments and reasons | 5/6 |
| Unsupported chronological claim endorsed | 1 |
| Policy-unresolved cards passed without preserving uncertainty | 1 |
| Required evidence gaps | 2, within 1 card |
| Material claim omissions observed | 0 |
| Truncated / nonfinal responses | 0 / 0 |

An overall hold masked a distinct unsupported temporal judgment. The unresolved relationship was also silently reformulated, and evidence did not establish two asserted qualifiers. These are semantic/evidence failures despite valid JSON and real located quotations. There were zero whole-card unsafe passes among the four unambiguous challenges, but one pass under unresolved policy; under the preserved historical precise-formation interpretation, that is one unsafe pass. Neither interpretation rescues the independent chronology failure. Correct rejection alone is insufficient.

The compatibility gate therefore failed. No six-base unseen evaluation was prepared or run. Its conditional design required two broad, two niche and two very narrow bases, three sound cards and three defects, with related variants grouped. Preparing those cards after the failed prerequisite would not answer the authorized comparison. No saved material was relabeled unseen, no prompt changed after outputs, and no additional reviewer was recruited.

## Format, usage and accounting

Both formats were frozen before compatibility inference: the compact schema pools distinct source quotations and references them by index, and removes redundant field-level reasons. It retains every field's claims, assertions, statuses, claim reasons and answer-acceptance dimensions/reasons. Model, source/card inputs, acceptance policy, transport, thinking settings and the 3,600-token output ceiling were to remain identical. No lower output ceiling or thinking setting was proposed.

Both configurations specify `claude-sonnet-5-5`, `thinking: between_tools`, the same omitted/default effort and first-party nonstreaming Messages transport, without tools, caching or automatic retries. Current [pricing](https://platform.claude.com/docs/en/about-claude/pricing) is $2/million input tokens and $10/million output tokens. [Supported thinking settings](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5) were checked before dispatch. These settings were inherited, not lowered for this experiment.

| Path | Calls | Billed input | Billed output | Provider dollars |
| --- | ---: | ---: | ---: | ---: |
| Evaluation-only reference compatibility | 7 | 41,305 | 8,277 | $0.165380 |
| Compact comparison | 0 | Unmeasured | Unmeasured | $0 spent |

Input cost was $0.082610 and output cost $0.082770; cache usage was zero. Call latency averaged 7.74 seconds, ranging from 6.31 to 9.79 seconds; summed call time was 54.18 seconds. These are provider durations, not topic-to-ready latency. Compact cost reduction in dollars or percent is **unknown**, not zero or a forecast. Recurring operating cost was not measured.

All 101 historical receipts were inspected structurally: they retain extracted text and aggregate usage, with no complete response blocks or exact thinking/visible split. The historical `between_tools` request setting cannot establish that split. All seven new complete responses and metadata were retained privately; each exposes `output_tokens_details.thinking_tokens: 0` and text-only blocks. No separate visible-token counter was exposed; none was manufactured by counting text or subtracting incompatible counts.

The live ledger before spending was $6.396224 settled plus the older uncertain $0.02 reservation. Before dispatch, durable reservations covered the **entire $1.197 worst case**: $0.441 compatibility and $0.756 conditional comparison, within the $1.50 task and $10 lifetime caps. Actual spending was **$0.165380**, all compatibility. Preparation and separate adjudication made no additional Anthropic calls. The undispatched conditional envelope settled to $0; it was not a provider call. No retries or repairs occurred.

Final ledger: **$6.561604 settled, $0.02 older uncertainty, $3.418396 available**, with no new reservation. Task authorization left unspent: $1.334620. All 18 older ledger rows are unchanged. Completed resume added zero token counts or inference calls. Amounts use billed usage at verified list prices, not reconciled invoices.

## Batch applicability

The existing production batch verifier already builds the same request as its synchronous path, stores provider batch IDs, harvests results and records discounted token usage. No adapter was built. Background verification sweeps and bank backfill checks can tolerate delayed results. Core queue generation/checks during synchronous Daily Five filling, author-save vetting and answer grading occur while a person waits; moving these to a batch would change readiness behavior. A deferred bonus continuation is not evidence that it can wait a day. Background daily builds also have readiness deadlines.

Read-only aggregate telemetry for the preceding 14 days contained **2,313 calls and $14.63077645** at current list prices. The identifiable background `batch-verify` scope accounted for **408 calls and $1.99108335**: 17.64% of calls and 13.61% of observed spend. **383 already used batch pricing**, leaving 25 synchronous verification calls. These observations do not identify the eligible share of a future Cassian reviewer: that share remains **unknown**, as does the foreground/background split of shared factual and quality gate scopes.

The documented [Batch API](https://platform.claude.com/docs/en/build-with-claude/batch-processing) discount is 50% on input/output tokens, with processing potentially taking 24 hours. Sonnet batch rates are $1/$5 per million input/output tokens. Applying it only to the remaining 25 background verification calls' token charges illustrates **$0.13143475** additional savings, about **0.90%** of total observed spend; web-search fees receive no discount. This is a same-usage illustration, not a game-wide forecast. Half of this experiment's measured compatibility token cost would be $0.082690, but failed evaluation-only reference work is not a working-reviewer operating forecast.

The old failed-cohort scenarios remain illustrations only: batch $0.2968791; halved billed source-review output $0.3404701; both $0.1966141. They are not added together or applied to this run. The historical $0.5410001 soft numerator, $0.488242 source reviews and distinct AI-reviewed usable counts in [RECONCILIATION.md](RECONCILIATION.md) remain unchanged.

## Effort, preservation and decision

The single focused preparation pass stayed within the approximately 60-minute allowance. Agent active preparation, separate review, adjudication and exception-review effort were not individually metered; human review time and agent interaction cost are unknown, not zero. No human card verification occurred. Separate AI review and coordinator inspection supplied evaluation-only judgments, not free recurring production labor.

Missing prerequisite: a source reviewer that preserves actual claim relationships, marks unsupported chronology unresolved, and supplies evidence for material qualifiers. A reference must pass those semantic criteria before format economics can be measured. Any future authorized evaluation still needs frozen unseen packets, evidence-backed labels with disagreements resolved or retained, and measured preparation/exception effort. This task authorizes no further tuning campaign.

Private frozen requests, schemas, raw cards/passages, histories, labels, complete responses, per-case findings, ledger snapshots and artifact hashes remain ignored under `_scratch/Cassian/`. Public changes contain sanitized aggregates and status links only. Design freeze SHA: `010350ec321a5bd54f6b222824155a34d620e4126f40700efe44649ae70a8463`.

Accounting, case coverage, reference/candidate freezes, exact review quotations, older ledger preservation and resume behavior were checked. The existing verifier/quote/receipt/budget suite passed **55 tests across five files** after a sandbox temporary-file restriction was resolved. This tiny saved-case screen proves neither production reliability nor full creation cost, replacement behavior or automated cold-topic readiness. **Recommendation: adopt nothing and stop this bounded approach; no compact-format savings claim is supported.**
