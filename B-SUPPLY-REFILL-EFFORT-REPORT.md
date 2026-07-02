# Grounded Pool-Refill — Full Effort Report (B-SUPPLY-REFILL-*)

**Period:** 2026-06-30 → 2026-07-01
**Status:** **technically UN-BLOCKED, strategically PAUSED** (2026-07-01) — see the **UPDATE** section immediately below, which supersedes the original TL;DR / Disposition. `RETRIEVAL_GROUNDING_ENABLED` remains **`false`** in prod.
**Supersedes / extends:** `B-SUPPLY-REFILL-FLIP-01-FINDINGS.md` (the mid-effort snapshot). This is the authoritative end-to-end record.

---

## UPDATE (2026-07-01) — technically un-blocked, strategically PAUSED

> **This section supersedes the "PAUSED / async Batch API is the only fix" conclusion in the TL;DR and Disposition below.** Those are preserved **unchanged, as the Sonnet-4.6-era historical record** — read them as history, not as the current disposition.

**1. Throughput is solved — by MODEL, not by architecture. The Batch-API rebuild is RETRACTED.**
The 65%-timeout catastrophe was a **Sonnet 4.6** phenomenon: the heavy structured-JSON refill call sat at the 120s per-call ceiling, and the same call swung ~25s→>220s within an hour. On **Sonnet 5** (prod generation model since 2026-07-01 via `ANTHROPIC_MODEL`) a full **41-domain run drained in ~165s with ZERO timeouts**. **Do NOT rebuild refill on the async Batch API to "fix throughput" — that conclusion is explicitly withdrawn.** (`B-SUPPLY-REFILL-THROUGHPUT-01` bounded-concurrency also shipped and helps, but the decisive factor was the model.)

**2. Yield is healthy on a FUNDED Sonnet 5 run.**
The apparent "yield collapse" (34/41 domains persisting nothing) was **credit exhaustion mid-run** (HTTP 400 `CREDITS_EXHAUSTED`), NOT a never-searched (provenance) or parse-failure bug. A funded instrumented diagnostic showed **every domain searched (2–3×) and parsed (1 question each)**. Persist funnel on a broad-domain-heavy slice: 11 generated → 1 uncorroborated, 7 quality-gate drops, **3 persisted (~27%)**. That extrapolates over the ≥5-fact bar — but the ≥5 is still an extrapolation from BROAD domains, which persist more easily than the narrow domains refill exists to serve (see the confirmation gate).

