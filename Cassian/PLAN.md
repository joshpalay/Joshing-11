# Cassian implementation plan

Version 1, 2026-10-03. This is the current plan; the older QEXP-01 plan is background only.

## 1. Goal, scope and limits

Find whether a cheaper question writer can reduce total accepted-question cost and topic-selection-to-ready time without sacrificing quality, difficulty fit, narrow-topic coverage or novelty for the recipient. Desired ongoing game spend is $5/month; feasibility is unknown. The initial experiment has $10 total incremental spend authorized, including retrieval, gates, answer grading, retries and failures.

Deploy admin-only when verified. The final review experience is a visibly marked Cassian section in Daily Five after bonus questions. Admins answer normally and then rate. No mastery, points, streaks, shared-bank insertion, activity-stream/feed propagation, notifications, or normal completion-count changes. An experiment-only history/exposure record is allowed and required for novelty. No formal disputes workflow; Unsure remains valid.

The first implementation slice is deliberately small: a manifest-driven CLI comparison, durable candidate/feedback storage, and one admin review page. The below-bonus panel is the next thin integration, not a new experimentation platform. No fine-tuning, production provider switches, difficulty policy changes, general worker/lease system, automatic recurring jobs, or production rollout in this version.

## 2. Source of truth and baseline

Read [CRITIQUE.md](CRITIQUE.md) and [TRACKER.md](TRACKER.md). Record current commit, dirty state, deployed SHA, generation provider/model, gate providers/models, grounding flag/cache settings, difficulty flags and runtime pricing. Don't expose credentials. Recheck PRs [1743](https://github.com/joshpalay/Joshing-11/pull/1743) and [1744](https://github.com/joshpalay/Joshing-11/pull/1744): both were merged when this package was written, but deployment still needs checking.

Cost baseline: an earlier session reported a 30-day spend increase and a higher monthly run rate. Reproduce the scope/window queries or import their exact private results with provenance. Categorize production recurring, maintenance, QA, experiment and unpriced/unknown costs. Check provider bills when available and record the difference from the internal ledger. Do not claim exact spend from pricing-map estimates alone.

The first model comparator is the actually deployed generator, which the synopsis identifies as Sonnet 5.5. The proposed cheaper comparator is Haiku 4.5. Resolve exact supported API IDs and rates before paid dispatch. Local `ANTHROPIC_MODEL` defaults are not proof of deployed choice. If the deployed baseline differs, record it and use the real baseline; do not silently call another model “production.”

Reuse:

- `src/components/profile/settings/LlmProviderPanel.tsx` and `/api/admin/llm-providers` for understanding global controls; don't mutate them for the test.
- `src/server/llm/settings.ts`, `provider.ts`, `src/lib/llm.ts` for provider dispatch and existing usage wrappers.
- `src/server/daily/generate-questions.ts` for prompts/parser and gate logic; audit side effects before importing/calling helpers.
- `src/server/daily/domain-reference.ts`, `prewarm.ts`, `replenish-bank.ts` and topic-add paths for real timing boundaries.
- `src/server/auth/admin.ts` and existing session checks for access.
- `scripts/export-question-quality-examples.mjs` and `src/server/daily/exemplars.ts` for example inventory.

## 3. Minimal experiment design

### First comparison: writer only

Freeze two arms: A = current writer; B = cheaper writer. Same task prompt, reviewed examples, reference passages, topic/difficulty brief, requested count, avoid lists, parser and gates. Exact model settings and compatibility differences are documented. Do not switch production settings. Do not simplify B's gates in the same comparison.

Use 12 fixed topics, grouped 4 broad, 4 niche and 4 very narrow, selected from actual declared interests and identified in the manifest before viewing outputs. Spread requested difficulty across the sample. Keep the same briefs for both arms. Topic labels are not enough: include scope/canon/edition where necessary. Source availability and failed topics remain part of the result.

Start with one requested question per topic per arm: 24 requested candidates. If the estimate and first stage fit, repeat balanced blocks, not only successful topics. A provider generation batch can contain multiple candidates; record calls and candidates separately. A 24-question screen is a pilot, not proof of a tiny error rate or durable topic coverage.

Evidence acquisition can be shared once per topic for writer isolation, with costs allocated transparently and also shown in total. Shared evidence makes this a writer comparison; it does not measure independent cold retrieval for each arm. Never label cached evidence runs as cold topic creation.

