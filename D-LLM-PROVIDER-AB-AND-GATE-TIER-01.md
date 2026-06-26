# D-LLM-PROVIDER-AB-AND-GATE-TIER-01 — Provider A/B switch, and why question-quality misses are a model-tier problem (not a provider problem)

**Type:** Decision + findings. Records the outcome of the Anthropic↔OpenAI provider experiment and a question-quality audit, so neither is re-litigated.

**Date:** 2026-06-25; addendum 2026-06-26 (second audit + pool cleanup).

**Status:** Settled. Build state is mixed — tags per item below.

**PRs:** #1206 (A/B switch B1–B3), #1208 (OpenAI env docs), #1210 (metrics readout), #1219 (OpenAI flagship default → gpt-4.1 + price map), #1221 (factual gate → Sonnet via `FACTUAL_GATE_MODEL`).

---

## Why this exists

The motivating question (Josh): *"Would ChatGPT be better than Anthropic at some of the question/answer checking?"* — prompted by a generated Tears of the Kingdom question whose stated answer (Demon Dragon) was right but whose **setup embedded a false premise** ("Ganondorf's transformation draws on the ancient dragon whose secret underpins the tragedy" — it doesn't; he swallows his own Secret Stone). ChatGPT (GPT-5.5) flagged it; Anthropic's pipeline had served it.

To test that suspicion rigorously rather than by anecdote, we built a provider A/B switch, then ran an audit. This doc records what was built, what the data actually showed, and the resulting calls.

## What was built (the A/B switch) — [built]

- **Four switchable LLM surfaces** — generation, categorization, answer-suggestion, grading — each routable to `anthropic` (default) or `openai` via a single global settings row (`AppSettings`), owner-gated dropdowns on `/users/[id]`, behind `ADMIN_USER_IDS`. Prompt text is identical across providers; OpenAI uses `json_object` so the existing validators are reused. (#1206, B1–B3.)
- **Provenance stamping** — `GeneratedQuestion.generated_by_provider`, `Question.categorize_provider`, `MASTERY_EVENTS.llm_provider`. (#1206, B3.)
- **Metrics readout** (owner-only, `/users/[id]`): wrong-answer rate per grading provider, generation counts per provider, **cost** (new `LlmUsageEvent` table, derived from a per-model price map), and a **flip log** (`LlmProviderChangeLog`). (#1210.)
- Default is Anthropic everywhere; the whole thing is test instrumentation, removable as a unit.

## Cost finding — [decided; PR #1219 open]

The cost readout showed **gpt-4o ≈ 5× the Anthropic arm** on generation (input-token-dominated, ~12.5k tokens/call). Per-token, **Sonnet is actually the most expensive option** ($3/$15) — pricier than gpt-4o ($2.50/$10). Decision: default the OpenAI **flagship** to **gpt-4.1** ($2/$8) — flagship-tier (a fair quality comparison against Sonnet) yet cheaper than both gpt-4o and Sonnet; grading stays on `gpt-4o-mini`. `gpt-4.1-mini` ($0.40/$1.60, ~84% cheaper) is an env override for a pure-cost run. Prices verified June 2026 (OpenAI's page blocks automated fetch — confirm on the billing dashboard).

## The key finding: it's a model-TIER problem, not a provider problem

An audit (`scripts/audit-gate-compare.mjs`, n=80 recent pool questions) isolated **prompt vs model tier** on the factual gate (`findFactualFailures`), the step that already exists to catch wrong answers / false premises:

| Lever | Extra **major** false-premise catches over Haiku (current gate tier) |
|---|---|
| Sharper gate **prompt** @ Haiku (same tier) | **+0 / +1** (negligible across two runs) |
| **Sonnet** (same prompt, higher tier) | **+4** |
| **Opus** (same prompt, frontier) | **+4** (marginally higher recall on the subtlest; ~equal on majors) |

Conclusions:
1. **The original GPT-5.5 catch was a tier signal, not a provider signal.** GPT-5.5 differs from the Haiku-tier gate in *both* provider and tier; the within-Anthropic audit shows tier alone (Haiku→Sonnet) closes the gap. "Is OpenAI better?" was the wrong axis.
2. **Prompt-tweaking the gate at Haiku does not help** (+0/+1). It is a model-capability effect.
3. **Sonnet recovers essentially the full major-defect lift Opus does, at a fraction of Opus's cost.**
4. **The provider A/B switch cannot answer the original question** — none of its four surfaces *is* the question-checking gate. Generation makes the question; grading checks the player's answer vs the canonical answer, not the question's internal validity. The gate (`findFactualFailures`/`findQualityFailures`) is separate and was Haiku-hardwired, off the switch.

Examples the live Haiku gate passed but Sonnet/Opus flagged: the Ganondorf framing; "Zelda was transformed by the dying Rauru" (she swallows her own Secret Stone); "Pentagon Papers" called a "covert government program" (it was a classified study); a tennis tiebreak serve-order premise.

## Second audit — precision & pool cleanup (2026-06-26) — [done]

A complementary run to the gate-compare audit above, asking a *different* question: **precision** (does the cheap gate over-flag good questions?) and whether a cheap **Haiku ensemble** could substitute for Sonnet. Harness `scripts/audit-gate-variance.ts` (#1258; read-only, dry-run-by-default), n=40 most-recent pool rows, **Haiku ×5** (temperature 1 + a per-run nonce, to decorrelate the samples) vs **Sonnet ×1**, using a deliberately aggressive recall-oriented prompt. OpenAI column skipped — `OPENAI_API_KEY` still not in `.env.local`.

| Config | Flag rate |
|---|---|
| Haiku ×1 | 35% (14/40) |
| Haiku ×5 union | 37.5% (15/40) |
| Sonnet ×1 | 10% (4/40) |
| **Sonnet-only (caught, Haiku ×5 missed)** | **0** |

1. **No bias in this run** — Sonnet caught nothing the Haiku ensemble missed.
2. **Under a loose prompt, Haiku over-flags** (37.5% vs 10%) — including a confident **5/5 false positive on a flawless question** ("Beethoven wrote only one opera — what is its name? → Fidelio"). So Haiku is *miscalibrated*, and it cuts both ways: with the **tuned production gate prompt** it **under**-catches real defects (the first audit's +4 for Sonnet); with a **loose prompt** it **over**-flags. Sonnet stays calibrated either way. **The two audits are consistent, not contradictory.**
3. **The harness's auto "VARIANCE — ensemble Haiku" verdict is misleading** and was NOT acted on: Haiku covers 100% of Sonnet's flags only because it flags ~4× as much. Ensembling cannot fix precision — some false positives are 5/5 (systematic bias, not variance).
4. **At single-question gate size, Sonnet ($0.0016/call) ≈ Haiku ($0.0011/call)** with equal latency. The expensive Sonnet line in the cost readout is the *batched* factual gate, not per-call tier — so a Haiku→Sonnet **cascade saves ~nothing** here. **Cascade revisited and dropped**; it only pays off when the adjudicator is a much-pricier *frontier* model. Reinforces keeping the gate on Sonnet.

**Pool cleanup (done — production writes, reversible via `is_duplicate=false`, the repo's flag-never-delete pattern):** 4 confirmed false-premise questions + 1 duplicate suppressed:
- tennis "volley before the ball crosses the net" premise — `3ae575a3-ff02-48dd-bed2-8c86c4566ba5`
- "Lewis Hine **founded** the National Child Labor Committee" (false — founded by Edgar Gardner Murphy) — `651b6f44-f03d-47a6-87d4-24177851b854`
- Mozart "Jupiter" — Symphony No. 38 explainer error — `23c571e7-e0bf-4274-ab50-25ab20d8623a`
- Beethoven sonata "**unusual** four-movement structure" (four movements is not unusual) — `4c257d42-6675-4037-9f50-1ff987bb5633`
- **Duplicate:** Theodore Roosevelt "trust-buster" generated twice in one batch (~4s apart — a dedup escape); kept `3bcb96fa-ba74-4ff7-a773-e4c2d572b46d`, suppressed `afb817c3-ddeb-4afb-a2b0-5dfabd82f91b`.

## Decisions

- **The provider A/B switch is test instrumentation; default stays Anthropic.** [built] It is *not* the lever for question quality. Keep for measuring generation/grading provider quality at equal tier later, but don't treat a provider flip as a quality fix.
- **The factual gate defaults to Sonnet**, env-overridable via **`FACTUAL_GATE_MODEL`** (`claude-haiku-4-5-*` to revert, an Opus id for max recall). Temperature omitted for sampling-param-free models (Opus 4.7/4.8, Fable); timeout raised for non-Haiku so a slower gate can't time out and fail open. [decided; PR #1221 open] Rationale: the gate runs once per generation **batch**, so a stronger model on this single high-leverage check is a small cost delta — the cheapest place in the pipeline to spend a stronger model.
- **Do not rewrite the gate prompt to fix this** — measured non-lever.
- **OpenAI flagship default = gpt-4.1** (see Cost finding). [decided; PR #1219 open]

## Open / not done

- **Quality gate (`findQualityFailures`) is still Haiku.** Possible follow-up to give it the same `FACTUAL_GATE_MODEL`-style treatment.
- **Provider quality A/B at equal tier is still unmeasured.** The switch covers generation/grading, not the gate; the gate is not on the provider switch.
- **OpenAI gate-tier untested locally** — `OPENAI_API_KEY` is in Vercel only, not `.env.local`, so the audit ran Anthropic tiers (Haiku/Sonnet/Opus) only.
- **Audit caveats:** n=80, single-run, LLM-as-judge with real false positives; estimated genuine major-defect rate ~low-single-digit % to ~6% of the pool. The audited rows were legacy (`generated_by_provider = null`), i.e. the accumulated pool, not freshly-gated output. A human spot-check would prune judge false positives before banking a rate.
- **Grading dropdown remains the dangerous toggle** (product canon: "fail toward the player"). Flipping grading to a stricter grader can manufacture false wrong-answers and contaminate the wrong-answer reaction-rate north-star; the panel carries an inline caution and the documented recommendation is to never flip grading and generation in the same comparison window.

## References

- Code: `src/server/llm/provider.ts`, `src/server/llm/settings.ts`, `src/server/llm/pricing.ts`, `src/server/db/queries/llm-provider-experiment.ts`, `src/components/profile/settings/LlmProviderPanel.tsx` + `LlmExperimentReadout.tsx`, `src/server/daily/generate-questions.ts` (`findFactualFailures`, `FACTUAL_GATE_MODEL`), `src/app/api/admin/llm-providers/route.ts`.
- Audit harnesses: `scripts/audit-false-premise.mjs`, `scripts/audit-gate-compare.mjs` (read-only; Anthropic-tier comparison over real pool rows), `scripts/audit-gate-variance.ts` (#1258; precision / variance-vs-bias, Haiku-ensemble vs Sonnet).
- `CLAUDE.md` → "Anthropic model split" records the factual-gate Sonnet exception.
