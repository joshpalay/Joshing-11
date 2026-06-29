# D-LLM-PROVIDER-ZAI-01 — Evaluate z.ai (GLM) as a third LLM provider

**Status:** DEFERRED (2026-06-29) — parked, not ratified. Revisit if LLM spend climbs
(`getMonthToDateLlmSpendUsd()` is the trigger metric). The cost upside is concentrated on the
generation path (~8×); grading already runs on the cheap Haiku tier, so little is left on the table
at current volume. Decisions A–E carry recommendations below for whoever picks this back up.
**Precedes:** `B-LLM-PROVIDER-ZAI-01` (no build prompt until ratified).
**Depends on:** `D-LLM-COST-LATENCY-REPORT-01` (per-call / monthly tables stay blank until its telemetry lands).
**Related:** `B-LLM-PROVIDER-AB-SWITCH`, `D-LLM-PROVIDER-AB-AND-GATE-TIER-01`, `src/server/llm/provider.ts`, `src/server/llm/pricing.ts`.

This is the evaluation companion to the decision brief. The brief's context, constraints, and the
A–E option menu are unchanged and not restated. What follows is (1) what the codebase actually
looks like at the integration point, (2) three findings that change how A–E should be read, and
(3) a recommendation on each decision. Per-call and monthly cost figures remain **blank by design**
— they are telemetry outputs, not estimates (see §6).

---

## 1. Integration surface — verified against the code (2026-06-29)

The brief's "adapter + pricing-entry job, not an architectural change" is *mostly* right but
understates the diff. The provider machinery exists and is the correct seam, but it is built as a
**closed two-value union**, not an open registry. Concretely, adding GLM touches:

| Site | File | What changes |
|------|------|--------------|
| Provider union | `src/server/llm/provider.ts:23` | `LlmProvider = 'anthropic' \| 'openai'` → add `'glm'`. Threaded through settings, telemetry, schema types. |
| Client + completion | `src/server/llm/provider.ts:72-172` | `getOpenAIClient()` hardcodes `new OpenAI({ apiKey })`. GLM is OpenAI-wire-compatible, so the cheap path is one client with `baseURL` + `GLM_API_KEY` reusing `openaiCompleteJsonText`; the placeholder-key guard (`sk-` prefix) is OpenAI-specific and needs a GLM variant. |
| Dispatch | `src/lib/llm.ts:330-376` (`dispatchLlmText`) | Branches `provider === 'openai'` vs Anthropic. A third branch (or a generalized "OpenAI-compatible" branch keyed by base URL) is required. |
| Settings surfaces | `src/server/llm/settings.ts` | Four switchable surfaces — `gen`, `categorize`, `suggest`, `grade`. Each must accept `'glm'`. |
| **Schema CHECK constraints** | `src/server/db/schema.ts:1357-1360` | All four `AppSettings_*_provider_valid` checks are `IN ('anthropic', 'openai')`. **Adding `'glm'` requires a Drizzle migration** to alter the four CHECKs, plus an idempotent instrumentation guard per `CLAUDE.md`. The provenance columns (`categorize_provider`, `llm_provider`, `generated_by_provider`) are bare `text` (no CHECK) and need no migration. |
| Pricing rows | `src/server/llm/pricing.ts:39` | Add GLM model rows. Unknown models already fall back to `unpriced` (safe), so a missing row degrades to "tokens known, $ unknown" rather than a wrong number. |
| Env | `.env.example` | `GLM_API_KEY`, `GLM_MODEL`, `GLM_GRADING_MODEL` mirroring the OpenAI trio. |

**Net:** still no new architecture, but it is **a migration + a closed-union widening across ~6
files**, not a drop-in row. Scope the build prompt accordingly; the "just a pricing entry" framing
will under-budget it.

---

## 2. Finding A — the 8× cost headline applies to **generation only**, not grading

This is the most important correction and it reshapes Decision A.

The brief's price table labels Sonnet 4.6 ($3 / $15) as the "Current grading + generation default."
That is wrong for grading. Per `CLAUDE.md` and `src/lib/llm.ts:78-82`:

- **Generation** runs on **Sonnet 4.6** — `$3 / $15`.
- **Grading + categorization** run on **Haiku 4.5** — `$1 / $5` (`GRADING_MODEL = 'claude-haiku-4-5-20251001'`).

So the cost ratio GLM must be measured against differs by path (using the brief's GLM-4.7
list rate of ~$0.40 / $1.75, which is third-party and **not** verifiable from the Anthropic price
table — confirm against your z.ai billing before relying on it):

| Path | Incumbent | Incumbent rate | GLM-4.7 rate | Input ratio | Output ratio |
|------|-----------|----------------|--------------|-------------|--------------|
| Generation | Sonnet 4.6 | $3 / $15 | ~$0.40 / ~$1.75 | **7.5×** | **8.6×** |
| Grading | **Haiku 4.5** | $1 / $5 | ~$0.40 / ~$1.75 | **2.5×** | **2.9×** |

**Implication:** the "~8× cheaper" story is real for the **generation** path and roughly **3× for
grading** — because grading already sits on the cheap tier. The cost case for moving grading to GLM
is therefore *much weaker* than the headline suggests, while the product risk (a falsely-wrong
answer is a "product betrayal" per canon) is *much higher*. Cost and risk both point the same way:
**pilot generation, hold grading.** (See Decision A.)

