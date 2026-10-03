# Cassian C0 baseline — 2026-10-03

The first Cassian coding pass began in an isolated checkout from `origin/main` at `df1759e3`, with the Cassian documentation cherry-picked. The original working tree has unrelated edits and was left intact. This file records read-only production aggregates; it does not assert which commit is currently deployed.

## Runtime evidence

The query grouped `LlmUsageEvent` by `scope, provider, model` for the preceding 14 days. The most recent `generate-questions` event was **2026-10-03 17:06 UTC** on `claude-sonnet-5-5` (113 calls in the window). Earlier Sonnet 5 had 137 calls. The quality gate used `claude-haiku-4-5-20251001`; recent factual gate calls used Sonnet 5.5. This establishes the actual recent writer more reliably than the local `ANTHROPIC_MODEL` fallback, which is Sonnet 4.6 when unset. Global provider settings were not changed.

Observed recent averages for the corresponding current-model events:

| Scope/model | Calls | Input | Output | Cache read | Cache create | Web searches | Mean duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Source / Sonnet 5.5 | 5 | 46,521 | 898 | 0 | 0 | 3 | 9,580 ms |
| Writer / Sonnet 5.5 | 113 | 6,106 | 748 | 8,994 | 4,726 | 0 | 6,324 ms |
| Quality / Haiku 4.5 | 148 | 4,911 | 174 | 0 | 0 | 0 | 2,531 ms |
| Factual / Sonnet 5.5 | 67 | 2,150 | 281 | 0 | 0 | 0 | 3,097 ms |

Query source: read-only transaction against `LlmUsageEvent`, `created_at >= now() - interval '14 days'`, restricted to relevant scopes, with `count` and average token/duration fields. Provider invoices were not independently reconciled. Five source calls are too few to treat the mean as a safe upper bound.

At **2026-10-03 17:55 UTC**, a rolling 30-day read-only ledger query grouped `LlmUsageEvent` rows by scope/model and applied the repository price catalog, including cache and web-search meters. An independent earlier report used `buildCostLatencyReport(30)` in `src/server/db/queries/llm-cost-report.ts` and compared adjacent rolling 30-day windows. The detailed amounts remain in the ignored private run archive because this repository is public. Roughly half of priced spend was fresh question writing. Even after excluding one-time bank rewrite and sweep-related gate work, non-writer spend alone exceeded the owner's $5 monthly target. These are internal list-price estimates, not provider invoices; replacing only the writer cannot meet the target at this workload.

The executed 12-topic manifest was selected from active `DeclaredInterest` domain aggregates, with four each classified broad, niche and very narrow. The committed [manifest.json](manifest.json) contains placeholders; the exact frozen manifest is in ignored `_scratch/Cassian/cassian-pilot-2026-10-03/private/manifest.json` and is identified by SHA-256 in the run report. No player IDs or individual selections are in the public manifest. Only three exact source-cache rows existed, all older than the 24-hour cache period, so fresh retrieval was expected for most topics.

## First cost estimate

Run `npx tsx scripts/cassian-estimate.ts` from the repository root. It reads the frozen manifest and the 14-day token averages, prices them with `src/server/llm/pricing.ts`, and makes **no network or model calls**. The model catalog currently lists Sonnet 5.5 at $3/$15 per million input/output tokens and Haiku 4.5 at $1/$5, with cache and web-search multipliers. Confirm those prices against the provider before spending; the internal catalog alone is not billing proof.

The 12-topic, 24-generation observed-shape estimate includes one fresh source call per topic and quality/factual gates for every requested candidate. It excludes retries, grading, history embeddings, additional gate branches and uncertain timeout charges. If the 20% margin exceeds the recommended first-run $4 allowance, start with balanced paired topic blocks, settle their actual costs, then decide whether to extend. The authorized lifetime cap remains $10 across sessions.

The source step dominates projected cost and latency. A comparison that reuses one source packet for both models measures the writer difference; a separate cold topic-to-ready timing trial is required for the owner's speed goal. The first paid pilot and three Cassian-only tables are now documented in [TRACKER.md](TRACKER.md).

`domain-reference.ts` uses a 24-hour `REFERENCE_TTL_MS`. A 7–14 day TTL is a candidate for a later, separate test; first measure per-topic re-fetch frequency, passage reuse, fact variety and exhaustion. Do not change the TTL during the writer comparison or attribute its effects to a model swap.