For each requested slot retain success, parse failure, short output, duplicate, timeout, API failure, gate pass/reject/uncertain and repair/retry records. Save all outputs locally for audit. The admin page can filter would-serve and rejected candidates; do not mix the deliberately failure-heavy review sample with ordinary served-quality denominators.

### Second comparison: creation path

After the writer comparison, use the remaining budget for the most informative bounded test: cold/depleted topic-to-ready timing or a cheaper gate policy on identical candidate snapshots. Do not automatically do both if they don't fit. Record why the next test was selected.

The owner also identified a distinct yield lever: an otherwise sound question/key can be rejected solely because its optional explanation is wrong, forcing replacement generation. [EXPLANATION-YIELD.md](EXPLANATION-YIELD.md) records the bounded saved-question replay and its source-audited interpretation. If this becomes the next paid comparison, compare explanation-bearing and answer-only **creation** at a fixed target number of independently usable, novel questions. Count replacement rounds and extra retrieval, not just output tokens or raw gate passes; retain factual checking of the question/key and keep production unchanged during the comparison.

Cold = no eligible stock/no saved source packet in an isolated benchmark; depleted = stock exists but all is in the simulated recipient's seen history; warm = unseen eligible stock/source cache exists. Do not delete production cache or real history to manufacture these states.

Timestamp topic request, resolution, scheduling, retrieval, generation, gates/dedup and first eligible persisted/display-ready candidate. Report total and stages, p50/p95 where sample size supports them, timeouts and no-result rate. No broad substitutions or repeats count as fulfilled requests.

Only after measuring current scheduling may a separate experiment prefetch facts at topic add. Reuse current caching/coalescing, bound speculative spend, and measure topics fetched but never played. Do not change this concurrently with the writer trial or #1744's supply policy.

### Inexpensive review safeguards

Use a stable random order and hide model identity/automatic verdicts until initial feedback is saved. This requires no assignment service or elaborate tables. Record if an admin explicitly reveals details first. Never replay a fact to the same admin as a new card to complete a matched comparison; use different eligible reviewers or balance different facts by topic/difficulty. Offline gate replay is allowed because it does not re-serve questions.

## 4. Dataset and ratings

Use the 54 active exemplars as provisional style references with their actual provenance. The approximately 80-question document is still unresolved. Time-box source discovery to one focused search, record paths checked, then continue with a named provisional dataset. Don't claim the 54 constitute the full owner-authored corpus.

Existing report snapshot: 22 incorrect reports; 4 upheld, 9 admin-edited/resolved, 9 open; zero inappropriate. Current wording may already have been corrected. Use original snapshots only when recoverable; never train or judge corrected text as the original bad version. Preserve notes, resolution and original/current version distinction. These cases provide development/regression material, not an unseen evaluation set when already in prompts. No training takes place in this version.

Fresh generated candidates are reviewed with:

| Field | Values |
| --- | --- |
| Overall | Good / Fix / Reject / Unsure |
| Accuracy | Correct / Incorrect / Cannot verify; answer/premise/explanation selector |
| Clarity | Clear / Ambiguous / Missing context / Gives answer away |
| Interest | Interesting / Fine / Boring or generic |
| Difficulty | Too easy / About right / Too hard / Cannot judge relative to requested tier |
| Topic fit | On topic / Partly / Off topic |
| Appropriateness | Fine / Inappropriate / Unsure, with reason |
| Repetition | New / Already seen / Same-fact paraphrase; a report triggers exclusion review |
| Answer acceptance | Grading correct / My answer should count / Key or variants need correction / Not attempted |
| Creation speed | Fine / Noticeable wait / Too slow / Not observed; don't force ratings on precomputed cards |
| Gate review | Pass / Revise / Reject / Unsure, after initial rating, for gate-audit items |
| Free text | Note, corrected question/key/variants/explanation, supporting source, familiarity |

Show overall and note first; expandable sections contain all dimensions. A Good rating need not require every subfield. Fix/Reject requires a reason. Store Unknown separately from Incorrect. Ratings are durable and editable with revision history, bound to the exact immutable candidate snapshot. A save failure leaves the draft and does not display “Saved.” Different admins' ratings are retained; no voting/consensus requirement. Actual conflicting factual labels remain unverified rather than being averaged into truth.

Also provide one panel-level “Missing topic / Variety / UI issue” note control. Feedback does not call live ContentReport routes or suppress a real question. Test questions and corrections never enter the shared bank automatically.

## 5. Lean implementation

### Runner

