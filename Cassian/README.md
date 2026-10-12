# Cassian — question creation experiment

Latest stage: the [separate adjudication](EVIDENCE-ADJUDICATION.md) and [v3 offline contract repair](EVIDENCE-V3.md) are complete. The fourteen-call trial remains completed at $0.127014, with frozen scores unchanged. Saved cases verify citation/source-span mechanics and mandatory relation regressions; this is no new model reliability result. Next prepare the [fresh 24-topic comparison](EVIDENCE-EVALUATION-PLAN.md), freeze concrete selection/scoring and budget before dispatch, then measure the complete task including evidence labor. No new paid calls or production change.

Cassian is the current home for the experiment previously called QEXP-01. This folder supersedes the implementation scope in `docs/experiments/question-quality-v1/`; those documents remain background and provenance, not an instruction to build the earlier platform.

Status: the [approved targeted-review trial](TARGETED-RESULTS.md) completed all eight calls for $0.133870. It cleared two quality false holds but released neither card, left fifteen attempts unresolved and still passed a flawed explanation. Improve source coverage and claim support before another pipeline trial; keep production writer/checkers unchanged. All 22 available writer-trial cards are answered and rated; no more owner ratings are needed. Six separately vetted pilot questions were added to the shared bank at the owner's request; neither new writer block was promoted. The [accounting follow-up](UNCERTAIN-RESERVE.md) keeps the older uncertain 2¢ reserved and its run halted. Lifetime spending is $4.237201, with $5.742799 available after the unchanged 2¢ reservation. The [bank follow-up](BANK-SUPPLY.md) covers 21 builds without establishing savings; placement attribution remains open. See [next steps](NEXT-STEPS.md) and [tracker](TRACKER.md).

Free follow-up complete: the [source audit](SOURCE-COVERAGE.md) found that saved summaries support only six of 22 requested answers and one complete card under a strict reading. Actual page captures and a three-case development prototype are now saved privately, with an [offline evidence contract](EVIDENCE-CONTRACT.md). The [subsequent writing/review test](EVIDENCE-RESULTS.md) and [offline v3 repairs](EVIDENCE-V3.md) are complete; fresh evaluation remains next. The prototype is development material, not new bank stock.

## Confirmed owner decisions

- Admin-only, visibly distinct experiment in Daily Five after the bonus questions.
- Answer questions normally, then give detailed ratings and optional corrections.
- No mastery contribution and no propagation to the activity stream. Keep attempts/feedback isolated from normal gameplay records. There is no authorized points/streak change; the pilot does not award them.
- Never serve a previously shown question/fact as new. Keep narrow topics available; don't hide shortages through repeats or broader-topic substitution.
- Main speed goal: topic chosen → first eligible unseen question ready.
- Desired ongoing game LLM cost: **$5/month**, aspirational until measured. Also report cost per game/player-day to explain growth.
- **$10 total incremental experiment budget**, across all calls, admins and runs. Admin-only deployment and bounded paid runs are already authorized.
- Reuse existing provider infrastructure without changing the global model switches.
- No formal disagreement workflow. Retain Unsure/Unverifiable labels.

## Read in this order

1. [Critique of the other session's synopsis](CRITIQUE.md) — what is sound, what needs correction, and what was verified.
2. [Lean experiment plan](PLAN.md) — full scope, guardrails, measurements and finish lines.
3. [Detailed next steps](NEXT-STEPS.md) — what the owner and next implementing session should do.
4. [Ready-to-paste implementation prompt](HANDOFF-PROMPT.md).
5. [Progress and budget tracker](TRACKER.md).
6. [Reference-cache follow-up](RETRIEVAL-FOLLOWUP.md) — read-only evidence and the measurement needed before any TTL change.
7. [Future pricing hypothesis](FUTURE-PRICING.md) — the owner's possible 200-free-questions trial and the cohort economics to measure before any paywall work.

The committed [manifest](manifest.json) uses generic placeholders because this repository is public. The executed manifest is in ignored `_scratch/Cassian/cassian-pilot-2026-10-03/private/manifest.json`; set `CASSIAN_MANIFEST_FILE` to that path for run-specific estimates or recovery. The [offline estimator](../scripts/cassian-estimate.ts) supports `--topics 3|6|9|12`. The [checkpointed comparison runner](../scripts/cassian-compare.ts) requires both an explicit private manifest path and `--run` or `--resume` before any paid call. See the [runtime baseline](BASELINE.md) and tracker for the precise stage.

The offline comparison runner, admin rating interface, and below-bonus panel are implemented. Fine-tuning and general job infrastructure remain deferred. The Cassian panel remains admin-only; the six separately vetted bank additions can be served in ordinary play. No subscription work is planned.

Do not store raw private reports, credentials or provider responses in this folder. Store local run data in ignored `_scratch/Cassian/`; store deployed ratings in an admin-protected durable database. Commit sanitized manifests, aggregates, tests and decisions only.
