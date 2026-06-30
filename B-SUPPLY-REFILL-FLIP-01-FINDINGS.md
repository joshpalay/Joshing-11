# B-SUPPLY-REFILL-FLIP-01 — Verification Findings

**Status:** Flip **BLOCKED** pending a throughput build. The grounded pool-refill works (it persists good corroborated questions and its quality gates are healthy), but in its current **sequential** form it cannot drain real demand within the cron's 300s budget. Recommendation: build `B-SUPPLY-REFILL-THROUGHPUT-01` (intra-run concurrency) **before** flipping `RETRIEVAL_GROUNDING_ENABLED` on.

**Date:** 2026-06-30. **Author:** verification pass against live prod data.
**Relates to:** `D-SUPPLY-LADDER-UNIFY-01.md` (rung 1, grounded refill) and the prompt `docs/build-prompts/B-SUPPLY-REFILL-FLIP-01.md`.
**Prod state at writing:** `RETRIEVAL_GROUNDING_ENABLED=false` (untouched); `RETRIEVAL_SYSTEM_USER_ID=6d3c8553-…` = the dedicated **Joshing Library** account (pre-staged); `NARROW_KB_GUARD_ENABLED` off (S5 honored). Migration head `0097`. No migration introduced.

---

## TL;DR

- **Demand is real:** 43 thin-active domains (depth < 8, active in 14d).
- **The mechanism works:** a real run persisted **4 corroborated, source-backed facts** into the pool (owned by Joshing Library).
- **The quality gates are healthy — NOT the bottleneck:** of domains that completed generation, **57% persisted (4/7)**; the only drops were **corroboration** (3/7, working as designed); the quality screen and ask-to-answer dropped **zero**.
- **The sole blocker is throughput:** **65% of domains (13/20) time out at the 120s per-call limit.** With sequential domains under a 300s `maxDuration`, a prod run reaches only ~2–3 domains and the consistently-slow domains never complete (so they never deepen).
- **The original prompt's premise was wrong:** it scoped this as "mostly a flag flip… not a feature build." Verification shows the flip needs a real (small) throughput build first.
- **Telemetry gap to note:** refill's **token** spend lands in `LlmUsageEvent`, but **web-search** spend does not (token-only ledger). The combined per-run `usdSpent` is in the cron report/logs only.

---

## §4 seam correction (already merged to main)

The machine-pool depth metric refill + the narrow-KB guard read (`getDurablePoolDepthForDomains` / `getThinActiveDomains`) is **already correct** and needs no change: `generatedQuestions` has no `deletedAt` (rows are flagged, never deleted) and every `suppressed_by` loser is a strict subset of `is_duplicate = true`, so `is_duplicate = false` already excludes them. §4's `needs_review` clause is N/A — it targets `Question` rows the metric never counts. Recorded in `DECISIONS.md` and `D-SUPPLY-LADDER-UNIFY-01.md` §4 (merged via PR #1335).

---

## Phase 0 — demand + dry-run (no spend)

`runPoolRefill({ dryRun: true })` against prod data:

```
domainsConsidered : 43      ← thin-active demand exists
domainsProcessed  : 22      ← dry-run projection stops at the $2 ceiling
usdSpent (proj.)  : $1.98   ← worst-case search projection (pre-fix 9 searches/domain)
backlogRemaining  : 21
```