Suggested file: `scripts/cassian-compare.ts`, with an offline `--estimate` default and explicit `--run`/`--resume` modes. A manifest contains run ID, hashes, model settings, topic briefs, prompts, evidence IDs, gate settings, intended counts, pricing snapshot and budget. Reject missing exact prices; unknown is not free.

The CLI runs sequentially or with bounded concurrency of at most two external calls including nested gate fan-out. It saves a checkpoint after each completed step. Resume skips completed steps; records ambiguous failures and possible billed retries rather than promising provider exactly-once execution. Default zero automatic retry or one pre-budgeted transient retry. All work finishes in the CLI process; no fire-and-forget serverless runner or cron.

Use a small experiment call sink/context to keep paid calls correlated and avoid double billing in reports. Persist actual token/cache/search usage, durations, request IDs and unknown/failed charges. Existing best-effort logging is not a complete experiment ledger unless failures are accounted for. Reuse parsing and pure gates without invoking normal generate-and-insert or normal bank mutation functions.

### Storage

Local raw output/checkpoints: ignored `_scratch/Cassian/<run-id>/`. Commit only sanitized manifests, metrics and reports under `Cassian/runs/<run-id>/`. Never rely on a deployed function's local filesystem for ratings.

Prefer existing suitable storage; otherwise use at most three narrow records/tables: Run (manifest/budget/status), Candidate (immutable content, evidence, step results/costs), Review (admin/candidate, attempt/exposure, ratings and revisions). JSONB can hold sparse step results and feedback dimensions. Additional tables require a demonstrated need; no general job queue, lease service, experiment platform or dataset-management UI.

For budget safety, store a durable experiment-total cap/reservation and enforce a single active paid runner using an atomic claim/lock. Reserve the first run ceiling before dispatch, settle usage, retain conservative unknown-cost reservations, and prevent a second CLI process or admin action from double-spending. No database transaction stays open during a provider call.

### Admin interface

First build `/admin/cassian` with the existing `isAdminUser`/session guard. Every data, answer, feedback, reveal and export endpoint checks admin authorization server-side and uses private/no-store responses. Non-admin/anonymous returns 404. Validate candidate/version ownership and mutation schemas; idempotent retries must not create duplicate answers/ratings. Keep unrevealed keys, model identity and gate verdicts out of initial payloads.

Then add a thin `CassianPanel` to `/daily` below server-confirmed completed regular/bonus play. No bonuses means after the regular round. Heading: “Cassian — Question experiment”; badge: “Admin only”; explanatory text: “Experimental questions. Your answers don't affect mastery or activity.” Use a distinct border/background and text designation with existing design tokens, not color alone.

The panel uses the same endpoints/components as the review page. Admins type answers, receive normal correctness/key/explanation feedback and rate. Use a frozen existing grading helper without normal gameplay writes. No points/mastery/streak/stream/feed/notifications; no share/send/add-to-bank controls. Normal recap remains available. No model generation on page load, refresh or scrolling. Only explicit bounded preparation/topic-test actions may dispatch within the cap.

### Strict novelty without a dedup rewrite

Inspect existing full-set answered-fact, pending-feed, queue, canonical/generated twin, own-authored and same-fact rules. Do not change their thresholds, cooldown semantics, or #1744 difficulty policy.

Before any candidate is shown to an admin, exclude known facts/questions from production history and prior Cassian exposures, even when skipped/unanswered. Save exposure atomically; refresh resumes the same card rather than assigning a duplicate. Viewing an old rating intentionally is history review, not a new play question. No eligible supply produces an honest empty state.

Cassian content shown to an admin must also be excluded from later fresh normal supply for that admin. Prefer an existing exclusion mechanism; if absent, implement a narrowly scoped exposure lookup in a separately tested change before live answering is enabled. This preserves the rule and does not publish a candidate or award mastery. Keep offline runner work independent so this seam does not delay basic model evaluation. Do not guarantee cross-direction novelty merely because candidates are outside the bank.

Use an isolated clean worktree from current main for coding. The supplied working tree has unrelated daily/feed/activity changes and the cited PRs may not be present locally. Do not overwrite them or cherry-pick changes already merged. Copy only the Cassian planning package and exporter needed for the handoff if uncommitted docs are absent from the new worktree.

## 6. Budget and economics

Confirmed total cap: $10, lifetime of this initial experiment. Recommended first-comparison subcap: $4, leaving up to $6 for review grading, follow-up timing/gate tests and retries. $4 is a chosen implementation subbudget, not a replacement user instruction. No paid training or new vendor subscription in this pilot.

