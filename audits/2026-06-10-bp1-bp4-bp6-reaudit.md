# Re-audit — BP-1 / BP-4 / BP-6 conformance-audited surfaces (2026-06-10)

**Scope:** the one-pass re-audit the BP-1→BP-6 series calls for ("After these six"), covering the
three changes that touched 🔁 conformance-audited surfaces:

- **BP-1** (`4f0d2db`, `b13e5eb`) — bank-reuse field preservation → **B1/B4** (pool substrate /
  verification stack, PRD-D-5 §5.1, §5.3, D11).
- **BP-4** (`c3d6fd6`) — `GENERIC_AT_TIER` quality-gate defect → **B2/B4** (register fixes /
  gate stack, PRD-D-5 §5.2, D4; fail-direction contract).
- **BP-6** (`4286405`) — answered-canonical texts in the avoid lists → **B1–B5** (avoid-list /
  dedup substrate, PRD-D-5 D10; C3 prompt budget).

**Method:** read-only verification of the as-built code against PRD-D-5 and the gate contracts,
*plus* two remediations applied in this same pass where the re-audit found real gaps (F1, F2 below).
Companion to `audits/2026-06-10-question-generation-selection-audit.md` (the findings ledger) and
the original `audits/2026-06-02-restructure-conformance-audit.md` format.

## Legend

✅ CONFORMS · ⚠️ FINDING (fixed in this pass) · 👁 WATCH (no action now, named owner/trigger)

---

## 1. Summary

| # | Surface / check | Status |
|---|---|---|
| 2.1 | BP-1: copy carries the six question-intrinsic fields; per-viewer fields stay scoped | ✅ |
| 2.2 | BP-1: verify-once-reuse-many — the canonical **promotion chain** through reuse | ✅ (stronger than the original finding — see note) |
| 2.3 | BP-1: play stats / dedup bookkeeping NOT copied (D11 integrity) | ✅ |
| 3.1 | BP-4: fail-open contract unchanged; defect tier-gated; no new LLM call | ✅ |
| 3.2 | BP-4: exemplar-whitelist clause exempted the new defect | ⚠️ **F1 — fixed** |
| 3.3 | BP-4: rubric behavior validated live | 👁 **W1 — evals pending** |
| 4.1 | BP-6: advisory-only (no gate/persist-guard behavior change); domain-scoped; resilient | ✅ |
| 4.2 | BP-6: prepended entries could displace history from the enforcement-gate window | ⚠️ **F2 — fixed (cap 25→12)** |
| 5.1 | Adjacent (pre-existing): +2 authored fold can dominate the same gate window | 👁 W2 |
| 5.2 | Adjacent (pre-existing): serving copies inflate pool-depth counts used by retrieval demand | 👁 W3 |

Verdict: **all three surfaces conform after F1/F2**; nothing blocks merge. W1 is the one open
verification (requires an API key) and should gate *reliance on* the BP-4 rubric, not the merge.

---

## 2. BP-1 — bank-reuse field preservation (B1/B4)

**2.1 ✅** The serving-copy insert (`generate-questions.ts`, `pickBankPicksForDomains`) carries
`insideJoke`, `trustTier`, `askToAnswerVerified`, `acceptableVariants`, `sourceRefs`, `perishable`
from the source row; `userId`, `expiresAt`, `usedInQueue` stay viewer-scoped. Pinned by
`bank-pick-field-preservation.test.ts`; the route→grader variant flow pinned in the answer-route
tests; grading's variant fast-path pre-existing in `grading-fail-toward-player.test.ts`.

