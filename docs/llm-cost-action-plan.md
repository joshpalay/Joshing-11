# LLM cost — action plan

One-day-startable plan to bend the LLM cost curve, sequenced so each change is
verified before the next. Generation is ~68% of spend and today runs ~73%
fall-through to fresh Sonnet (measured 2026-06-28); the goal is to (a) cap
downside, (b) cheapen the small stuff, then (c) raise the bank hit-rate so
generation amortizes across users instead of scaling linearly with MAU.

Companion docs: `docs/bank-hit-rate-query.md` (the metric), `docs/retrieval-flip-checklist.md` (pool-refill operator steps).

---

## Status going in

| Item | State |
|---|---|
| Commentary copy → Haiku (`COMMENTARY_MODEL`) | ✅ coded, **uncommitted on wrong branch** |
| Bank hit-rate dashboard + monitor + notifier | ✅ live in Axiom |
| Baseline hit-rate | ✅ 26.8% (specialist 18.7% / moderate 31.5% / accessible 42.1%) |
| Monthly spend cap | ⬜ not enabled |
| Carry-forward | ⬜ flag off |
| Pool-refill | ⬜ flag off |

---

## Day 1 (tomorrow)

### Step 0 — Insurance: turn on the spend caps (5 min, zero risk)
Do this first so nothing below can surprise you.
- Vercel → project env (Production): set `LLM_MONTHLY_USD_CEILING` to a ceiling
  you're comfortable with (e.g. a few× current monthly spend). When month-to-date
  exceeds it, grounded generation no-ops instead of billing.
- Anthropic Console → Org → set a hard monthly spend limit as a backstop the code
  can't override.
- **Rollback:** unset the env var. **Verify:** boot log / next cron shows no cap breach.

### Step 1 — Ship commentary → Haiku (the only code change)
The edits (`src/lib/llm.ts`, `.env.example`) are currently uncommitted on
`claude/fix-catchup-duplicate-explainer`. Move them to their own branch:
```bash
git stash -u                       # includes the new docs/ files
git checkout main && git pull
git checkout -b claude/llm-commentary-haiku
git stash pop
git add src/lib/llm.ts .env.example docs/bank-hit-rate-query.md docs/llm-cost-action-plan.md
git commit   # subject: "perf(llm): default commentary copy to Haiku (COMMENTARY_MODEL)"
```
- Open PR, let CI run (`npm run lint`, typecheck, ratchets).
- **Verify in preview:** generate a daily queue or trigger an answer reveal; eyeball
  a few inside-joke asides and a reflection explainer for JSON validity + tone.
  Both fail open to a fallback, so a miss degrades gracefully.
- Merge → production. **Rollback:** set `COMMENTARY_MODEL=claude-sonnet-4-6` in
  Vercel (no redeploy), or revert the PR.
- **Confirm savings:** after a day, the "Writing player-facing copy" bucket on the
  cost readout should drop ~3× on its Sonnet share.

### Step 2 — Flip carry-forward (lowest-risk hit-rate lever)
- Vercel (Production): `DAILY_TOPUP_CARRYFORWARD_ENABLED=true`.
- This stops regenerating a full Five for returning users who left unplayed
  questions; it generates only the shortfall. Fail-open, default-off kill-switch.
- **Verify:** after the next `daily-assignments` cron (17:05 UTC), check logs for
  the top-up/carry-forward path and confirm queues still fill to 5.
- **Rollback:** set back to unset/false.

> Stop here for Day 1. Steps 3–4 need an observation window — don't stack them.

---

## Day 2–3 — Verify carry-forward, then flip pool-refill

### Step 3 — Read the dashboard
- Open the **Bank hit-rate** Axiom dashboard. Re-run §1/§4 of
  `docs/bank-hit-rate-query.md`.
- Expectation: overall hit-rate ticks up (fewer regens for partial/returning users).
  The specialist tier won't move yet — that's Step 4's job.

### Step 4 — Flip pool-refill (the structural lever for the 18.7% specialist tier)
Follow `docs/retrieval-flip-checklist.md`. In short:
- Set `RETRIEVAL_SYSTEM_USER_ID` (the owning user for system-generated stock) and
  `RETRIEVAL_GROUNDING_ENABLED=true`.
- Confirm spend caps are sane: `RETRIEVAL_DAILY_USD_CEILING` (default $2/run),
  `RETRIEVAL_MAX_DOMAINS_PER_RUN` (50), `RETRIEVAL_QUESTIONS_PER_DOMAIN` (3).
- Optional pairing: `NARROW_KB_GUARD_ENABLED=true` to stop per-user fabrication on
  thin domains while the pool deepens.
- The `pool-refill` cron (09:00 UTC) pre-generates ≥2-source-corroborated rows into
  the shared bank, off the user-blocking path.
- **Verify:** next pool-refill run logs generated rows + spend under the cap;
  `GET /api/dev/pool-report` shows rising `depthByDomain` on the thin domains.
- **Rollback:** `RETRIEVAL_GROUNDING_ENABLED=false` (hard no-op).

---

## Day 4+ — Re-baseline and tighten the alarm

### Step 5 — Bump the monitor threshold
- After 2–3 pool-refill cycles, re-run the hit-rate query. The specialist tier and
  overall rate should climb (thin-domain fall-throughs convert to one-time shared
  generation).
- Raise the **Bank hit-rate regression** monitor threshold from `20` up toward the
  new baseline (e.g. if you settle at ~50%, set ~40) so it still guards the gains.
  Leaving it at 20 would let a large regression slip under the alarm.

---

## What success looks like
- "Writing player-facing copy" Sonnet share down ~3× (Step 1).
- Overall bank hit-rate up from 26.8% (Steps 2 + 4).
- Specialist-tier hit-rate up from 18.7% (Step 4 specifically).
- Worst-fall-through-domain list (Bach, Mozart, Beethoven, Woolf, …) shrinks.
- Generation cost growth decouples from MAU — sublinear, not linear.

## One rule
Flip **one lever at a time** with an observation window between. If the hit-rate
or quality moves the wrong way, you'll know exactly which flag did it.
