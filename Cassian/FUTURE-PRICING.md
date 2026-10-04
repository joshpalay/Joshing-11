# Future pricing hypothesis: 200 free questions

Recorded 2026-10-04. This is a **future product hypothesis**, not a decision to charge, a subscription price, or authorization to add a paywall. Cassian remains an admin-only question-quality and cost experiment. Its questions never count toward a player allowance.

The owner's idea: let a person play approximately **200 normal questions for free**, then offer a monthly subscription for continued play. At five core Daily Five questions per day, 200 answered questions would last about 40 days of daily play; answering both optional bonus questions each day would bring that closer to 29 days. This is a useful trial-length hypothesis, not a cost estimate. The price, launch date, treatment of existing players, and whether other game modes are included remain undecided.

Working counting rule to test before implementation: count questions a person **answers**, including optional Daily Five bonus questions. Exclude Cassian test cards, which are admin-only and do not affect mastery or activity. Decide how skipped questions, replayed/return questions, authored questions, and other modes should count before displaying any allowance. Keep existing progress and history available if a person does not subscribe; the exact post-allowance experience needs a separate product decision. Never infer a billable count from merely generated or assigned questions.

## What can be measured now

- `MASTERY_EVENTS` has per-user answer records with `answer_id`, `session_context`, and timestamps. `DailyQueue.slots` records answered/skipped states and distinguishes core from optional slots. A read-only cohort query can establish how many people reach 50, 100, and 200 *under a declared counting rule* and how long it takes.
- `DailyBuildMetric` records completed builds, bank attempts/hits/miss reasons, generation-call counts, and latency. Filter to `outcome='built'`; carry-forward and existing-queue rows are not new games. `LlmUsageEvent.build_id` can join build-scoped model usage to the relevant build and player. Use the repository's current price estimator, while reporting that it is not a provider invoice.
- Bank question identifiers and queue snapshots can support a read-only estimate of how often one source question is served to different players. Validate identity and historical coverage before using that estimate for pricing. Cassian's `CassianRun` ledger is separate experimental spend and must be excluded from normal player economics.

These records are enough for an **initial cohort and build-cost report without adding a Cassian table or changing gameplay**. Before using it to choose a subscription price, audit attribution: some reference retrieval, background bank creation, verification, and other LLM work may have no `build_id`; a shared question's creation cost must be amortized across uses rather than charged in full to every recipient or only its first recipient. Also separate one-time maintenance, QA, Cassian, payment fees, and fixed costs from recurring player demand. Reconcile internal list-price estimates with provider invoices where possible.

## Decision gate before any billing work

First produce a read-only report for new-player **first 200 answered questions** and established-player **later monthly usage**, with distributions rather than only an average. Include topic breadth, bank fill, cross-player reuse, generation/retrieval/gate costs, answer-grading cost, wait time, and the share of costs that cannot yet be attributed. Report the monthly total at a stated player count alongside the owner's $5 operating-spend goal. Repeat after the recent bank difficulty change has a clean post-deployment window; do not credit a writer or explanation change for bank-rule effects.

Only if that report exposes a consequential tracking gap should a separate production-telemetry change be proposed. Do not add payment, allowance, subscription, or pricing fields to Cassian's experimental tables. Do not implement a paywall, decrement a live allowance, or set a subscription price as part of the current Cassian pilot.
