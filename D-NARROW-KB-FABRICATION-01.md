# D-NARROW-KB-FABRICATION-01 — Niche-fiction fabrication on narrow KBs is a grounding problem, not a gate problem

**Date:** 2026-06-26
**Status:** Settled (two levers built, both flag-off) + one open operational finding (cron).
**Relates to:** `D-LLM-PROVIDER-AB-AND-GATE-TIER-01` (corroborated and extended), `docs/retrieval-flip-checklist.md`, PRD-D-5 §5.3 (B3 retrieval grounding).

## Trigger

A player ("Butkicker") was served two Daily Five questions in the declared-interest
domain **"Spy School Books 1-6"** that were factually fabricated and graded *wrong*
against invented answer keys:

- *"…the school's campus is hidden inside a Washington D.C. university… Which real
  university serves as this front?"* → **"Georgetown University"** — false premise; the
  series disguises the academy as a science magnet school, not a university.
- *"In Spy School: Evil Spy School… what cover name does SPYDER use for their school?"*
  → **"Academy of Evil"** — fabricated; SPYDER is a crime org, not a school, and the
  explainer also miscounts the book as "the fifth" (it is the third).

Both were `source=daily_generated`, `answer_source=llm_suggested`, `source_refs=[]`
(ungrounded), generated on-the-fly mid-session at a durable pool depth of only ~7 facts.

## Finding — the factual gate **cannot** catch this, by prompt or by tier

An A/B over the exact 7 spy-school questions (2 bad + 5 good), 5 runs each, at the prod
gate model (Sonnet) and Opus, with the current prompt and a sharpened "catch fabricated
fiction-canon" prompt:

| Question | Sonnet (prod) | Sonnet + sharper prompt | Opus | Opus + sharper |
|---|---|---|---|---|
| "Academy of Evil" (fabricated) | 0/5 | 0/5 | **0/5** | **0/5** |
| "Georgetown" (fabricated) | 0–1/5 | 0/5 | 4/5 | 4/5 |
| 4 genuinely-good | 0/5 | 0/5 | 0/5 | 0/5 (no false positives) |

A better **prompt** does nothing (it even regressed Georgetown; when Sonnet *did* flag it,
it "corrected" to *American University* — itself a hallucination). Even **Opus** misses
"Academy of Evil" entirely. **The gate shares the generator's blind spot on niche fiction;
a fabricated novel question is indistinguishable from a real one.** This corroborates
`D-LLM-PROVIDER-AB-AND-GATE-TIER-01` (it is not a provider/prompt problem) and **extends**
it: for fabricated niche-fiction canon it is not even a *tier* problem — it is a
**grounding** problem. No ungrounded LLM gate is the fix.

## Decision — fix at generation, with two composed levers (both flag-off)

### Lever A — Narrow-KB exhaustion guard `[built, flag-off]`

`NARROW_KB_GUARD_ENABLED` (default off). In the per-user path
(`generateDailyQuestionsFromKnowledgeBase`), suppress **fresh ungrounded generation** for
**declared-interest** domains whose durable pool is still **thin** — depth `<`
`RETRIEVAL_POOL_DEPTH_THRESHOLD` (the **same** boundary grounding uses, so "stop
fabricating" and "start grounding" fire on one line). Bank/authored/grounded rows still
serve those domains; the freed slot **backfills from the user's other (non-thin) domains**
via the orchestrator's existing top-up. Broad domains (depth ≫ threshold) are untouched.
Fail-open. Files: `src/server/daily/kb-exhaustion.ts`,
`getDurablePoolDepthForDomains` (retrieval-demand.ts), hook in `generate-questions.ts`.
There is **no per-question signal** that separates fabrication from fact (that is the whole
reason the gate fails), so the guard keys on provenance + pool depth, not on judging
individual questions.

### Lever B — Retrieval-grounded refill for narrow KBs `[built, flag-off]`

The B3 grounded path already exists and is **dormant**: `cron/pool-refill` →
`getThinActiveDomains()` → `refillDomain()` (Sonnet + `web_search`, ≥2-source
corroboration, reputation allow/deny, ask-to-answer verify) → persists `machine_verified`
rows with `source_refs`. It no-ops only because `RETRIEVAL_GROUNDING_ENABLED` /
`RETRIEVAL_SYSTEM_USER_ID` are unset. **"Spy School Books 1-6" already qualifies as demand**
(pool depth 7 < 8 threshold, active). The guard is meant to be flipped **in the same
change** as grounding (shared threshold) — see the updated `docs/retrieval-flip-checklist.md`.
Enabling is **billable** (Anthropic web search + retrieved-source tokens + a new vendor,
`VOYAGE_API_KEY`); hard-capped at `RETRIEVAL_DAILY_USD_CEILING` ($2/run). Current demand is
~62 thin+active domains → a **one-time drain ≈ $30–60** over ~2–4 weeks, then pennies/day
steady-state. Decision: **operator flips prod** (dry-run: `GET /api/cron/pool-refill?dryRun=1`).

## Remediation (done)

Both questions soft-deleted (`deleted_at`); Butkicker's two `MASTERY_EVENTS` deleted. Both
were `incorrect`/0-points, so they never touched `PLAYER_MASTERY` (the aggregate only writes
when `pointsAwarded > 0`) — a clean reversal, no recompute.

## Related operational finding — daily-build cron under-coverage `[OPEN — not yet decided]`

While verifying generation, the `/api/cron/daily-assignments` run (17:05 UTC, 2026-06-26)
**did not complete**. Vercel runtime logs show a cold-boot DB connection failure
(`EAUTHTIMEOUT`, SQLSTATE `08006`) that hung `migrate()` for **~20 minutes**
(`[instrumentation boot] { migrate_ms: 1199143 }`, guards skipped per `SKIP_BOOT_DB_GUARDS=1`),
consuming the function before user work began. It then built queues at ~50–78s/user (bank
fall-throughs forcing live Sonnet, zero prompt-cache hits, zero top-up recovery, short
queues) and was killed at the 300s `maxDuration` after covering **~6 of 17 onboarded users**
(no result JSON emitted; one user `generation_failed` at 1/3 floor). Uncovered users fall
onto the slow synchronous on-demand build = the observed **"long loading."** Contributing
root causes, in priority order: (1) **unbounded `migrate()` at cold boot** (no timeout); (2)
**per-user generation cost** (bank misses → live Sonnet, no cache) — which Lever B directly
improves by raising bank hit rate; (3) **no cron retry** (the native Vercel cron fires once;
the retired GitHub-Actions curl-with-retry used to replay on timeout). Fixes TBD — see the
follow-up.

(Note: crons were moved GitHub-Actions → native Vercel in `a72430b9`; `daily-assignments`
*is* scheduled in `vercel.json` at 17:05 UTC. The route's in-file comment claiming GitHub
Actions schedules it is **stale** and corrected in this change.)
