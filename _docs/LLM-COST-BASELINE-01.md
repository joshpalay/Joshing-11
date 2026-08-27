# LLM Cost Baseline 01 — Step 0 measurement + Step 1 backstop runbook

**Status:** Step 0 measured (2026-08-27). Step 1 authorized, not yet executed — Console actions pending.
**Scope:** LLM question-supply cost only. SMS, hosting, database, monetization out of scope.
**Reproduce:** `npx tsx -r dotenv/config scripts/llm-cost-baseline.ts --start 2026-08-10 --end 2026-08-24`
(read-only; every query is a SELECT against prod).

---

## Step 0 — Baseline, 2026-08-10 → 2026-08-24

### By raw scope

The weekly digest folds these into seven plain-English surfaces; this is the underlying scope
detail the cost plan asked for. Costs are ledger-derived (`estimateCostUsd` over `LlmUsageEvent`).

| scope | class | calls | web searches | USD | model |
|---|---|---:|---:|---:|---|
| `batch-verify` | recurring | 267 | 76 | $4.8055 | Sonnet 5 |
| `generate-questions` | recurring | 48 | 0 | $3.3763 | Sonnet 5 |
| `domain-reference` | recurring | 4 | 9 | $0.7272 | Sonnet 5 |
| `backfill-supply-generate` | **refill** | 3 | 0 | $0.3647 | Sonnet 5 |
| `vet-question` | recurring | 265 | 0 | $0.3242 | Haiku 4.5 |
| `factual-gate` | recurring | 40 | 0 | $0.3052 | Sonnet 5 |
| `quality-gate` | recurring | 40 | 0 | $0.1487 | Haiku 4.5 |
| `history-dedupe` | recurring | 39 | 0 | $0.0879 | Haiku 4.5 |
| `grade` | **gameplay** | 58 | 0 | $0.0802 | Haiku 4.5 |
| `enrich-variants` | user-triggered | 20 | 0 | $0.0698 | Sonnet 5 |
| `salvage-propose` | user-triggered | 7 | 0 | $0.0539 | Sonnet 5 |
| `ceremony-narrative` | commentary | 4 | 0 | $0.0513 | Sonnet 5 |
| `ask-to-answer-judge` | recurring | 20 | 0 | $0.0222 | Haiku 4.5 |
| `ask-to-answer-cold` | recurring | 87 | 0 | $0.0199 | Haiku 4.5 |
| `recheck` | user-triggered | 4 | 0 | $0.0197 | Sonnet 5 |
| `inside-joke` | commentary | 29 | 0 | $0.0186 | Haiku 4.5 |
| `batch-dedupe` | recurring | 14 | 0 | $0.0175 | Haiku 4.5 |
| **TOTAL** | | **949** | **85** | **$10.4928** | |

By class: recurring $9.83 (93.7%) · refill $0.36 (3.5%) · user-triggered $0.14 (1.4%) ·
gameplay $0.08 (0.8%) · commentary $0.07 (0.7%). No unclassified scopes, no unpriced models.

**Why this is $10.49 and the digest said $8.86 for "the same" window.** It is not a method
difference. `inWindow()` (`llm-cost-report.ts:213`) measures rolling hours from `now()`, so
`readSurfaceCost(17, 3)` is a 14-day span ending at the current time of day; this table is 15
calendar days, Aug 10 00:00 through Aug 24 23:59 UTC. Two partial days account for the gap. Future
reports should state which convention they use.

### Which background paths are actually running (60-day view)

The cost plan's Step 0 asked us to name "the exact module responsible for ungrounded speculative
refill." Answered empirically — a flag that is off produces zero ledger rows:

| scope | calls | active days | first → last |
|---|---:|---:|---|
| `batch-verify` | 3345 | 59 | 2026-06-30 → 2026-08-27 |
| `vet-question` | 1300 | 59 | 2026-06-29 → 2026-08-27 |
| `generate-questions` | 468 | 57 | 2026-06-29 → 2026-08-27 |
| `self-containment` | 4697 | **1** | 2026-07-12 (21:05 → 23:09) |
| `backfill-supply-generate` | 74 | 15 | 2026-07-10 → **2026-08-14** |
| `domain-reference` | 40 | 19 | 2026-07-10 → 2026-08-26 |
| `pool-refill-generate` | 33 | 3 | 2026-06-29 → **2026-07-01** |

Three findings here:

