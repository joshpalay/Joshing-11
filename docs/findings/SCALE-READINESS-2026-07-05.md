# Scale-readiness review — question generation & verification

**Date:** 2026-07-05 · **Method:** live prod DB (read-only aggregates), Axiom `vercel` log drain, Vercel env/deploy state, docs pricing page, and a full code map of both pipelines. · **Companion fixes landed with this doc:** the Batch-API `custom_id` bug, the prefilter explanation-path tightening, and the one-time backlog blitz (see §7).

## TL;DR

Generation is healthy and cheap (~$0.014/question). **Verification was the scaling wall** — a ~50/day synchronous cap under a ~26/day inflow, a growing backlog, and the built escape hatch (Batch API mode) silently broken. As of this doc the wall is removed: the Batch path works (bug fixed, first real batches submitted), the prefilter routes 78.5% instead of 94.3%, and the actionable backlog is being cleared for ~$3. The remaining scale levers are pricing/caching hygiene and one strategic decision (`D-SUPPLY-FINITE-SET-01`) that sets whether cost stays linear in players.

## 1. Baseline (2026-07-05)

| Metric | Value |
|---|---|
| Users / weekly answerers | 18 / 6 |
| Answers, last 7d | 167 |
| GeneratedQuestion total / servable / fresh-unused | 1,270 / 760 / 177 |
| Question total / human-authored | 766 / 139 |
| LLM spend | wk 6/22: **$3.87** (908 calls) → wk 6/29: **~$16–21 list** (1,804 calls; experiment-driven, not player-driven) |
| Cost per generated question | **$0.014** (weekly digest) |
| `LLM_MONTHLY_USD_CEILING` | $42 — last week's pace annualizes past it; raise or expect throttling |

## 2. Generation

Paths: daily on-demand (3-pass cron, time-budgeted rounds, six inline gates + ask-to-answer), pool refill (grounded web-search, flag-gated), crafter/authored (gates-as-flags, decision ledger feedback), reference-grounded anchor (built, flag-off).

