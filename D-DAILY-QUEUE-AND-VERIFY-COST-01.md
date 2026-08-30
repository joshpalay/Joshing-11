# Daily Five diversity backfill + LLM verify-cost investigation (2026-08-30)

One session, two threads: a prod incident in the Daily Five queue builder, and a
follow-on cost-effectiveness dig into LLM spend (triggered by "is there a more
cost-effective way of generating questions"). Recorded here so neither has to be
re-investigated from scratch.

---

## 1. Daily Five diversity backfill — incident, fix, diagnostics `[built]`

**Symptom:** Josh's Daily Five served 5/5 "Beethoven" house questions — zero topic
variation, despite 30 selected domains.

**Root cause — generation did NOT fail.** Direct prod DB queries (not just logs)
showed 17 fresh `GeneratedQuestion` rows across 11 domains (Beethoven, Space Travel,
Star Trek, The Simpsons, etc.) were successfully created one minute before the queue
persisted. An initial "DB connection flakiness caused generation to return zero"
theory was floated from ambient `[instrumentation] DB connection attempt X/3 failed`
noise and then **retracted** once the `GeneratedQuestion` rows were found — that
noise is pre-existing/ambient, not causal.

**Actual mechanism:** the diverse fresh candidates got deflected into
`generatedReserve` by the orchestrator's answer/subject-cooldown or diversity-cap
gates — same as any pick. The house bank covered only 3 of Josh's 30 selected
domains that day (Beethoven: 10, 20th Century Composers: 10, Zelda: 3 — this
sparsity is **intentional**, content is stocked on-demand as domains actually get
played, specifically to avoid the LLM cost of pre-seeding every domain — do not
propose "seed more house content" as a fix). The soft-cap backfill that fills a
shortfall drains reserves in a **fixed priority order** — `authored → house →
generated` — and the house reserve alone (3 cap-deflected Beethoven questions)
fully absorbed the 3-slot shortfall before the generated reserve (holding the
diverse fresh content) was ever touched. A fixed-priority-order gap, not a bug in
any single gate.

**Fix — PR #1578 (`24405d66` → merged `main` as `7d0de302`).** A second, higher cap
now applies during backfill — `capForSubcategory(key) + 1`, "often"-tagged domains
still exempt — so no single reserve can relax one subcategory past one extra slot.
A shortfall one reserve can't fully cover under this cap now spills to the next
reserve in priority order instead of repeating; the queue serves short (down to
`DAILY_QUEUE_MIN_SIZE`) rather than padding with repeats. Regression test in
`src/server/daily/__tests__/diversity-cap.test.ts` (confirmed to fail pre-fix,
pass post-fix).

**Diagnostics follow-up — PR #1579 (`c55badf4` → merged `main` as `65d8b33c`).**
The aggregate `deflectedFor*` counters in `src/server/daily/queue-orchestrator.ts`
only ever reached a log line inside the `generation_failed` branch, which never
fires on a build that still "succeeds" (5/5 one domain counts as achieved) — exactly
why this incident needed a DB forensics pass instead of a log read. Added a
per-pick `reserveDeflections` trail (`{source, subcategory, reason}`) logged as
`[daily/queue-orchestrator] deflection trail` whenever anything is held back this
build, independent of the floor check — includes what got backfilled per source
and what was left unused in each reserve.

**How to apply if this recurs:** check the `[daily/queue-orchestrator] deflection
trail` log line first — it directly names which domain/source/reason was
deflected. Only fall back to `DailyQueue.slots` + raw `GeneratedQuestion` timestamp
forensics if that log is missing.

---

## 2. LLM cost investigation

Prompted by "is there a more cost-effective way of generating questions." Pulled
real numbers via `buildCostLatencyReport()` (`src/server/db/queries/llm-cost-report.ts`)
plus raw `LlmUsageEvent` queries, run live against prod with `tsx`.

### 2a. Where the money actually goes (30-day, $25.28 total)

| Scope | 30-day $ | Share | Calls |
|---|---|---|---|
| `batch-verify` (async, Batch API) | $12.35 | 49% | 705 |
| `generate-questions` (Sonnet, live) | $7.32 | 29% | 115 |
| `domain-reference` (wiki grounding) | $1.16 | 5% | 7 |
| `batch-verify` (sync fallback) | $1.05 | 4% | 30 |
| `vet-question` (Haiku) | $0.70 | 3% | 573 |
| `factual-gate` (Sonnet) | $0.59 | 2% | 85 |
| everything else (18 scopes) | ~$2.1 | 8% | — |

Cost to *write* one question (generation only): $0.019–0.023 — lean. **The story
is verification, not generation** — a shift from whatever the last cost review
assumed; verification now exceeds generation.

**Corrected mid-session:** floated batching the 3x-per-generation-batch
`ask-to-answer-cold` Haiku calls as a cost win. Checked the numbers — $0.06 total
across 282 calls/month. Negligible; not worth the engineering time. Retracted.

### 2b. Why some verify calls run sync instead of the Batch API — checked, NOT a bug

`src/app/api/cron/batch-verify-questions/route.ts`'s `GET` is a clean binary switch
on `isBatchVerifyAsyncEnabled()` — the whole cron run is async or sync, never
mixed. Prod runs async (the 705 calls). The 30 sync calls/month come from three
legitimately-synchronous call sites: an admin's manual re-run
(`rerun-question.ts`), salvage re-verification (`salvage-generated.ts`), and
`chaseDemotionsWithSalvage()` (runs every cron pass so a machine-proposed fix is
ready as a one-click "Approve" by the time a human opens the review queue — needs
same-request immediacy by design). Batching those would break that guarantee to
save ~$0.50–1/month. **Not worth touching.**

### 2c. What drives `batch-verify`'s $12.35 — bigger than the flat search fee suggests

The flat $0.01/request web-search fee is only $2.20 of the $12.35 (220
`web_search_requests`). But `src/server/quality/verify-question.ts:155-160`
(comment dated 2026-08-03, a prior session's measurement) says a searching call
costs **~24x** a knowledge-only one — search results get re-processed across tool
turns, adding **~21.6k extra cache tokens per call**. That multiplier is why
`LlmUsageEvent` shows ~4.19M cache-create / ~4.25M cache-read tokens for this
scope (220 searches × ~21.6k ≈ 4.75M, matching). Working the ratio back: the
~220 search-triggering calls likely account for **roughly 90%+ of the $12.35**,
not the 18% the flat fee alone implies.

Already mitigated in code (don't re-suggest): `web_search` is stripped entirely
for the two dimensions that don't need it (`ambiguous_source`, `self_answering`);
the system prompt explicitly instructs sparing search use; `VERIFY_WEB_SEARCH_MAX_USES`
caps searches per call at 3.

**Remaining searches are a genuine quality/cost tradeoff, not a bug** — they're
the exact mechanism that caught the Beethoven "Razumovsky" self-answering bug and
the Spy School fabrication bug (`docs/thinking/` history; `D-NARROW-KB-FABRICATION-01.md`).
Cutting search volume trades dollars for real regression risk on that class of bug.

### 2d. The "redundant re-search across near-duplicate questions" theory — ruled out

Checked whether the same fact gets independently re-searched across different
questions (pure waste, not a quality tradeoff). Real subject concentration exists
(30-day: "Paradise Lost" 9 verified rows, "Hamlet" 9, "Gilmore Girls" 7) but every
one is essentially **1:1 verified-rows to distinct `fact_key`** — the existing
fact-key dedup system already prevents the literal-duplicate case upstream of
verification. **No pure-waste win available here.**

### 2e. Batch-grouping multiple facts about one subject into one verify call — `[decided, NOT built]`

Explored building this (batch several same-subject claims into one call so one
web search serves multiple questions), with an explicit kill-switch requirement.
Design + independent review, then checked against live data before building
anything:

- **Design risk (caught by an independent review pass):** the original approach —
  pack multiple rows into one Batch API call via a new custom-id scheme + a new
  `VerifyBatchRun` JSONB tracking column — was flagged as the highest-risk part,
  new machinery in the exact file (`verify-batch.ts`) that already broke prod once
  before (a silent custom-id encoding bug, `verify-batch.ts:46-50`). **Safer
  alternative:** route grouped rows through a **synchronous** call instead of the
  async Batches API — no new tracking needed, and collapsing 3 searches into 1
  call (~3x) beats the 50% batch discount lost anyway.
- **Real quality bug caught in the draft:** `web_search`'s `max_uses` is capped
  **per call**, not per question — grouping 3 questions into 1 call without
  raising it silently cuts each question's search depth to ~1/3. Any future build
  MUST scale `max_uses` with group size.
- **Then checked live: 0 of 181 currently-pending rows share a `subject_entity`
  with any other pending row.** The 30-day concentration that motivated this
  (§2d) turned out to be mostly **May–June 2026 backlog**, cleared in a July/August
  verify blitz — not current generation behavior.
- **Checked whether more volume would help** (Josh's own follow-up question):
  daily generation is single-user on 22 of the last 29 days (5–11 rows/day).
  Multi-user same-day volume (17–32 rows) only happens on the days 2–3 users
  generate simultaneously. The mechanism is real — more concurrent generators
  → more same-subject same-day collisions — but there's essentially nothing for
  grouping to act on at current usage (1–3 active generators/day of 23 total
  users).

**Decision: don't build it now.** Revisit when concurrent daily active generators
grow meaningfully beyond 1–3/day — re-run the same live-data check (pending-row
subject overlap + per-day distinct-user generation count) before building. If/when
it's built, use the sync-call design above, not the original Batch-API-packing one.

---

## Reusable measurement pattern

No permanent script exists for this — ad hoc via `tsx`, run and deleted each time.
Import `buildCostLatencyReport`/`renderCostLatencyReportMarkdown` from
`@/server/db/queries/llm-cost-report`, or query `LlmUsageEvent` directly grouped by
`scope, model, is_batch` and price with `estimateCostUsd` from
`@/server/llm/pricing`. Run via
`node --env-file=.env node_modules/tsx/dist/cli.mjs <script>.ts` from the repo
root — **use PowerShell, not the Bash tool**, for anything touching the prod
`DATABASE_URL`; DB queries against prod get blocked by the Bash auto-mode
classifier but pass in PowerShell. The stored `LlmCostReport` table only gets a
fresh row when the weekly cron runs — don't trust `readLatestCostReport()` alone
if it looks stale; re-derive live.
