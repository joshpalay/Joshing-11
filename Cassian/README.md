# Cassian — question creation experiment

Cassian is the current home for the experiment previously called QEXP-01. This folder supersedes the implementation scope in `docs/experiments/question-quality-v1/`; those documents remain background and provenance, not an instruction to build the earlier platform.

Status: the 12-topic machine-screening run, admin-only play, owner ratings, independent source audit, and bounded no-explanation gate replay are complete. Six gate-passed, source-verified, nonduplicate questions were added to the shared bank at the owner's request; the remaining pilot candidates stay in Cassian. The pilot does not justify a production writer switch. The first [bank supply/reuse audit](BANK-SUPPLY.md) is complete, with more post-deployment builds needed before evaluating the new difficulty rule. See [the owner review](runs/cassian-pilot-2026-10-03/OWNER-REVIEW.md) and [tracker](TRACKER.md).

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
