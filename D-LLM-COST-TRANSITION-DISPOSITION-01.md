# D-LLM-COST-TRANSITION-DISPOSITION-01 — Review of "Joshing LLM Cost Transition"

**Status:** Review only. **No build authorized, no decision ratified.** Recommends a narrowed Phase 1 plus one measurement before the rest of the plan is committed to.
**Date:** 2026-08-27.
**Subject:** the proposed decision doc *Joshing LLM Cost Transition* (Status: Proposed, dated 2026-08-27), covering LLM question-supply cost only.
**Relates to:** `D-SUPPLY-FINITE-SET-01` (RATIFIED 2026-07-05), `D-SUPPLY-LADDER-UNIFY-01` (RATIFIED 2026-07-08), `B-SUPPLY-REFILL-FLIP-01-FINDINGS` (flip BLOCKED → PAUSED 2026-07-01), `D-LLM-PROVIDER-AB-AND-GATE-TIER-01`.

---

## §0 Provenance and method

All code citations are **repo-relative to `Joshing-11`**, read against `dev2` at `efd7825`. Line numbers are accurate as of that commit — re-check them if this is picked up much later.

The review was performed against a **read-only checkout with no credentials**: no Joshing database, no production ledger, no access to the two weekly reports beyond the figures quoted in the proposal itself. Every finding below is therefore an argument from **code structure and prior decision records**, not from measured spend.

That is enough to justify running §5 *before* committing to the plan. It is not a substitute for §5. §6 lists what this review could not check.

---

## §1 TL;DR

**The diagnosis is right. Most of the evidence under it is not load-bearing.**

"The cost problem is supply policy and production volume, not gameplay" is correct and well-supported. `102 domains filling, 0 resting` is a system with no stop condition, and Premise 3 — domain-size estimates are breadth, not targets — is the right root-cause statement.

But three of the four phases rest on numbers that don't mean what the document takes them to mean, and Phase 2 re-decides a question the project **already ratified seven weeks earlier, with a different and arguably better answer**.

Recommendation: ship a **narrowed Phase 1**, run **one query** that already exists, then re-decide whether Phases 2 and 3 earn their cost.

---

## §2 Findings that change the plan

### 2.1 The "4.9 fact-check calls per question" figure is an aggregation artifact

`src/server/db/queries/llm-cost-report.ts:94` maps **seven** scopes into the "Fact-checking questions" bucket:

```
vet-question, recheck, batch-verify, ask-to-answer-cold,
ask-to-answer-judge, audit:gate, questions-suggest-verify
```

Several are not per-newly-generated-question at all:

- `audit:gate` is the **offline audit script**. A single n=80 run (`scripts/audit-gate-compare.mjs`) adds 80 calls and **zero** generated questions.
- `recheck` re-verifies **existing** inventory, not new output.
- `ask-to-answer-*` is a different surface entirely.

So `565 ÷ 115` divides a seven-scope numerator by a one-scope denominator. Phase 3's headline task — "determine why the pipeline averages approximately 4.9 fact-check calls per generated question" — may have the answer **"it doesn't."**

**Action:** recompute per-scope before spending any effort on this.

### 2.2 Calls are not dollars, and part of the $8.86 is non-recurring

The evidence gives a *call count* for verification and a *dollar* figure only in aggregate (98.5%). There is no split between generate / quality / verify.

The code explicitly flags `self-containment` (`llm-cost-report.ts:83`) as "the single largest scope by call count" and "a one-off, migration-shaped backfill rather than steady-state per-question cost."

If a self-containment sweep ran inside Aug 10–24, then the steady-state baseline is **below** $4.43/week and the available prize is smaller than the document claims — while some of the spend it is trying to eliminate is already self-terminating.

### 2.3 The baseline is a floor, not a total

`recordLlmUsage` is called **only on the success path** (`src/lib/llm.ts:335`). The `catch` branch — timeouts, aborts — records nothing, while the provider still bills the tokens consumed.

Against the documented "variable, un-config-tunable per-call latency (~25s → >220s for the same call within an hour)" and the 65% per-call timeout rate observed on the grounded path, failures are not rare.

**Therefore $8.86 and 565 are both floors.** The document's Assumption 1 ("the two attached weekly reports accurately capture all production LLM spend") should be marked **known false in a specific way**, not "to validate."