**Findings:**
- **Sonnet 5 wins the A/B on everything measured**: generation 10.5s vs 15.3s avg, verify 3.7s vs 7.8s, refill 41 domains/165s/0 timeouts (vs 65% timeout catastrophe on 4.6), demotion parity (13.2% vs 13.3%). **Intro pricing $2/$10 per MTok through 2026-08-31** (list $3/$15; new tokenizer ≈ +30% tokens → net ~13% cheaper at intro). Some scopes still run 4.6 (factual gate default, parts of verify/inside-joke/enrich) — finish the consolidation before the intro window closes.
- **The refill "pause" is not real in telemetry**: 155 non-dry cron invocations in 7d, 16×200, **10×504 + 2×500 dying at the 300s `maxDuration`**, plus live `pool-refill-generate` ledger rows. Reconcile posture vs reality; if refill stays on, it needs the Batch API architecture (the 504s prove sync can't hold even at this scale).
- **No `generated_by_model` on question rows** — provider only (mostly NULL). Model-level quality A/Bs are impossible until a column is added and stamped at persist.

## 3. Verification

Layers: inline gates at generation → ask-to-answer (`machine_verified` tier) → inline Haiku vet for authored keeps → daily batch-verify cron (demote-only) → crafter gate-calibration ledger.

**The wall, quantified (pre-fix):**
- Raw unverified: 833 GQ + 636 Q. **Correction:** 826 of the GQ rows are *expired* bank stock the cron rightly ignores — the actionable backlog was **643** (636 Q + 7 live GQ).
- Sync capacity 25/store/day vs ~26/day GQ inflow → backlog structurally never drains; cron p95 already 97s of 300s.
- ~$2/day (~$60/mo) — the single largest recurring LLM line, driven by a prefilter that routed 94.3% of rows (the `explanationCarriesClaims` length/any-signal heuristic) and frequent web search.

**Why the Batch API mode never fired (two independent causes, both found today):**
1. `BATCH_VERIFY_ASYNC_ENABLED=true` was added to prod env only hours before this review — env vars bind at deploy, and no flag-bearing deployment had served the 10:00 UTC cron yet.
2. **The real bug:** `encodeVerifyCustomId` used `q:<uuid>` — the Batches API rejects `custom_id` outside `^[a-zA-Z0-9_-]{1,64}$`, so every submit would have thrown `invalid_request_error`, been caught, logged, and returned 200. Unit tests mocked the API and never saw the pattern. Fixed to `q_<uuid>` (decode tolerates the legacy form); regression test asserts the pattern.

**Prefilter fix (this PR):** the explanation path now routes only *adjacent* claims — a signal **kind** absent from stem+answer, or a claim-dense (≥2 kinds) explainer; length alone never routes; the `count` regex no longer double-fires on years. Measured on 1,200 recent prod rows:

| variant | skip | route | extra_fact |
|---|---|---|---|
| legacy (both hatches) | 5.7% | 94.3% | 94.1% |
| answer-tightening only (prior default) | 5.9% | 94.1% | 93.8% |
| **strict (new default)** | **21.5%** | **78.5%** | **63.3%** |

190/1,200 rows flip route→skip; eyeballed flips are explainers restating the asked fact (no leaked checkable claims). Escape hatch: `PREFILTER_EXPLANATION_LEGACY=true` (no deploy needed).

## 4. Infrastructure

- **Vercel:** Pro; `maxDuration=300` is the binding constraint on all sync LLM batch jobs (refill 504s; verify p95 97s). Batch API sidesteps it. `daily-assignments` p95 75s is fine (soft-deadline pattern).
- **Supabase:** `max:5` pool pins every concurrency knob at 4; becomes the next ceiling at ~10× users (daily-assignment fan-out). Not urgent.
- **Axiom:** `vercel` drain only; `LlmUsageEvent` is the real telemetry (good). Aborted-call tokens still unledgered (self-heals on Sonnet 5).
- Hygiene: web-search tool version drift (refill `20260209` vs verify `20250305`); `/api/cron/prompt-proposal` unscheduled; `VOYAGE_API_KEY` unprovisioned (semantic dedup off — deterministic guards only).

## 5. Cost model & projection

Current: ~$3/weekly-active/week, mostly experiment overhead. With the fixes in §7 plus Sonnet-5 consolidation and cache breakpoints on the Haiku gate prompts (quality/vet/grade/dedupe ran ~1.2M input tokens/14d with **zero** cache), the player-proportional core projects to **$0.30–0.50/weekly-active/week**. Verification capacity via Batch API is effectively unbounded (100k requests/batch; ~24h latency is fine for a demote-only background net).

What bends the curve vs. moves it: **`D-SUPPLY-FINITE-SET-01`** (still unratified). Infinite top-up pools ⇒ cost scales with play-time forever; finite completable sets (~15–30/territory) cap per-domain cost at a constant. Every prerequisite now exists (authored graph, node weights, mastery-v2, fragmentation fixed, crafter pipeline).

## 6. Ranked recommendations

1. ~~Fire the Batch verify path + backlog blitz~~ **DONE with this PR** (§7).
2. Finish Sonnet-5 consolidation before Aug 31 (intro pricing).
3. ~~Tighten the prefilter explanation path~~ **DONE with this PR** (§3).
4. Cache breakpoints on Haiku gate + remaining verify prompts (audit the 4,096-token Haiku cache minimum per prompt).
5. Flip fandom-grounding Consumer B (verifier domain allowlist), then Consumer A after the finite-set call — attacks the 13% demotion rate at the source.
6. Reconcile refill posture; if kept on, rebuild on Batch API.
7. Hygiene batch: `generated_by_model` column, `VOYAGE_API_KEY`, web-search version unification, schedule-or-delete `prompt-proposal`, revisit the $42 ceiling.
8. Ratify the finite-set decision.

## 7. Actions taken alongside this doc (2026-07-05)

- **`custom_id` bug fixed** (`verify-batch.ts`): colon → underscore; legacy-tolerant decode; pattern regression test.
- **Prefilter explanation path tightened** (`verification-prefilter.ts`): adjacent-claims heuristic + `PREFILTER_EXPLANATION_LEGACY` hatch; measurement script extended to three variants (`scripts/measure-prefilter-skip-rate.ts`).
- **Backlog blitz executed** (`scripts/verify-backlog-blitz.ts`, reusable): 643 actionable rows → 135 stamped `skipped` free, 508 submitted as two Batch-API batches (`msgbatch_01VXkDri…` ×500, `msgbatch_01KJpYCc…` ×8, ~$3 est.); harvested via `--harvest` or by the daily cron (its submit phase waits for in-flight runs, so no double-billing).
- First real `VerifyBatchRun` rows recorded; the daily cron's async mode is now genuinely operational.