Pre-flip baseline depths (the Phase 3 "before" anchor): all 43 demand domains sit at depth 1–7. Canonical niche target **Spy School Books 1–6** = depth **7**, 15 rows, active today — one fact short of threshold, squarely in demand. (NB: post-fix default is 1 question/domain → ~3 searches/domain, so real per-run economics are ~3× cheaper than the dry-run's worst case.)

---

## Phase 2 — the flip is NOT a flag flip

**Branch staleness (resolved).** The flip depends on `50dbc4f4 fix(retrieval): stop pool-refill timing out on every domain` (per-call timeout 60s→120s, default questions/domain 3→1). Early verification ran against a stale base missing this fix; the work was rebased onto current `main`, which contains it.

**Controlled validation (real Vercel preview, prod DB, $0.50 cap).** With the fix in place:
- DB connectivity + telemetry work (token spend logged to `LlmUsageEvent`).
- But the run **504'd at the 300s `maxDuration`** — 1 domain completed in 36s, two timed out at 120s each (36+120+120 ≈ 276s → killed mid-4th domain).

---

## Yield characterization — 20 thin domains (local run vs prod DB)

| Outcome | Count | Domains |
|---|---|---|
| **Timed out at 120s** | **13 (65%)** | Shakespeare, Hamlet, The Simpsons, HP Book 3, Tudor Dynasty, Music Man, Rent, Golden Era Broadway, Classical Symphonic, Quilting, American City Nicknames, Well-Tempered Clavier, Modernist Fiction |
| **✅ Persisted** | **4 (20%)** | Beethoven Piano Sonatas, Wallace Stevens Poetry, Alternative Medicine, Calculus |
| **Dropped — corroboration** | **3 (15%)** | Mrs. Dalloway, The Golden Girls, Tears of the Kingdom |
| Dropped — quality / ask-to-answer | **0** | — |

`$0.756` spent; **4 facts persisted** (Joshing Library now: 4 rows / 4 live facts). Timed-out calls are ~free (aborted before search billing). Completion times when a domain finishes: **40–110s**; anything past 120s aborts.

**Reading:**
1. **Yield is healthy.** 57% of *completions* persist; every failure among completions is a correct corroboration rejection. Generation + gates are sound.
2. **Throughput is the blocker.** 65% time out (locally; Vercel is ~3× faster per call — Beethoven 36s on Vercel vs 106s local — so prod rate is lower but still material; the preview still showed ⅔ timing out). Timeouts skew **broad** (Shakespeare/Hamlet/Simpsons) — likely more searches when there's endless material.

---

## Recommendation → `B-SUPPLY-REFILL-THROUGHPUT-01` (prerequisite to the flip)

Build, in `runPoolRefill` (`src/server/daily/retrieval-grounded.ts`):
1. **Bounded-concurrency domain processing** — process domains in parallel with a small cap (**~4**, to respect the `max: 5` Supabase PgBouncer pool in `src/server/db/index.ts`). At ~4–5 concurrent, a 300s budget can attempt ~15–20 domains and persist ~6–8 facts/run, draining the 43-domain backlog in 2–3 days and reaching the slow domains.
2. **Budget enforcement under concurrency** — the $2 ceiling is currently checked sequentially before each domain; with a parallel wave that can overshoot. Check the budget before launching each wave; accept a bounded overshoot (≤ cap × per-call worst-case ≈ $0.60) — still under the $2 ceiling and $42 monthly backstop.
3. **Test** the runner + the budget math.
4. **Verify the canonical niche domain completes** — confirm *Spy School Books 1–6* (the rung-2 poster child) finishes within the timeout; broad domains timing out is acceptable, a niche target timing out is not.

Optional cheap complement (named by `50dbc4f4`): raise the cron frequency so more domains are attempted per day. Concurrency is the efficient core fix.

**Then** flip `RETRIEVAL_GROUNDING_ENABLED=true` (env only; code default stays `false`), confirm one real run persists for thin-active domains within budget, and begin the ≥1-week soak (Phase 3). Guard (`NARROW_KB_GUARD_ENABLED`) remains off until refill soaks (S5).

### Also worth fixing during the throughput build
- **Web-search spend telemetry.** `LlmUsageEvent` records token spend only; refill's web-search cost is in the cron report/logs but not the ledger. For an honest soak spend number, either persist web-search counts to the ledger or have Phase 3 read `report.usdSpent` from cron logs (the canonical combined number).
