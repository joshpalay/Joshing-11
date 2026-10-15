# Cassian: compact source-review experiment (blocked at the reference)

October 15, 2026. **Decision: adopt nothing and do not pursue the compact format yet.** The proposed working reference reviewer failed its frozen compatibility check, so the compact candidate was never run. Making a broken reviewer cheaper is not a result. Machine-readable figures are in [compact-review-metrics.json](compact-review-metrics.json).

This was one of two independent attempts at the same task; the other reviewer's run (`cassian-compact-cost-2026-10-15`) was not read or used here.

## What was tested

- **Reference:** the v4 whole-card source reviewer (`RECONSTRUCTION_PROMPT_V4`, native v4 JSON schema) plus one permitted repair: the two rules already written in [CARD-SCOPE.md](CARD-SCOPE.md) for material scope and formation newness. Sonnet 5.5, thinking `between_tools` (its lowest accepted setting, the same as every earlier v4 source review), 3,600 output tokens, 60 s timeout, zero retries. It sees the complete card and sources, never a writer inventory.
- **Compact candidate (frozen, unrun):** the same semantic sentences, model, thinking, inputs, policy and transport. Only the format changes: one flat claim list, the shortest identifying quotes, and an empty reason for supported claims and fully matching answers. Code rebuilds the v4 structure so both arms go through the identical `assessReviewV4` verifier, and a non-supported claim without its own reason fails protocol. See `scripts/cassian-compact-review-core.ts`.
- **Compatibility set:** the eight saved v4 controls (three source-sound, five defects), which are development material. The pass rules were frozen before any paid output. Required: 8/8 valid replies, no false rejection of the three sound cards, every defect held on its defect field for the right reason, and no truncation.

## Result: the reference did not work

| Measure | Result |
| --- | ---: |
| Valid, bound replies (`end_turn`, schema, quotes) | 8/8 |
| Sound cards passed | 3/3 |
| Defects non-pass | 4/5 |
| Defects held on the right field and category | 3/5 |
| Unsafe passes | **1** (formation) |
| Right verdict, wrong reason | **1** (chronology) |
| Truncation | 0 |

- **Formation (unsafe pass).** The reviewer quoted the source sentence saying two leagues *merged to form* a new league. It then marked "the predecessor league *later merged into*" that league as supported. The added formation rule forbids exactly this. It is the fourth consecutive escape of this regression (compatibility, coverage and scope probes, and now this check).
- **Chronology (wrong reason).** The card was held only for its language-variant mismatch. The reviewer accepted the unsupported "later" because "'later' is consistent with the sequence of the source passage". That infers order from sentence position, which the prompt prohibits. The frozen gold says a variant-only hold does not satisfy this regression.
- The answer-type, full-name and attribution defects were caught for the correct reasons, and the three sound cards passed.

Per the frozen rules, all further paid work stopped. There was no prompt edit, no rerun, and no compact or unseen-case evaluation. The six unseen base cards (broad, niche and very narrow, each with a sound card and a controlled defect) were designed from fresh, previously unused articles, but never frozen or labeled, because nothing was going to run on them. A future run can still use those topics as unseen material.

## Thinking versus visible output

The provider now reports `usage.output_tokens_details.thinking_tokens`. On all eight calls it was **0**, and every response held exactly one `text` block. All 8,573 billed output tokens were visible output. The historical v3 receipts did not save this field, so their split remains formally unknown. The same `between_tools` setting without tools now produces no thinking. The [earlier 82% output share](RECONCILIATION.md) therefore reflects long visible replies, not hidden thinking. In v4-format source reviews (these 8 plus the 12 of October 12), output is **52.5%** of review cost: about 1,177 output and 5,325 input tokens per call. That share is lower than in the failed v3 cohort, so a compact format has less to save than the historical cohort suggested.

## Batch applicability (read-only)

Batch pricing was verified on [Anthropic's batch page](https://platform.claude.com/docs/en/build-with-claude/batch-processing): all usage at 50% (Sonnet 5.5 is $1/$5 per million tokens), most batches finish within 1 hour, and unfinished batches expire at 24 hours.

These are 30-day `LlmUsageEvent` estimates at current list prices, about $27.94 in total. They are not an invoice.

- **Already batched:** background verification (`batch-verify`) ran 383 of 408 calls through the Batch API.
- **Eligible now, latency-insensitive crons not yet batched:** `vet-question` ($0.81) and `backfill-supply-generate` ($1.30), about **8%** of spend, saving roughly $1/month.
- **Eligible only with a redesign:** 765 of 824 daily builds (70 of the 76 that called generation) started in the 17:00–18:59 UTC `daily-assignments` cron window. Those builds account for about $17 of generation, grounding and gate spend. No player waits on them, but the queue must be ready that day. Batching them would require building a day ahead, accepting up to 24-hour expiry and rebuilding queues for players who never show up.
- **Not eligible:** player-triggered builds and grading, about $3–4.

Cassian source review is not a production stage. Its closest production analog, the synchronous factual gate ($1.53), runs inside daily builds, about 70% of it in the cron window. Do not apply the 45% illustration game-wide.

## Cost, budget and effort

| | USD |
| --- | ---: |
| This task (8 reference calls, receipt estimate = ledger settlement) | 0.176856 |
| Ledger before (live read) | 6.561604 spent, 0.02 reserved |
| Ledger after (live read, includes the other reviewer's 0.165380) | **6.738460 spent, 0.02 reserved, 3.241540 available** |

Worst case reserved before dispatch was $0.388726 under a $0.50 run cap and the $1.50 task authorization. The older uncertain $0.02 call was left untouched. Token counts were free preflights. Agent interaction time was unmetered, about 1.5 hours of wall clock. Human labor for this task was zero. Owner adjudication of the remaining source-review design is unmeasured, not free.

## What remains before any paid comparison

1. A source reviewer that resolves formation newness and refuses chronology inferred from sentence order, without rejecting sound cards. Four prompt-level attempts have not achieved this. The likely remaining options are a code-checked relation step (the [verification-fix](VERIFICATION-FIX.md) shadow verifier catches both cases, but only with manually authored bindings) or human review of those relation types. Each option needs its own costing.
2. Only after a reference passes the frozen check: freeze and independently label the unseen set, then run the frozen compact candidate once.
3. Batch: route the two latency-insensitive crons first. A day-ahead build is a product decision, not a pricing switch.

Private artifacts are in ignored `_scratch/claude-compact/` and `_scratch/Cassian/cassian-compact-claude-compat-2026-10-15/`. They include the design (`35989af5…`), labels (`da948e5d…`), frozen criteria, exact requests, receipts with block types and provider usage, and scores. No card text, source passage or response appears here. No production writer, gate, bank, serving rule or environment flag changed.