---

## 3. Finding B — the factual gate is **not** reachable by this switch

`findFactualFailures` (the factual gate) defaults to Sonnet via `FACTUAL_GATE_MODEL` and, per
`D-LLM-PROVIDER-AB-AND-GATE-TIER-01`, is a **model-tier** lever that is *not* one of the four
switchable surfaces. A GLM pilot on `gen` cannot and must not silently move the gate. Whatever
Decision A chooses, the gate stays on its pinned model. Worth stating explicitly in the build prompt
so nobody wires GLM into the gate "for consistency."

---

## 4. Finding C — the leniency-gate telemetry already exists (partially)

Decision B's "fail-toward-player" north-star is already instrumented:
`readGradingQualityByProvider()` (`src/server/db/queries/llm-provider-experiment.ts`) returns
**wrong-answer rate per grading provider** over a window, keyed off `MASTERY_EVENTS.llm_provider` +
`answer_state`. That is exactly the B2 (shadow/live comparison) substrate — once GLM grades anything,
its falsely-wrong rate is directly comparable to Anthropic's.

What does **not** exist yet is B1's **labeled historical replay** harness. The closest precedent is
the gate-audit scripts (`scripts/audit-gate-compare.mjs`, `scripts/audit-gate-variance.ts`), which
are the right shape to clone for a "replay N ambiguous answers, assert zero false-wrongs vs the
labeled set" gate. So B1 is a script-write, not net-new infrastructure.

---

## 5. Recommendations on A–E

### Decision A — Pilot path → **A1 (generation only)**
Both cost (§2: 8× on generation vs ~3× on grading) and the fail-toward-player constraint point here.
Grading stays Anthropic for the window (the never-flip-both rule makes this mandatory regardless).

### Decision B — Grading leniency gate → **B3 (B1 then B2), as a precondition for any future grading pilot**
Since A1 holds grading on Anthropic, B does not gate the *first* pilot — but it must be settled before
GLM ever grades. Recommend B3: clone the gate-audit script for B1 (labeled replay, **zero
false-wrongs** required), then B2 (shadow-grade live, hand-review every disagreement) using the
already-built `readGradingQualityByProvider` readout. The forced-correct-on-uncertainty default
stays in force throughout.

### Decision C — Reasoning mode on grading → **C1 (reasoning disabled/minimal)**
Keeps GLM's per-call output-token count comparable so the cost projection stays honest (a verbose
reasoning trace bills at the output rate). This only bites if/when grading moves to GLM; adopt it as
the standing default so C is never an open question at grading-pilot time.

### Decision D — Model pin & fallback → **D1 (pin GLM-4.7, fall back to Anthropic)**, trigger on **error + latency**
D3 (no fallback) is rejected outright — it breaks gameplay on any GLM hiccup, and the existing
dispatch already returns `null`/throws into the caller's fallback path, so wiring Anthropic as the
fallback is cheap and idiomatic. Prefer flagship GLM-4.7 over GLM-4.6 (D2) — near-identical price,
newer model. Make the fallback trigger **error *and* a latency threshold** (reuse the existing
20 s `DEFAULT_OPENAI_TIMEOUT_MS` pattern in `provider.ts:48`) so a slow-but-not-failed GLM call on a
player-facing path still falls back rather than stalling the loading moment.

### Decision E — Latency acceptance threshold → **E1 (hard TTFT + round-trip ceiling)**
The loading-moment UX is latency-sensitive (`D-LOADING-MOMENT-SURFACE-01`); accept-whatever (E2) is
the wrong posture for any player-facing path. Set the ceiling from the shadow-window measurement in
`D-LLM-COST-LATENCY-REPORT-01`, not from a guess. GLM must beat it or stay off the player-facing path
regardless of cost.

**Summary:** A1 · B3 (precondition, not first-pilot blocker) · C1 · D1 + error&latency fallback · E1.

---

## 6. What stays blank until `D-LLM-COST-LATENCY-REPORT-01` ships

The per-call, monthly, and latency tables in the brief are **telemetry outputs** and are left blank
deliberately — estimating them from memory is explicitly out of bounds. The inputs are already being
captured: `llmUsageEvent` rows feed `readUsageCostByProvider()` / `getMonthToDateLlmSpendUsd()`, and
`pricing.ts` reprices historical rows at read time (no backfill on a price change). Once the
cost/latency report lands, drop the GLM pricing rows in and the tables populate from real traffic.

**Done-when (for the eventual `B-LLM-PROVIDER-ZAI-01`, unchanged in intent, sharpened by §1):**
- `'glm'` added to `LlmProvider` and threaded through `settings.ts` + the four AppSettings surfaces.
- Drizzle migration widening the four `AppSettings_*_provider_valid` CHECKs to include `'glm'`, with an idempotent instrumentation guard.
- GLM client (OpenAI-compatible `baseURL` + `GLM_API_KEY`) wired into a `dispatchLlmText` branch; grep-confirmed registered.
- GLM pricing rows in `pricing.ts` (input/output; cache fields inert on the completion path, same as OpenAI).
- A/B switch routes the chosen path (per A1: `gen`) to GLM without touching the `grade` toggle.
- Anthropic fallback on error + latency (per D1); factual gate untouched (§3).
- Leniency gate (Decision B) recorded as passed in `DECISIONS.md` **before** any GLM grading reaches players.
