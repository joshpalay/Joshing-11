# Retrieval-grounded pool refill — flip checklist (C6)

The retrieval/embeddings stack (PRD-D-5 B3) is **built and off by default**. BP-7 made the
off→on transition clean and added the telemetry to read before flipping. This is the
operational checklist for turning it on — an explicit post-merge decision, never flipped
from a build prompt.

## Read these numbers first

1. **Per-domain pool depth (distinct facts):** `GET /api/dev/pool-report` → `depthByDomain`
   (thinnest first). Depth counts **distinct `fact_key`s**, not rows — serving copies don't
   inflate it (re-audit W3).
2. **Bank hit rate / fall-through:** the `[daily/bank-telemetry]` structured logs — per
   domain: `hit` vs `fall_through`, tier requested/served, whether tier-adjacent fallback
   was used. Every `fall_through` is a fresh Sonnet pipeline retrieval refill could have
   pre-empted.
3. **Dud exclusions:** `[daily/bank] excluded dud stock` logs — domains whose stock is
   being filtered by the D11 "nobody got it" exclusion are domains where refill adds the
   most quality.

If thin+active domains and frequent fall-throughs show up in those numbers, flipping pays.

## The flip

- [ ] Provision `VOYAGE_API_KEY` (Voyage `voyage-3.5-lite` embeddings — also activates the
      semantic-dedup backstop, PRD-D-5 §11.2; until then deterministic guards remain the
      dedup layer).
- [ ] Create/choose the dedicated pool-owner account and set `RETRIEVAL_SYSTEM_USER_ID`
      (rows it owns become bank stock for everyone else — `pickBankSource` serves
      `userId <> viewer`).
- [ ] Set `RETRIEVAL_GROUNDING_ENABLED=true`.
- [ ] **Add `pool-refill` to `.github/workflows/external-crons.yml`** (audit C1b): it is
      currently scheduled only by Vercel Hobby's best-effort cron (09:00 UTC) — the
      unreliability the workflow exists to avoid. The route is idempotent and capped, so
      dual scheduling is safe.
- [ ] Sanity-check spend knobs (all pre-set with safe defaults, `retrieval-config.ts`):
      `RETRIEVAL_DAILY_USD_CEILING` ($2 hard stop), `RETRIEVAL_MAX_SEARCHES_PER_QUESTION`
      (3), `RETRIEVAL_QUESTIONS_PER_DOMAIN` (3), `RETRIEVAL_POOL_DEPTH_THRESHOLD` (8),
      `RETRIEVAL_MAX_DOMAINS_PER_RUN` (50).
- [ ] Dry-run first: `runPoolRefill({ dryRun: true })` previews demand and names any
      remaining blocker without spending.

## After the flip

- Watch `depthByDomain` rise on thin+active domains and `fall_through` rates drop in the
  bank telemetry; `questionsPersisted` / `usdSpent` per run come back in the cron response.
- Guard rails already in place: per-run USD ceiling, corroboration floor (≥2 independent
  hosts, ≥1 reputable), `machine_verified` entry tier, durable rows (no expiry).
- While off, behavior is exactly as before — pinned by
  `src/server/daily/__tests__/retrieval-flag-off.test.ts` (a real run is a hard no-op with
  zero LLM calls even when an Anthropic client is available).