*Closed gap, for the record:* the June 2026 finding that web-search spend was off-ledger has since been fixed — `web_search_requests` is recorded and priced at `WEB_SEARCH_USD_PER_REQUEST = 0.01` (`src/server/llm/pricing.ts:111,156`).

### 2.4 Phase 2 conflicts with a ratified decision

`D-SUPPLY-FINITE-SET-01` was **RATIFIED 2026-07-05**: topics are *finite completable sets* of ~15–30 fan-salient questions; completion is a trophy → designation → invitation to graduate or author.

That already kills speculative filling, and it supplies a stop condition anchored to the **topic**. Phase 2 proposes a *different* policy — 14-day demand forecast plus buffer — without referencing or superseding it. Two problems:

1. **Two live supply policies.** Nothing in the document retires the ratified one.
2. **The forecast is circular at pilot scale.** Thin supply suppresses play → lowers forecast demand → suppresses refill → thins supply. Finite-set has no such feedback loop: the target is a property of the topic, not of usage.

**Recommendation:** keep Premise 3, **drop Phase 2's forecast**, implement the ratified finite-set cap instead. Same savings, less machinery, no new decision to litigate.

### 2.5 Phase 1's "$1/week cap" is a build, not a flip — and points at the wrong path

`LLM_MONTHLY_USD_CEILING` already exists (`retrieval-config.ts:98`, default `0` = disabled) — but it is read **only** inside the grounded refill run (`retrieval-grounded.ts:340`), and **that path is off** (`RETRIEVAL_GROUNDING_ENABLED=false`, PAUSED since 2026-07-01).

The $8.86 came from the **ungrounded generate/verify path, which has no app-level budget guard at all.** The cap is real work, not a config change.

"Pause domain-wide refill behavior" is also under-specified. Joshing has several supply mechanisms with separate flags and modules: grounded refill (off), narrow-KB guard (off), broaden-borrow (on), expansion/graduation (built), plus `supply-backfill.ts`, `replenish-bank.ts`, `queue-orchestrator.ts`. **Name the module being paused.**

*Available today:* the Anthropic Console org spend limit — already described in code as "the hard, platform-level global backstop that also covers per-user generation." Set it now as a net while the in-app cap is built.

### 2.6 Goals 1 and 3 cannot both hold at current volume

Taking a Daily Five as 5 questions: 48 graded answers ÷ 5 = **9.6 completed Daily Fives per two weeks**.

- Goal 1 ($1/week) = $2 per two weeks → **$0.21 per completed Daily Five**.
- Goal 3 asks for **$0.15**.

Hitting both requires ~13.3 Daily Fives per two weeks — a **~40% play increase you do not control**.

The metric is also undefined: **fully-loaded** (amortizing inventory build) or **marginal**? Marginal is already ~$0.007 per Daily Five ($0.07 ÷ 48 answers × 5) — about 20× under target and trivially "met" without any of this work. Pick one definition and state it.

### 2.7 Goal 2's baseline does not exist yet

$0.076 is spend ÷ questions **made**. "Per **trusted** question" requires the reject rate — which Phase 4 concedes is not currently tracked. Until it is, the true baseline is ≥ $0.076 and the $0.03–$0.04 target is unanchored.

It is also a poor completion gate. If Phases 1–2 succeed you generate very few questions, so the average becomes noisy and can *rise* (escalations concentrate on hard cases) — perversely rewarding more generation to average the number down.

### 2.8 Parts of Phase 3 are already built, or already disproven

- **"Batch generation and verification."** Already live for verification: `batch-verify` and `batch-dedupe` scopes exist and `LlmUsageEvent.is_batch` carries the Batch-API discount marker. The remaining structural move (async Batch API, no 300s ceiling) was already scoped and **deliberately deferred at 18-user scale**, gated on `web_search`-in-Batch feasibility.
- **"Escalate to additional fact-checking only for low-confidence."** Already tested and failed. `scripts/audit-gate-variance.ts` (n=40) showed Haiku **over**-flags under a loose prompt with **zero unique catches** versus Sonnet — an ensemble/cascade is not a Sonnet substitute (`D-LLM-PROVIDER-AB-AND-GATE-TIER-01`). Do not re-run this.
- **"Cache the stable editorial rubric."** Cache tokens are already tracked (`cacheReadTokens` / `cacheCreateTokens`). Check whether caching is already on before building it.

