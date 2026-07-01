# Grounded Pool-Refill — Full Effort Report (B-SUPPLY-REFILL-*)

**Period:** 2026-06-30 → 2026-07-01
**Outcome:** Grounded pool-refill is **NOT production-ready**; `RETRIEVAL_GROUNDING_ENABLED` remains **`false`** in prod. The verification, throughput build, adaptive exclusion, a real prod flip, its revert, and a root-cause diagnostic are all complete. The true blocker is now correctly identified.
**Supersedes / extends:** `B-SUPPLY-REFILL-FLIP-01-FINDINGS.md` (the mid-effort snapshot). This is the authoritative end-to-end record.

---

## TL;DR

We set out to flip on the grounded pool-refill cron (rung 1 of the supply ladder, `D-SUPPLY-LADDER-UNIFY-01`). Verification proved the *quality* path is healthy but the cron **times out**. We built bounded concurrency (throughput) and an adaptive timeout-exclusion, flipped prod, and the first real run produced **0 persists / 8 timeouts / a 504**. Reverting, we fixed a real bug in the exclusion and ran a controlled diagnostic. The diagnostic's verdict:

> **Neither web search nor concurrency is the bottleneck. The refill's own heavy generation call is** — a simple web-search prompt returns in **~25s**, but the refill's structured-JSON-with-avoid-lists prompt (3 searches, 3000 max_tokens) takes **~100–120s**, right at the per-call timeout, so a large fraction of domains abort every run regardless of concurrency.

**The lever is per-call latency (leaner prompt / fewer searches / simpler output schema), not throughput.** All infrastructure built along the way (concurrency, incremental health-recording, adaptive exclusion) is sound and merged, but insufficient on its own.

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
3. **The real blocker is per-call generation latency**, driven by the heavy prompt/output (structured JSON + avoid-lists + 3 searches + 3000 output tokens) — not web search, not concurrency, not the DB.
4. **Region caveat unresolved:** even the prod cron's 504 error showed region `cle1` (may be edge vs function region; the `us-west-2` pin's application to this cron is unconfirmed). Worth checking, but it does not explain a 4× prompt-weight gap.

---

## Recommended next steps (before any re-flip)

Attack **per-call latency** — in rough order of leverage:

1. **Lighten the grounded generation call.** The ~4× gap between the simple (~25s) and refill (~100–120s) prompts is the headline. Options: shrink the avoid-lists fed into the prompt, reduce `max_tokens`, simplify the output schema, or split "search + extract" from "format to schema" into two cheaper calls.
2. **Reduce searches per call** (`RETRIEVAL_MAX_SEARCHES_PER_QUESTION` 3→2). Faster, but corroboration needs ≥2 sources — measure the yield hit.
3. **Consider the Batch API** for refill (it's off the user's critical path). Batches tolerate minutes-long calls with no 300s ceiling and cost 50% less — a structurally better fit than a 300s cron for a slow agentic call. This may be the cleanest real fix.
4. **Keep** concurrency (cap 4) and the incremental adaptive exclusion — they're validated and help, just aren't sufficient alone.
5. **Then** re-run the yield characterization; only flip when a real run shows `questionsPersisted > 0` sustainably within the cron budget.

Also still open: the *Spy School* niche-completion check was never run directly; refill's **web-search spend is not in `LlmUsageEvent`** (token-only ledger) — Phase-3 spend must be read from cron reports.

---

## Reproduction pointers

- Demand/dry-run: `runPoolRefill({ dryRun: true })` (`src/server/daily/retrieval-grounded.ts`).
- Depth metric: `getThinActiveDomains` / `getDurablePoolDepthForDomains` (`src/server/db/queries/retrieval-demand.ts`).
- Concurrency + budget: `runBudgetedConcurrent` (`src/server/daily/budgeted-concurrency.ts`).
- Health/exclusion: `RetrievalDomainHealth` (schema.ts / migration 0098), `recordDomainRefillHealth`, the `excludeTimeoutThreshold` path in `getThinActiveDomains`.
- Config knobs: `src/server/daily/retrieval-config.ts` (`RETRIEVAL_*`).
- The generation call to lighten: `generateGroundedForDomain` (`retrieval-grounded.ts`) + `buildUserPrompt` / `SYSTEM_PROMPT` / `GROUNDING_SYSTEM_ADDENDUM` (`generate-questions.ts`).