**2.2 ✅ — and the fix was more load-bearing than finding Q4 stated.**
`persist-generated-question.ts:187` carries `generated.trustTier` onto the canonical `Question` row
when a generated question is first answered, with the explicit comment that without it the canonical
row "would default to 'unverified' and never promote." Since serving copies previously defaulted to
`unverified`, **every reused question's canonical row was entering the pool unable to promote to
`human_validated`** — quietly capping the trust ladder (PRD-D-5 §6) for exactly the questions reuse
makes most common. BP-1 repaired the whole chain: source `machine_verified` → copy → canonical →
human-play promotion. No code path was found that relies on copies being `unverified` (consumers:
`pickBankSource`'s shadow tier gate, `persist-generated-question`, pool report).

**2.3 ✅** `nAnswered` / `empiricalCorrectRate` (D11 inputs) and `isDuplicate` / `suppressedBy` /
`embedding` (D10 bookkeeping) are not copied — asserted by test. Empirical difficulty stays
per-row; a copy cannot inherit its source's play history.

---

## 3. BP-4 — GENERIC_AT_TIER on the quality gate (B2/B4)

**3.1 ✅** The defect is a 5th class on the existing `findQualityFailures` call (no new LLM call);
the catch-block fail-open contract is byte-identical and pinned by a test; the rubric prose gates it
to moderate/specialist with explicit never-at-accessible and when-uncertain-do-not-flag language;
per-candidate `tier=` uses `difficulty_estimate` — the same field `resolveDailyBasePoints` and bank
matching treat as the question's tier, so gate and serving path agree.

**3.2 ⚠️ F1 — fixed in this pass.** The gate's exemplar-whitelist clause read *"Only flag a question
matching one of those styles if it independently exhibits ANSWER_LEAKED, OPINION_OR_VAGUE,
FALSE_PREMISE, or SELF_ANSWERING"* — an enumeration that omitted the new defect. Because most
roster questions are identification-shaped ("concise idiomatic") and therefore arguably match the
whitelisted styles, the clause could be read as **exempting exactly the questions GENERIC_AT_TIER
exists to catch**. Fixed: the enumeration now includes *"or — at moderate/specialist tier only —
GENERIC_AT_TIER"* plus an explicit *"style never exempts a question from the tier bar."*

**3.3 👁 W1.** The rubric's live judgment (roster flagged at specialist; same question passes at
accessible; fan-salient-but-plain passes; exemplar-style accessible passes) is pinned only by the
opt-in evals (`quality-gate.eval.test.ts`) — **not yet run** (no API key in the build environment).
Run `npm run test:evals` before treating the rubric as active protection; until then it is a
plausible-but-unvalidated prompt change that fails open.

---

## 4. BP-6 — answered-canonical texts in the avoid lists (B1–B5)

**4.1 ✅** `getRecentAnsweredCanonicalTexts` is a read-only join (masteryEvents → questions,
30-day window, ≤100 rows, `source <> 'daily_generated'`, deleted excluded, deduped by normalized
text). Entries ride the existing advisory avoid-list into the prompt block and the Haiku history
gate's input; the gate's rubric, the persist-time fact-key guard, and the bank's text guard are
unchanged. Domain-scoped via `domainKey` (spelling-variant safe) at both call sites; `.catch → []`
keeps generation resilient to a failed read. Pinned by `answered-canonical-avoid.test.ts`.

**4.2 ⚠️ F2 — fixed in this pass.** The semantic history gate — "the actual enforcement boundary"
per the code's own comment — sees only the first `RECENT_HISTORY_GATE_LIMIT` (30) avoid entries,
and BP-6's entries are *prepended*. At the original cap (25), a worst-case fold left as few as
**5 of 30** window slots for the generated history the gate exists to police, on the core daily
path. Fixed: `ANSWERED_CANONICAL_AVOID_TEXT_LIMIT` lowered 25 → **12** (≥18 history slots
worst-case), with the displacement rationale documented at the constant.

---

## 5. Adjacent pre-existing observations (not regressions from this series)

**5.1 👁 W2 — the +2's authored fold has the same window-displacement property, bigger.**
`AUTHORED_AVOID_TEXT_LIMIT` (40) entries are prepended on the bonus path and alone can fill the
entire 30-slot gate window for a prolific author. Pre-dates this series. Owner/trigger: fold into
BP-7/BP-8 work on the +2 — the clean fix is passing generated-history to the gate separately from
caller-supplied advisory texts rather than rationing one shared window.

**5.2 👁 W3 — serving copies inflate pool-depth metrics.** Every bank reuse inserts a copy row
with a fact_key and `is_duplicate=false`, so per-domain "pool depth" counts (e.g. retrieval
demand's thin-domain threshold) count the same question once per serve. Pre-dates this series
(copies always existed); becomes material when `RETRIEVAL_GROUNDING_ENABLED` flips on — a
domain can look deep because it was *served* a lot, not because it has distinct facts.
**Resolved by BP-7 (2026-06-10):** the flip-decision metric (`depthByDomain` on
`/api/dev/pool-report`) counts **distinct fact_keys** grouped by folded domain — and on
verification, `getThinActiveDomains`' refill threshold already counted
`count(distinct fact_key)` (`retrieval-demand.ts:32`), so the demand side was never
row-inflated; only the reporting lacked the honest number, and now has it.

---

## 6. Verification

- F1/F2 applied and green: `npx tsc -p tsconfig.typecheck.json` exit 0; daily suite 134 passed +
  4 eval-skipped; lint 0 errors (16 pre-existing warnings).
- Outstanding: **W1** (`npm run test:evals` with `ANTHROPIC_API_KEY`) — the only unvalidated piece
  of the BP series.