**The genuinely unexplored and worthwhile part of Phase 3 is the *non-LLM* structural and duplicate pre-checks.** That bullet should be the whole phase.

### 2.9 Phase 4 is a prerequisite for Phases 2 and 3, not a follow-up

It is the instrument that establishes both baselines (§2.2, §2.7) and validates the changes. It is also **smaller than written** — the report already buckets by surface, already tracks `is_batch`, and `getExpensiveDomains` (from `crafter-demand`) appears to already be the "domains generating content without demand" line.

**Correct order: 1 → 4 → (re-decide 2 and 3).**

### 2.10 The quality gate is unfalsifiable at this volume

"A measurable increase in question reports, corrections, or factual disputes" — at 48 answers per two weeks across ~18 users there is **no statistical power** to detect a regression. The gate promises a protection it cannot deliver.

Wire it instead to the **offline calibration set** (which Phase 3 already names) and the audit scripts that already exist, not to live player signals.

### 2.11 Unaddressed backfire risk: emergency generation

Pausing background fill converts cheap **asynchronous** generation into **synchronous, player-facing** emergency generation at Daily Five assembly — on precisely the path with the documented variable-latency problem. That threatens the cost goal *and* the "no player-facing latency regression" gate simultaneously.

**Phase 1 must cap the fraction of Daily Fives assembled via emergency generation, and treat a rise in that fraction as a stop condition.**

---

## §3 What the document gets right

- The core diagnosis: supply policy and production volume, not gameplay.
- Premise 3 (domain-size estimates are breadth, not inventory targets) — the actual root cause, correctly identified.
- Premises 1, 4, 6, 7 — sound.
- Premise 5 (gates may be reordered/batched/cached but not removed without evidence) — correct, and consistent with the tier findings.
- Phase 1 as the first move.
- The instinct to run in report-only/shadow mode behind a reversible flag.

### The argument is framed too weakly

"$4.43/week → $1/week" is roughly **$180/year**, and will read as not worth the engineering. The stronger argument is already in the document's own evidence:

> **102 domains filling, 0 resting** means spend scales with the **taxonomy**, not with the **player base**. At ~18 users, cost is already decoupled from value in the wrong direction, and it grows as topics are added rather than as players arrive.

Lead with *"make spend a function of players, not domains."* That justifies Phase 1 immediately — and justifies **not** building Phases 2–3 yet.

---

## §4 Recommended revision

1. **Ship Phase 1 only**, narrowly scoped to a **named module**, with (a) the emergency-generation fraction capped and monitored per §2.11, and (b) the Anthropic Console org spend limit set today as a backstop.
2. **Run §5's query.** Most of Phase 4 is reading what already exists.
3. **Then re-decide Phases 2 and 3.** Current expectation: Phase 3's non-LLM prechecks earn their keep; Phase 2 does not, because `D-SUPPLY-FINITE-SET-01` already covers it.
4. **Restate the goals** so Goal 1 and Goal 3 are consistent (§2.6), define cost-per-Daily-Five as fully-loaded or marginal, and defer Goal 2 until the reject rate exists.
5. **Re-wire the quality gate** to the offline calibration set (§2.10).

---

## §5 The one measurement to run first

`readSurfaceCost(startDaysAgo, endDaysAgo)` — `src/server/db/queries/llm-cost-report.ts:237` — already returns **USD per surface bucket** for an arbitrary window. For Aug 10–24:

```ts
readSurfaceCost(17, 3)
```

This single call settles §2.1 and §2.2: whether verification actually dominates the 98.5%, and whether a `self-containment` sweep inflated the baseline. **Phase 3's entire premise rests on the answer.** It should be run before this document is committed to.

---

## §6 What was not verified

- **The per-bucket dollar split itself.** `joshing-reference/` ships only `.env.example` — no Joshing credentials — and this project points at a different database by standing policy. §5 must be run against Joshing's own deployment.
- **The reject rate** (trusted vs. generated), for the same reason.
- **Whether the Aug 10–24 window actually contains a self-containment sweep** (§2.2).
- **Current trusted inventory depth.** The document lists "existing trusted inventory is sufficient to pause broad refilling safely" as an assumption to validate. It is the single fact that determines whether Phase 1 is safe to ship, and it is cheap to measure. **It should be a precondition, not an assumption.**
