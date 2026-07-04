# batch-verify cron — cost characterization (read-only, no LLM calls)

> **UPDATE (2026-07-02): the three cost dials this doc named have landed.**
> 1. **System-prompt caching** — `buildVerifyRequestParams` now sends the system
>    prompt with an ephemeral `cache_control` breakpoint (live in both modes).
> 2. **`extra_fact` tightening** — the answer heuristic now requires bundling
>    **plus** an assertion signal (`answerCarriesAdjacentClaim`), not just a
>    comma/"and"; the explanation path is unchanged. Live by default; escape
>    hatch `PREFILTER_EXTRA_FACT_LEGACY=true`.
>    **MEASURED 2026-07-03: a near-NO-OP (skip 9.3% → 9.8%; no leak; hatch stays
>    OFF).** See the dedicated before/after section below for the full numbers
>    and the §5 retraction — the dominant router is the *explanation* path, so
>    the operative cost dials are #3 (Batch API 50%) and the web-search-frequency
>    posture, not the pre-filter.
> 3. **Batch API mode** — `BATCH_VERIFY_ASYNC_ENABLED=true` (flag-off default)
>    runs the cron two-phase over the Message Batches API: 50% off all token
>    usage, no per-call timeout, verdicts land ~24h later. Docs confirm
>    `web_search` runs inside a batch (the batch worker throttles + retries it
>    org-wide). Async scans `BATCH_VERIFY_ASYNC_BATCH_SIZE` (default 40)/store,
>    fixing §1/§4's ~26/day GeneratedQuestion creep. Ledger rows carry
>    `is_batch` (0106) so the discount prices honestly.
> The §3 web-fallback measurability gap also closed: `web_search_requests` is
> ledgered per call since 0105.

**Date:** 2026-07-01 · **Method:** live code + read-only `LlmUsageEvent` queries + the PURE `prefilterForVerification` run over a 600-row recent sample (zero LLM spend). · **Scope:** `/api/cron/batch-verify-questions` (`B-QUESTION-QUALITY-AGENTS-01` Phase 3). **The code is sound** (unstamped-only selection, stamp-on-every-outcome, pure pre-filter, web-as-fallback). The question is **steady-state daily rate and right-sizing**, not correctness.

## Config (confirmed in code)
- `BATCH_SIZE = 25` **per store** → ≤50 rows scanned/day across `Question` + `GeneratedQuestion`.
- `VERIFY_CONCURRENCY = 4`, `maxDuration = 300`, schedule `0 10 * * *` (daily).
- Selection: `verifiedAt IS NULL` (+ not blocked/deleted / not duplicate/expired); every outcome stamps `verifiedAt` + `verificationVerdict`, so rows are scanned once. A verifier **failure** leaves the row unstamped → retried next sweep.
- Model = `ANTHROPIC_MODEL` (**now Sonnet 5** since the 2026-07-01 flip); web tool = `web_search_20250305`, `WEB_SEARCH_MAX_USES=3`, web-as-fallback.

## Measured numbers

**Ledger (`scope='batch-verify'`), by day:**
| Day | Calls | Input tok | Output tok |
|---|---|---|---|
| 2026-06-30 | 12 | 121,859 | 3,762 |
| 2026-07-01 | 46 | 517,772 | 11,564 |

Only two days of data (cron is new). 07-01's 46 calls is **near the ~50/day structural max** — i.e. it maxed out both stores' `BATCH_SIZE`.

**New-row rate (verification demand), last 14 days:** `GeneratedQuestion` **368 (~26/day)**, `Question` **236 (~17/day)** — ~43 new rows/day total.

**Pre-filter skip rate (empirical, pure fn over 300 recent rows/store = 600):** **skip 55 (9%)**, route 545 (**91%**). Dimensions among routed: `false_premise` 266, **`extra_fact` 543**.

### Before/after the `extra_fact` tightening — MEASURED 2026-07-03 (`measure-prefilter-skip-rate.ts`, 600-row recent sample)

| variant | skip | route | false_premise | extra_fact |
|---|---|---|---|---|
| **legacy** (any comma/paren/"and") | 56 (9.3%) | 544 (90.7%) | 260 (43.3%) | 542 (90.3%) |
| **strict** (bundling + assertion signal) | 59 (9.8%) | 541 (90.2%) | 260 (43.3%) | 539 (89.8%) |

**The tightening is a near-no-op: skip 9.3% → 9.8% (+0.5pt), only 3/600 rows (0.5%) flip route→skip.** This *contradicts* §5's "biggest lever" expectation. Why: `extra_fact` routing is dominated by the **explanation path** (`explanationCarriesClaims`), not the answer heuristic. Of the 542 legacy `extra_fact` routes, 539 still route under strict — the explanation independently routes them — so tightening the *answer* heuristic only touches the 3 rows routed **solely** by it. The real dominant router is `explanationCarriesClaims` (fires on ~90% of rows: `trimmed.length >= 140` OR any one signal). **To move skip rate materially you must tighten the explanation path, not the answer path.**