1. **`SUPPLY_BACKFILL_ENABLED` is ON in prod.** The nightly demand-weighted backfill has been
   running since 2026-07-10 (74 calls, 15 active days, last fired 2026-08-14). The
   `supply-refill-status` note that says backfill is "OFF" is stale. It is, however, only 3.5% of
   window spend — it is the one truly speculative path alive, and it is small.
2. **The grounded pool-refill is dead.** `pool-refill-generate` last fired 2026-07-01.
   `RETRIEVAL_GROUNDING_ENABLED` is effectively not on. Any Step-2 change aimed at
   `runPoolRefill` would target a path that costs nothing today.
3. **`self-containment` is the textbook case for the audit/steady-state split.** 4,697 calls in a
   single two-hour window on 2026-07-12 — the name-the-source healing sweep. Blended into a
   monthly average it would dominate and mean nothing.

### Supply funnel

124 GeneratedQuestion rows created in the window: 1 suppressed as duplicate, 98 verdict `ok`,
0 demoted, 1 unverifiable, 1 not yet swept. **Reject rate 1.6%.**

At an all-in $10.49 over 121 trusted questions that is **$0.087 per trusted question** — roughly
2–3× the $0.03–0.04 figure the plan deferred. The reject rate is now low enough that cost per
trusted question is a usable metric, which the plan assumed it was not yet.

### Inventory and just-in-time generation

- **976 unused, non-duplicate bank rows across 101 domains.** 56 of those 101 domains sit below
  the stocked floor of 10 (`SUPPLY_STOCKED_FLOOR`).
- **94% of served generated slots were generated live.** Of 83 generated slots served in the
  window, 78 had their `GeneratedQuestion` row created within five minutes of the queue that
  served them. All 14 queues needed at least one live generation.

Those two facts sit badly together: there is inventory and the serving path is barely drawing on
it. `pickBankSource` (`daily.ts:1976`) does reuse other users' rows, so cross-user reuse is not
structurally blocked — the cause is not yet identified and is the thing a Step 2 would need to
diagnose before changing anything about refill.

### Denominators — the finding that reframes the plan

| | |
|---|---:|
| Onboarded accounts | 23 |
| Accounts that received a queue in the window | **1** |
| Queues built | 14 |
| Core slots answered | 70 / 70 |
| Completed Daily Fives | 14 |
| All-in cost per completed Daily Five | $0.75 |

Weekly history confirms it is a trend, not a fluke: distinct users with a queue ran 4 → 8 → 7 → 4
→ 2 → 4 → 1 → 1 → 3 across the last nine weeks, while total calls fell 6,282/wk (early July) to
~420/wk now.

**The plan's central premise needs restating.** It says spending "risks scaling with the number of
topics rather than the number of players receiving value," and offers the principle that spend
should be a function of players served. The measurement supports the principle and refutes the
mechanism. Spend is not scaling with the taxonomy — 93.7% of it is *demand-shaped* work
(just-in-time generation for a played queue, and the verification tail behind it). It is scaling
with a supply pipeline calibrated for a playerbase that isn't showing up. One player received
every Daily Five in this window, and the pipeline spent $9.83 of recurring cost around them.

That also refutes a hypothesis raised in the earlier review of the plan: the daily-assignments
cron pre-builds for all onboarded accounts in code, but it is producing ~1 queue/day in practice,
not 23. Spend is not scaling with accounts-ever-created either.

### Ledger caveats — the ledger is not a floor

The plan describes the application ledger as "a known floor." It errs in both directions:

- **Under-counts:** `recordLlmUsage` fires only on a successful response (`src/lib/llm.ts:335`).
  Provider-billed timeouts and failures are invisible. This has bitten before — the 2026-07-01
  $7.56 spike was largely unlogged timeouts.
- **Over-counts:** `claude-sonnet-5` is priced at sticker $3/$15 in `pricing.ts:41` while Anthropic
  bills an introductory $2/$10 through **2026-08-31**. Generation-side figures in this window read
  roughly a third high. This corrects itself on 2026-09-01, when sticker becomes true.
- Web-search spend **is** ledgered ($10/1k, `pricing.ts:107`) and batch runs already apply the 50%
  token discount — neither is part of the variance.
- Cost is derived at read time, so editing `pricing.ts` reprices all history.

**Not measurable from this database:** reconciliation against Anthropic's own billing. That needs
Console or Admin API access — see Step 1.

---

## Step 1 — Operational backstop (runbook)

