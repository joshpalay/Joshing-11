# `LlmUsageEvent` under-reporting gaps — fix before any refill soak

**Date:** 2026-07-01. **Basis:** the 2026-07-01 spend spike (Anthropic dashboard **\$7.56** token cost + **\$1.80** web search) vs. what our own ledger could see (~\$3). Two structural gaps make `LlmUsageEvent` under-report real spend. **Fix both before the refill soak starts — the soak's weekly \$ number is otherwise a token-only undercount.**

## Gap (a) — web-search spend is uncaptured
`LlmUsageEvent` (`schema.ts` ~L1465) has **token columns only** (`input/output/cache_read/cache_create_tokens`, `duration_ms`) — **no web-search column.** Web-search cost (≈\$0.01/request) is never ledgered; it lives only in cron report/log lines. Material: **~\$1.80** on the spike day across refill + `batch-verify`. **Permanent gap** — affects the refill AND the `batch-verify` cron (see `batch-verify-cost-characterization.md`, where the average ~11k input tokens/call is strong evidence of frequent, unledgered web-search).

## Gap (b) — aborted-call tokens are uncaptured
`loggedMessagesCreate` writes the usage row **only after a successful response**; a call that generates tokens and then **times out / aborts** (Anthropic still bills the tokens generated before the abort) throws into the catch path and **records no row.** On the 2026-07-01 refill testing, Sonnet-4.6's ~65% timeout rate meant many ~120s calls burned billed-but-unlogged tokens — the bulk of the ledger↔dashboard gap (ledger saw ~\$3 of ~\$7.56). **On Sonnet 5 this largely self-closes** (no timeouts), but it is documented so nobody re-discovers it the hard way.

## Fix scope (a build, later)
Persist **web-search request counts** to `LlmUsageEvent` (or a sibling row) so cost derivation (`pricing.ts` / `estimateCostUsd`) includes them; optionally record aborted-call token estimates. This aligns with the **`B-LLM-COST-LATENCY-REPORT-01`** weekly-digest thread (the `LlmCostReport` table, `schema.ts` ~L1491, and `docs/llm-cost-action-plan.md`) and its "no false-confidence \$0 readouts" principle — **cross-reference that work rather than duplicate it.** (Note: the exact doc `D-LLM-COST-LATENCY-REPORT-01` referenced elsewhere does not exist under that name; the real artifacts are the `B-`-tagged feature + `docs/llm-cost-action-plan.md`.)

## GATE
Must land **before `RETRIEVAL_GROUNDING_ENABLED` soak begins** — otherwise the soak's weekly \$ number is a token-only undercount. **Not** blocking for the AC-1 confirmation run (that reads combined \$ from the cron log line directly).

## Gate updated (2026-07-01, `CC-SUPPLY-HALT-01`)
The soak this fix gated is **itself PAUSED** pending `D-SUPPLY-FINITE-SET-01` (see `docs/decisions-pending/D-SUPPLY-FINITE-SET-01-PENDING.md`). This fix remains a prerequisite for **any** refill soak — infinite *or* finite; an honest weekly \$ number is needed either way — but it is **not urgent while refill is paused.** Keep for whenever supply resumes.