The owner has already authorized deployment and paid runs within $10. Print/save the estimate and exact manifest before a run, then proceed within scope without a redundant permission question. If estimates exceed the first subcap, reduce balanced sample volume or revise the subbudget within $10; explain the consequence. Never spend beyond $10 to satisfy an aspirational sample count. No continuing paid schedule is created.

Report three distinct dollars:

1. Actual Cassian spend, reserved/uncertain charges and remaining $10 budget.
2. Cost per accepted unique eligible question and per completed normal game/player-day under a fixed workload.
3. Total/projected monthly normal game cost versus the owner's $5 goal, separating unaffected spend, maintenance and QA.

Cost per accepted question includes all generation, sources, gates, duplicates, failures and retries in the same measured cohort. If reviews are incomplete, label the result provisional. Zero accepted means undefined/no successful yield, never free. Show ordinary grading separately but include it in the pilot's budget. Compare generation calls, raw candidates, accepted candidates and slots distinctly.

If fresh writing contributes roughly half of spend, eliminating it still leaves more than the $5 target. Quantify the unaffected-cost floor before claiming feasibility. Do not promise a fixed monthly total across arbitrary user growth. The final report should say whether $5 is achieved at a stated workload, plausible with specified additional changes, not yet demonstrated, or infeasible under unchanged costs.

## 7. Documentation and evidence

Use this folder as the only current experiment specification. Update TRACKER every session with files, commands, actual budget, progress and next action. Each run saves:

- `manifest.json`: frozen config, exact IDs/settings/hashes, dates, topic briefs, requested counts, gate/difficulty state and price snapshot.
- `metrics.json`: call/candidate/funnel counts, costs, uncertainties, timings, review completion and per-topic coverage.
- `RESULTS.md`: side-by-side comparison, representative reviewed failures, quality/false-rejection limitations, monthly projections and next decision.

Raw outputs and private notes stay secured/ignored, referenced by locator/checksum. Preserve original bad/corrected text as different versions. Existing examples exposed in prompts are not unseen evaluation cases. Don't train on current trial ratings mid-run. Basic hashes/versioning are sufficient; no new dataset platform is needed.

Keep the generation comparison on one frozen difficulty configuration. If #1744 deploys during the measurement window, split/restart the affected production comparison. Do not attribute bank-rule gains to the cheaper writer. PR merge date, deployment date and runtime flags are separate facts.

## 8. Milestones and acceptance

| Stage | Deliverable | Finish line |
| --- | --- | --- |
| C0 | Baseline and estimate | Verified PR/deployment distinction, cost provenance, 12-topic manifest, exact models/pricing, no paid calls yet |
| C1 | Offline runner | Mocked/dry-run works, all results/cost/failures saved, no normal bank mutations, budget/resume tested |
| C2 | Saved admin review | All feedback fields, answer/reveal and durable saves; admin-only; no gameplay/social effects |
| C3 | First paid comparison | Fits <=$4 proposed subcap and <=$10 total, real results imported, all topics/shortfalls reported |
| C4 | Below-bonus panel | Same review UI mounted in required place, no-repeat integration verified, admin-only deploy checked |
| C5 | Feedback and targeted follow-up | Actual admin ratings, one justified affordable timing/gate comparison, honest uncertainty |
| C6 | Final report | Measured winner/tradeoffs/inconclusive result, monthly $5 feasibility and remaining budget; no ordinary-user rollout |

These are small milestones, not a requirement to open a new session for each or stop when independent work remains. A handoff prompt may bound the next session to C0–C3; subsequent sessions continue from the tracker. Human feedback can remain pending without pretending the experiment is complete.

Meaningful tests: no unauthenticated/non-admin access; no mastery/points/activity/bank writes; gates use identical settings across arms; duplicate/failure costs counted; unknown prices block paid dispatch; concurrent runners cannot exceed cap; resume has no duplicate application records; incorrect report versus admin edit classification; feedback saves/revisions and hidden keys; cross-surface shown-history, >200 old facts and same-fact duplicates; no-bonus/partial-queue/recap/mobile panel behavior. Run focused Vitest/type/lint checks and actual admin/non-admin preview QA. No paid API calls are needed for infrastructure tests.

No claim of definitive quality from 24 questions. The result is a screening comparison that can reject a bad candidate or justify more evidence. A cheaper writer that increases defects, repairs, narrow-topic failures or false gate rejections may cost more per usable question; record that outcome rather than weakening the bar.