The 3 route→skip flips were eyeballed for leaked checkable claims — **none leaked**, so the legacy hatch stays OFF (tightened default):
- `What does Yossarian decide to do at the novel's end?` → "Desert and flee to Sweden" (the compound verb IS the answer, correct)
- `What is Rose's hometown?` → "St. Olaf, Minnesota" (city,state bundle, canonical, correct)
- `In what city is The Golden Girls set?` → "Miami, Florida" (city,state bundle, canonical, correct)

All three are exactly the structural bundling (`City, State` / `X and Y`) the tightening was designed to skip — no unasked adjacent claim that could independently be wrong. The tightening is *safe* but *not a cost lever*; the answer heuristic is nearly redundant with the explanation path.

## Answers to the five questions

1. **Backlog vs steady state.** Too few days to see a clean first-run spike, but 07-01 ran at the cap (46/~50). Steady-state demand ≈ new-rows/day × route-rate ≈ 43 × 0.91 ≈ **~39 verification calls/day**, capped at 50/day. **Per-store is the catch:** `GeneratedQuestion` new-rate **~26/day ≈ its 25/day cap** → generated-question verification is **at/slightly over capacity** (its unstamped backlog does not drain and may creep up ~1/day). `Question` new-rate ~17/day < 25 → **keeps up and drains**.
2. **Pre-filter skip rate ≈ 9% — LOW.** The pre-filter barely filters. Cause: **`extra_fact` routes 543/600 (≈90%)** because `answerIsMultiFact` fires on any answer containing a comma+word, `(`/`;`, or " and " — which is most answers. `false_premise` is more selective (266). So the pre-filter's spend-saving is small; **the `extra_fact` heuristic is the single biggest cost dial.** For this content (fan-salient, situated questions with descriptive answers), near-universal `extra_fact` routing looks **over-broad**, not well-calibrated.
3. **Web-fallback rate — not directly measurable** (`usedWeb` is computed in `verifyQuestion` but **not persisted**; the ledger has no web-search column — see `ledger-telemetry-gaps.md`). **Strong indirect signal:** average **~11.3k input tokens/call** (07-01) is very high for a short question + verdict — consistent with **frequent web_search** (results injected into context add thousands of tokens). This suggests the knowledge-first gating is **firing web-search often** on Sonnet, i.e. the "search only when knowledge can't settle it" posture may be weaker in practice than intended. This is the main driver of both the token line and the separate web-search $.
4. **The `BATCH_SIZE=25` ceiling.** For `Question` (17/day) it is comfortably above new volume (fine). For `GeneratedQuestion` (~26/day) it is **a floor at/under demand** → verification of generated questions never quite catches up. Not catastrophic (~1/day creep), but it means the newest generated rows wait, and a volume increase would widen the gap.
5. **Right-sizing options (analysis only — nothing changed):**
   - ~~**Tighten `extra_fact` routing (biggest lever).**~~ **RETRACTED — measured 2026-07-03 (see the before/after table above).** Tightening the *answer* heuristic lifted skip only 9.3%→9.8% (3/600 rows). The lever was misidentified: `explanationCarriesClaims` — not `answerIsMultiFact` — is the near-universal router (~90%). The real biggest lever is the **explanation path** (`trimmed.length >= 140` OR any signal routes it). Tighten that to move skip rate materially; the answer heuristic is already nearly redundant.
   - **Add prompt caching.** `verify-question.ts` passes `system: SYSTEM_PROMPT` as a plain string with **no `cache_control`** — every call re-bills the (~1k-token) system prompt uncached. An ephemeral cache breakpoint would shave input cost across all calls.
   - **Right-size the generated-store cap.** Either raise `BATCH_SIZE` for `GeneratedQuestion` to clear its ~26/day inflow, or accept the small lag deliberately.
   - **Confirm web behavior on Sonnet 5.** (a) verify `web_search_20250305` (the older tool version) is still accepted by `claude-sonnet-5` — the cron now runs on it; (b) re-check that knowledge-first gating actually holds on Sonnet 5, given the high average input.
   - **Or leave as-is** if the ~$2/day (below) is acceptable; the cron is correct and demote-only.

## Cost estimate
07-01 token cost ≈ (517,772 × \$3 + 11,564 × \$15)/1e6 ≈ **\$1.73/day** (Sonnet-tier), + web-search (separate meter; part of the day's \$1.80 web line) ≈ **~\$2/day ≈ ~\$60/month**. At ~18 users this is currently the **single largest recurring LLM line** — larger than the whole question-generation Sonnet spend (~\$9/month). The `extra_fact` over-routing and the frequent web-search are the two things making it so; both are dials, not bugs.

## Recommendation
Not urgent, not broken — but **before it's treated as steady baseline, tighten `extra_fact` routing and add system-prompt caching**; those two changes likely cut this line substantially without weakening the demote-only safety net. Re-measure after the `extra_fact` change. (Unrelated to the supply-refill pause — this cron proceeds independently.)