**3. STRATEGIC PAUSE — pending the finite-set product decision (`D-SUPPLY-FINITE-SET-01`, TBD).**
The refill *works*; it is paused for a **product** reason, not a technical one. A reframe under review may replace *infinite daily top-up* with *finite completable sets* (fill a domain's ~15–30 fan-salient questions once, earn a designation, then graduate/broaden by choice, with opt-in difficulty tiers). That would change what refill is FOR — and change what a confirmation run even confirms. **Do not flip `RETRIEVAL_GROUNDING_ENABLED`, and do not run the ~$2 paid AC-1 confirmation, until `D-SUPPLY-FINITE-SET-01` lands.** Marker: `docs/decisions-pending/D-SUPPLY-FINITE-SET-01-PENDING.md`.

**4. AC-1 confirmation bar (when un-paused):** ≥12 domains **AND** ≥5 persisted facts in one funded run — **with narrow/niche domains (e.g. Spy School Books 1–6) represented among the persisted facts**, not only broad ones (Shakespeare/WTC/Rent persist more easily and would give a false pass). Gated note in `docs/retrieval-flip-checklist.md`.

**5. Two telemetry gaps to close before ANY soak** (see `docs/findings/ledger-telemetry-gaps.md`): (a) web-search spend is not in `LlmUsageEvent` at all (~$1.80 on the 2026-07-01 spike day, invisible); (b) timed-out calls bill tokens Anthropic charges, but `LlmUsageEvent` records only successful responses — on the spike day the ledger saw ~$3 of the ~$7.56 actual. On Sonnet 5 gap (b) largely self-closes (no timeouts); gap (a) is permanent and material.

**6. Model-dependency note for the provider thread.** Refill's **viability** — not just its per-token cost — is model-dependent: Sonnet 5 made a paused feature operable by removing its structural blocker. This belongs in `D-LLM-PROVIDER-ZAI-01`'s evidence: provider choice trades off feature-operability, not only price. Coordinated-but-decoupled — do not merge the threads.

---

## TL;DR

We set out to flip on the grounded pool-refill cron (rung 1 of the supply ladder, `D-SUPPLY-LADDER-UNIFY-01`). Verification proved the *quality* path is healthy but the cron **times out**. We built bounded concurrency and an adaptive timeout-exclusion, flipped prod, and the first real run produced **0 persists / 8 timeouts / a 504**. Reverting, we fixed a real bug in the exclusion, then ran two diagnostics. The verdicts:

> **Neither web search nor concurrency is the bottleneck** (§8). And **the per-call latency is not fixable by config tuning** (§9): the *same* grounded call swings from ~25s to >220s within an hour — temporal variance in Anthropic's agentic web-search — so any synchronous per-call timeout is regularly blown regardless of prompt weight, search count, or output cap.

**The only structural fix is to move refill to the async Batch API** (no per-call/300s ceiling), gated on a check that `web_search` runs inside a Batch. At 18-user scale the ROI of that re-architecture is low, so the effort is **paused** with the path documented. All infra built along the way (concurrency, incremental health-recording, adaptive exclusion) is sound and merged, but insufficient on its own.

---

## What shipped (all merged to `main`)

| PR | What | Migration |
|----|------|-----------|
| #1335 | §4 seam correction — the machine-pool depth metric is already correct; the D-doc's `needs_review` exclusion is N/A to `generatedQuestions` | — |
| #1336 | `B-SUPPLY-REFILL-FLIP-01-FINDINGS.md` — mid-effort verification snapshot | — |
| #1337 | **Bounded-concurrency** refill (`runBudgetedConcurrent`, `RETRIEVAL_MAX_CONCURRENT_DOMAINS=4`) | — |
| #1341 | **Adaptive timeout exclusion** (`RetrievalDomainHealth`, skip chronic-timeout domains) | **0098** |
| #1342 | **Fix:** record domain health *incrementally* (was end-of-run; never ran on a 504) | — |

Prod env: `RETRIEVAL_GROUNDING_ENABLED=false` (flipped on then reverted), `RETRIEVAL_SYSTEM_USER_ID` = the dedicated **Joshing Library** account (`6d3c8553-…`), `LLM_MONTHLY_USD_CEILING=42`, `NARROW_KB_GUARD_ENABLED` untouched (S5: refill before guard). `RetrievalDomainHealth` table exists in prod. Joshing Library owns **5** test-persisted facts.

---

## Timeline & findings

### 1. Phase 0 — demand exists (no spend)
`runPoolRefill({ dryRun: true })` against prod: **43 thin-active domains** (durable depth < 8, active in 14d). Projected worst-case search spend sat under the $2 ceiling. Baseline captured for the Phase-3 comparison; the canonical niche domain *Spy School Books 1–6* was depth **7** (one fact short, active).

### 2. Phase 1 — §4 seam correction (docs only)
The `D-SUPPLY-LADDER-UNIFY-01` §4 assumption (exclude `needs_review`/`deletedAt` from the depth metric) was **wrong about the table**: the metric counts `generatedQuestions`, which has **no `deletedAt`** (rows are flagged, never deleted) and where every `suppressed_by` loser is already a subset of `is_duplicate=true`. `needs_review`/`publicStatus` live only on the human `Question` table. **The metric was already correct** — no change; correction recorded (PR #1335).

### 3. Phase 2 — the flip is NOT a flag flip
- **Branch staleness:** the flip depends on a merged fix (`50dbc4f4`, per-call timeout 60s→120s, questions/domain 3→1) that our first base predated. Rebased onto `main`.
- **Controlled preview validation (real Vercel):** the cron **504'd at the 300s `maxDuration`** — sequential domains, each grounded call ~40–120s, so only ~2–3 domains drained per run.

### 4. Yield characterization (20-domain sample)
| Outcome | Count |
|---|---|
| Timed out at 120s | **13 (65%)** |
| ✅ Persisted | 4 (20%) |
| Dropped — corroboration (correct) | 3 (15%) |
| Dropped — quality / ask-to-answer | 0 |

**Key split: the quality gates are healthy.** Of domains that *completed generation*, **57% persisted**, and every failure was a correct corroboration rejection (couldn't get ≥2 reputable sources). Generation + gates are sound. **The sole blocker was throughput — timeouts.**

### 5. Throughput build (#1337) — bounded concurrency
Replaced the sequential domain loop with a bounded worker pool (`runBudgetedConcurrent`, cap 4, budget guard). Validated:
- Local: 8 domains in **241s** vs ~900s sequential (**~3.7× wall-time**); persisted a real fact.
- Vercel preview (concurrency 4, 300s): **~9 domains attempted (3 completed)** vs the old ~2–3.

But **broad domains (Shakespeare, Rent, Music Man, Well-Tempered Clavier, Modernist Fiction) still timed out at 120s every run** — they never complete and waste a worker slot.

### 6. Adaptive timeout exclusion (#1341)
New `RetrievalDomainHealth` table (migration 0098). `runPoolRefill` records each domain's outcome; `getThinActiveDomains` skips domains with `consecutive_timeouts >= threshold` (default 3) within a cooldown (default 7d), so the budget stops being spent on chronic-timeout domains. Exclusion *query* logic verified live against prod data (threshold boundary + on/off).

### 7. Prod flip (C) — and immediate revert
Flipped `RETRIEVAL_GROUNDING_ENABLED=true` in prod, redeployed, triggered the real cron. Result: **8/8 domains timed out at 120s, 0 completions, 0 persists, 504.** Worse than the preview. **Reverted to `false` + redeployed** so prod is safe. Two blockers surfaced:

- **Bug #1 (design flaw, now fixed — #1342):** `recordDomainRefillHealth` ran at *end-of-run*, but the run **always 504s before reaching it** (2 waves × ~120s > 300s) — so `RetrievalDomainHealth` stayed **empty** and the exclusion could **never learn**. Fixed with an `onSettle` hook that records each domain's health *as it settles* (survives the kill).
- **Bug #2 (root cause — diagnosed below):** why did prod complete **zero** domains?

### 8. Root-cause diagnostic — concurrency is NOT the bottleneck
Hypothesis: 4 concurrent calls × 3 searches saturate Anthropic's web-search throughput. **Refuted.** Same web-search generation call, sequential vs 4-concurrent:

| | avg per-call | completed |
|---|---|---|
| Sequential | **24.7s** | 4/4 |
| Concurrent (4×) | **27.3s** | 4/4 |

Concurrent is ~10% slower and all four completed — **no contention**. But note these completed in **~25s with a *simple* prompt (1–2 searches)**, whereas the *real refill* prompt (structured JSON: fact_key/sub_angles/source_refs, avoid-lists, `max_uses=3`, `max_tokens=3000`) takes **~100–120s**.

> **Root cause: the refill's own generation call is heavy (~100–120s), sitting right at the 120s timeout.** On any run, normal variance pushes a large fraction of domains over the line — and prod happened to push all 8. This is independent of web search and of concurrency.

---

## Conclusions

1. **The quality/grounding path works.** When a call completes, ~57% persist and the only rejections are correct corroboration failures. This is not a quality problem.
2. **Concurrency and the exclusion are sound infra, but they don't fix the real problem.** They drain *more* domains per run and stop wasting budget on chronic-timeouts — good, and merged — but if each real call is ~100–120s (borderline), a large fraction still abort.
3. **The real blocker is per-call generation latency — and it is VARIABLE and UNBOUNDED, not config-tunable** (see §9). The heavy structured prompt makes the call slower than a simple one, but the decisive factor is temporal variance in Anthropic's agentic web-search latency: the *same* call swings from ~25s to >220s within an hour, so any synchronous per-call timeout is regularly blown regardless of prompt weight.
4. **Region caveat unresolved:** even the prod cron's 504 error showed region `cle1` (may be edge vs function region; the `us-west-2` pin's application to this cron is unconfirmed). It does not explain the latency variance.

### 9. Latency-lever sweep — config tuning does NOT fix it
To test recommendation "lighten the call," we ran the *real* refill generation call with one knob changed at a time (searches 3→2, avoid-list 60→15, `max_tokens` 3000→1500) on a domain that completes (Beethoven) and a broad one (Shakespeare), with a generous 220s timeout to measure true durations:

| domain / config | result |
|---|---|
| Beethoven — baseline (3 / 60 / 3000) | **timed out (>220s)** |
| Beethoven — searches=2 | **timed out** |
| Beethoven — avoid=15 | **timed out** |
| Beethoven — lean (2 / 15 / 1500) | **timed out** |
| Shakespeare — baseline | ✅ **133s**, 1 question |
| Shakespeare — lean | **timed out** |

**The config knobs made no reliable difference.** The leanest config still timed out; Beethoven — which returned in ~25s an hour earlier — timed out on *all four* configs, while "broad" Shakespeare *completed*. That is not a config or domain effect; it is **temporal variance in agentic web-search latency**. Conclusion: **you cannot make a synchronous cron reliable against this by tuning the prompt.**

---

## Disposition: PAUSED (at 18-user scale), path documented

**Decision (2026-07-01): pause the refill effort.** The prior product call already paused retrieval grounding at 18-user scale ("revisit at scale, needs throughput fix first"); this effort *did* the throughput investigation and its conclusion is that a working refill is not a tweak but an **async re-architecture**. At current scale the ROI of that build is low, so we stop here with the path recorded. Grounding stays **`false`**; all infra is merged.

**The only structural fix (for when this is revisited at scale): move refill to the Anthropic Batch API.**
- Batches have **no per-call / 300s ceiling** — a call that takes 220s simply completes instead of aborting, which is exactly what the variance demands. They are async (refill is off the critical path) and cost ~50% less.
- Shape: a **submit** step batches one grounded-generation request per thin-active domain; a **harvest** step polls the batch and runs the *existing* corroborate → screen → ask-to-answer → persist pipeline on each result (reusing everything built here). The concurrency worker-pool becomes unnecessary; the adaptive timeout-exclusion is largely moot (batches don't time out) but harmless.
- **Gating feasibility check before any build:** confirm the **`web_search` server tool actually runs inside a Batch request**. If it does not, the Batch approach is dead and refill needs a fundamentally different retrieval design. Do this 5-minute check *first*.

**Refuted / de-prioritized:** lightening the prompt or cutting searches (§9 — no reliable effect); tuning concurrency (§8 — not the bottleneck).

**Still open (for the revisit):** the *Spy School* niche-completion check was never run directly; refill's **web-search spend is not in `LlmUsageEvent`** (token-only ledger) — Phase-3 spend must be read from cron reports.

**Higher-leverage work at this scale instead:** the **domain-fragmentation** bug (the same game split across two `canonical_subcategory` strings, e.g. "Tears of the Kingdom - the Legend of Zelda" vs "The Legend of Zelda: Tears of the Kingdom", so bank depth never accumulates under one key) is independent of refill and flagged as the highest-leverage small supply fix.

---

## Reproduction pointers

- Demand/dry-run: `runPoolRefill({ dryRun: true })` (`src/server/daily/retrieval-grounded.ts`).
- Depth metric: `getThinActiveDomains` / `getDurablePoolDepthForDomains` (`src/server/db/queries/retrieval-demand.ts`).
- Concurrency + budget: `runBudgetedConcurrent` (`src/server/daily/budgeted-concurrency.ts`).
- Health/exclusion: `RetrievalDomainHealth` (schema.ts / migration 0098), `recordDomainRefillHealth`, the `excludeTimeoutThreshold` path in `getThinActiveDomains`.
- Config knobs: `src/server/daily/retrieval-config.ts` (`RETRIEVAL_*`).
- The generation call to lighten: `generateGroundedForDomain` (`retrieval-grounded.ts`) + `buildUserPrompt` / `SYSTEM_PROMPT` / `GROUNDING_SYSTEM_ADDENDUM` (`generate-questions.ts`).