Decisions taken 2026-08-27: **$100/mo organization ceiling, $50/mo on the Joshing workspace**,
executed by hand in Console.

### The reporting-split problem

Joshing and Questionable currently share one Anthropic organization **and one Default workspace**.
That is exactly why their spend can't be separated: the Cost API reports the Default workspace as
`workspace_id: null`, so there is no dimension to group on. Splitting requires one workspace per
app — which also gives each its own spend limit, so Questionable can never starve Joshing's live
grading.

### Ordered checklist

Do these in order. Steps 3–4 are the only ones that can break a running app; the sequence below
keeps both apps on a valid key at all times.

1. **Create two workspaces.** Console → Settings → Workspaces → Create.
   Name them `joshing-prod` and `questionable-prod`. Record both `wrkspc_…` IDs.
2. **Mint one API key per workspace.** Console → Settings → API keys → Create, selecting the
   workspace as the key's scope. Do *not* delete the existing Default-workspace key yet.
3. **Swap Joshing's key.** Set `ANTHROPIC_API_KEY` to the `joshing-prod` key in the Vercel
   **production** environment, then redeploy. Verify with a real request — hit the app
   cache-busted (`/login?cb=$(date +%s)`) and confirm a new `LlmUsageEvent` row lands.
4. **Swap Questionable's key** the same way.
5. **Revoke the old Default-workspace key** only after both apps are confirmed working. Until it
   is revoked, anything still using it lands in the unsplittable `null` bucket.
6. **Set spend limits.** Console → Settings → Limits.
   - Organization: **$100/month**.
   - `joshing-prod` workspace: **$50/month**.
   - Leave `questionable-prod` unset (inherits the org limit) unless you want it capped tighter.
7. **Set email notifications** at 50% and 80% of each limit. These are the actual early warning;
   the hard limit is the backstop of last resort.
8. **Create an Admin API key** (Console → Settings → Admin keys, `sk-ant-admin01-…`) if you want
   the reconciliation in step 9 scripted rather than read off the Cost page.

### Reconciliation query (closes the last Step 0 gap)

Once the workspaces exist and an admin key is available, this is the per-app provider-side truth
to diff against the application ledger:

```bash
curl "https://api.anthropic.com/v1/organizations/cost_report?\
starting_at=2026-09-01T00:00:00Z&\
ending_at=2026-09-15T00:00:00Z&\
group_by[]=workspace_id&\
group_by[]=description" \
  -H "anthropic-version: 2023-06-01" \
  -H "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

Notes that matter for reading the result: costs come back as **decimal strings in cents**; the Cost
API is **daily granularity only**; Priority Tier spend is excluded from it (use
`/v1/organizations/usage_report/messages` for that); and `1d` buckets are capped at **31 per
request**, so a monthly pull is one page but a quarterly one needs pagination.

The difference between that figure and `scripts/llm-cost-baseline.ts` for the same span is the
plan's "unledgered variance." Expect it to be non-zero in both directions until 2026-09-01, when
the Sonnet 5 introductory price ends and the ledger's sticker pricing becomes correct.

### What Step 1 deliberately does not do

The ceiling is a safety net, not the cost-control mechanism. It cannot distinguish background
supply from live grading — if it trips, gameplay stops too. That is the argument for the
application-level background budget the plan defers to Step 2, and the reason the org ceiling is
set at ~5× measured spend rather than close to it.

---

## What Step 2 should reconsider

Not authorized here; recorded so the measurement isn't re-derived later.

1. **The refill target is small and partly already dead.** Speculative background refill is 3.5%
   of spend, and the grounded path hasn't run since July. A Step 2 scoped to "make refill obey the
   finite-set target" would address ~$0.36 per two weeks.
2. **The real question is the 94% JIT rate against 976 unused bank rows.** If serving drew on
   existing stock, generation and its verification tail — 78% of window spend between them —
   would both fall. That is a serving-path question, not a refill-policy question.
3. **`batch-verify` is the single largest line at 46%**, and it runs daily on everything generated.
   Its cost is a function of generation volume, so it moves with (2) rather than needing its own
   intervention.
4. **Cost per trusted question is now available** ($0.087, 1.6% reject rate) — the plan deferred
   this metric on the assumption reject-rate data didn't exist. It does.
5. **Demand, not supply, is the denominator problem.** At one active player, no supply-side
   optimization changes the shape of the cost curve much. This is a product observation, not a
   cost one, but it is what the numbers say.
