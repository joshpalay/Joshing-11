# Cassian — question creation experiment

**Latest work, October 12:** [offline claim/source coverage repair complete](COVERAGE-REPAIR.md), at zero new provider spending. Assertion matching replaces quote-span containment; explicit bound audits preserve real omissions and uncertainty. A separate saved packet revision restores two complete result passages and passes preparation checks. Two false alarms clear, three real omissions remain, and one reviewer-added-context assertion stays unresolved. 132 tests, TypeScript/lint pass. Next independently review evidence/material scope where feasible and prepare a separate bounded frozen integration; the formation-model escape remains unresolved. No paid dispatch or rollout is ready from this free phase.

**Historical paid probe:**

**October 12 compatibility probe complete:** [eighteen calls settled for $0.290390](COMPATIBILITY-RESULTS.md). The new [v4 contract](EVIDENCE-V4.md) produced four final writer cards and valid source/quality replies throughout. Both sound controls survived; the formation regression still escaped. Strict inventory reconciliation also has real omissions and span-based false alarms, and one source check waived missing supplied evidence. Overall criteria failed; next repair claim reconciliation and source-packet completeness offline. Same-author known cases, unknown labor, no production change.

The earlier [101-call comparison](FRESH-RESULTS.md) remains frozen at $0.963987: no strict final JSON, all source replies invalid and zero deliverable questions. The new probe does not rewrite those scores or establish production yield. Primary cost per independently verified new usable question remains unavailable.

Earlier completed stages: the [separate adjudication](EVIDENCE-ADJUDICATION.md) and [v3 offline contract repair](EVIDENCE-V3.md). The fourteen-call trial remains completed at $0.127014, with frozen scores unchanged. Saved-case mechanics did not establish real-model response compatibility; the subsequent [fresh evaluation](FRESH-RESULTS.md) exposed that gap. Complete-task retrieval, preparation labor and readiness remain unmeasured.

Cassian is the current home for the experiment previously called QEXP-01. This folder supersedes the implementation scope in `docs/experiments/question-quality-v1/`; those documents remain background and provenance, not an instruction to build the earlier platform.

Earlier targeted trial: [eight calls for $0.133870](TARGETED-RESULTS.md) cleared two quality false holds but released neither card, left fifteen attempts unresolved and still passed a flawed explanation. Production writer/checkers remain unchanged. All 22 available owner-review writer cards are answered and rated; no repeat ratings are needed. Six separately vetted pilot questions were added to the shared bank at the owner's request; later writer blocks and these studies were not promoted. The [accounting follow-up](UNCERTAIN-RESERVE.md) keeps the older uncertain 2¢ reserved and its run halted. Lifetime spending is $5.491578, with $4.488422 available after the unchanged 2¢ reservation. The [bank follow-up](BANK-SUPPLY.md) covers 21 builds without establishing savings; placement attribution remains open. See [next steps](NEXT-STEPS.md) and [tracker](TRACKER.md).

Earlier free follow-up: the [source audit](SOURCE-COVERAGE.md) found that saved summaries support only six of 22 requested answers and one complete card under a strict reading. Actual page captures and a three-case development prototype remain private, with an [offline evidence contract](EVIDENCE-CONTRACT.md). The [writing/review test](EVIDENCE-RESULTS.md), [offline v3 repairs](EVIDENCE-V3.md) and [fresh comparison](FRESH-RESULTS.md) have completed. Development material is not new bank stock.

## Confirmed owner decisions

- **Primary cost metric:** [full creation cost per new usable unique question](COST-PRIORITY.md), including failed/replacement attempts. Quality, variant validity, novelty and topic/difficulty coverage remain constraints. Track evidence labor separately from provider dollars.
- Admin-only, visibly distinct experiment in Daily Five after the bonus questions.
- Answer questions normally, then give detailed ratings and optional corrections.
- No mastery contribution and no propagation to the activity stream. Keep attempts/feedback isolated from normal gameplay records. There is no authorized points/streak change; the pilot does not award them.
- Never serve a previously shown question/fact as new. Keep narrow topics available; don't hide shortages through repeats or broader-topic substitution.
- Main speed goal: topic chosen → first eligible unseen question ready.
- Desired ongoing game LLM cost: **$5/month**, a secondary longer-term aspiration as the bank matures. Also report bank reuse and amortized cost per served question/game or player-day at the actual workload.
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
