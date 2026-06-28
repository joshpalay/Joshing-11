# B-AREA-EXPANSION-01 — Area Expansion as a Game-End Reward (build prompt)

**Source of intent:** `D-AREA-EXPANSION-01.md` (SETTLED 2026-06-28; ratified **A3 + B2 + C1 + D2 + E1**).
**Branch:** `claude/area-expansion-game-end-8xn2kc`.
**Status:** READY — but **Phase 0 is a hard gate**. There is significant prior art (see below) the D doc did not account for; do not write feature code until Phase 0 reconciles it and Josh signs off.

---

## 0. The thing the D doc didn't know about — READ THIS FIRST

`D-AREA-EXPANSION-01` §2 lists what exists and calls candidate generation, the chooser, and the write "net-new." That is **not accurate**: a complete expansion-offer feature already ships on a *different* surface. Before anything else, read these and internalize them:

| Existing piece | Where | What it does |
|---|---|---|
| Offer card (UI) | `src/app/daily/summary/ExpandDomainOfferCard.tsx` | "You're crushing {domain} — branch out?" Multi-select adjacent domains; accept/dismiss both resolve once. |
| Offer builder | `buildExpansionOffer()` in `src/server/db/queries/daily-summary.ts:366` | Trigger → candidate gen → de-dupe against active interests → `ExpansionOffer` (`daily-summary.ts:54-60`). |
| Candidate generation | `suggestAdjacentDomains(sourceDomain, broadCategory)` (called at `daily-summary.ts:380`) | **Haiku-proposed ADJACENT/sibling domains** (lateral), not broader parents. |
| Trigger signal | `getPendingExpansionDomains()` / `expansionEligibleSince`, set by `recalibrateDomainDifficultyToSupply` in `src/server/adaptive-difficulty.ts` | Fires when the player **topped a domain's difficulty ladder yet out-ran its content** (supply ceiling) — NOT the narrow-KB thinness threshold. |
| Accept/dismiss API | `POST /api/daily/expand-domains` (`src/app/api/daily/expand-domains/route.ts`) | Writes chosen domains via **`addDeclaredInterest`** (a `declaredInterests` row), then `markDomainExpansionOffered`. Does **not** call `openKBDomain`. |
| Diagnostics | `/dev/expansion-offer` (funnel), `/daily/summary/expand-preview` (card preview) | Already wired into profile dev-tools. |

### How the existing feature differs from what D-AREA-EXPANSION-01 specified

| Axis | Existing (daily-summary) | D-AREA-EXPANSION-01 (this build) |
|---|---|---|
| **Direction** | Lateral — *adjacent siblings* | Vertical — *one level broader* (Pride → Moral Philosophy) |
| **Surface** | Post-daily-Five summary card | Game-end / season recap (`CompletedRecapHeader.seasonHighlights`) — S3 |
| **Trigger signal** | Difficulty ladder topped + supply ceiling (`expansionEligibleSince`) | Narrow-KB thinness threshold (`narrowKbThinnessThreshold()`) |
| **Write target** | `declaredInterests` (enters daily rotation) | `playerMastery` declared row via `openKBDomain({ via: 'expansion' })` |

These are genuinely two different features that share a name. The D doc's decisions stand, but **Phase 0 must resolve the four reconciliation questions below and get Josh's answers before Phase 1.** Do not silently pick.

### Phase 0 reconciliation questions (answer with Josh, in writing, before coding)

- **R1 (candidate direction).** Decision B wants "one level up." `suggestAdjacentDomains` produces siblings. Do we (a) add a `broader`/`parent` mode to `suggestAdjacentDomains`, (b) write a sibling helper `suggestBroaderDomains`, or (c) curated-map-first per B2 with that as the LLM fallback? *Recommend (c): the curated virtues/vices→parent map is the launch path; a constrained "one level up" LLM call is the fallback, implemented as a new mode on the existing helper so there's one LLM entry point for expansion.*
- **R2 (write target).** Decision D writes a `playerMastery` declared row via `openKBDomain`. The existing path writes a `declaredInterests` row (which is what actually enters daily rotation). Does a game-end expansion (i) write only the `playerMastery` declared row (shows on the portrait, does NOT enter rotation), (ii) write only a `declaredInterest` (enters rotation, existing path), or (iii) both? *Recommend: confirm with Josh. D-AREA-EXPANSION-01 §7 done-when asserts a `playerMastery` declared row, so at minimum (i); whether the broader area also enters daily rotation is a product call (likely yes → (iii)), but it changes the write and the done-when.*
- **R3 (one offer or two).** With both surfaces live, a player could see a lateral offer on the daily summary AND a vertical graduation in the recap. Is that intended, or does one suppress the other? *Recommend: keep them independent for launch (different signals, different moments), but log both under the same `[expansion-offer]` funnel key so we can see overlap.*
- **R4 (provenance honesty).** Decision D's source-area record (`masteryEvents` row, mirroring `declared_promoted` at `open-domain.ts:145-160`) must be added regardless of R2. Confirm the `sourceType`/`metadata` shape with whoever owns the masteryEvents analytics.

**Phase 0 deliverable:** a short ADDENDUM appended to `D-AREA-EXPANSION-01.md` recording R1–R4 answers. Then proceed.

---

## Read-first symbol verification (all confirmed present 2026-06-28)

Re-confirm these signatures still hold before editing (grep them; do not trust this list blind):

- `openKBDomain(params)` — `src/server/knowledge/open-domain.ts:8`. `via: 'friend_answered' | 'authorship' | 'onboarding' | 'answered_correctly'` is a **plain TS union on the param (line 11), NOT a DB enum** → adding `'expansion'` needs **no migration**. The declared mapping is the ternary at `open-domain.ts:15` (`via === 'authorship' ? 'declared' : 'demonstrated'`) — it MUST be widened to include `'expansion'`, or the new area lands as `demonstrated`.
- `territoryTypeEnum = pgEnum('TerritoryType', ['declared','demonstrated'])` — `schema.ts:190`. `playerMastery.territoryType` defaults to `'demonstrated'` (`schema.ts:464`) → expansion write must set `'declared'` explicitly.
- `CompletedRecapHeader` — `src/components/games/game-details-mode-sections.tsx:25`; props `seasonHighlights?: Array<{ id; label; prompt }>` (`:11-16`), currently fed nothing.
- `narrowKbThinnessThreshold()` → `getRetrievalConfig().poolDepthThreshold` — `src/server/daily/kb-exhaustion.ts:55`. Fire expansion eligibility on this same boundary (D §2) so detection never drifts.
- `reconcileProposedDomain()` — `src/lib/questions/categorization.ts:28` (the granularity discipline expansion deliberately inverts).
- First-game recap pure-beat pattern — `src/server/games/first-game-recap.ts` (the server-compute model to follow for the expansion beat).

---

## Hard guardrails (apply to every phase)

- **Fail toward the player (D §3).** If the expansion write fails, show **no** "you expanded" confirmation and never lose the source area. Verify at the hook/compute level, not just the route. Mirror the soft-fail precedent (`ensureAuthoredDomainsOpened`, `promoteDeclaredToDemonstrated`'s try/catch).
- **Additive only (E1).** The source area's `playerMastery` row is **never** mutated or deleted by expansion. No silent fold (the exact thing `reconcileProposedDomain` forbids).
- **One graduation per game (A3).** At most one expansion offer per completed game, for the single thinnest area *touched this game*.
- **Provenance honest (D2 + R4).** Record what expanded into what (source area on the new row's provenance trail), via the agreed `via: 'expansion'` value and a `masteryEvents` event.
- **Conventions (CLAUDE.md):** Zod on every new API input; DB access only in `src/server/db/queries/`; LLM calls only under `src/server/llm/` (Haiku for candidate proposal, matching `reconcileProposedDomain`); no raw hex / no new color-only signal / no streak-or-competition register in any expansion copy; run `npm run lint`, `npx tsc -p tsconfig.typecheck.json`, and the relevant `check:*` ratchets before each phase boundary.
- **Routing:** never add `src/middleware.ts` — extend `src/proxy.ts` (CLAUDE.md).

---

## Phases (each ends at an approval gate — stop and report; do not roll into the next)

### Phase 0 — Reconcile prior art *(gate: Josh answers R1–R4; addendum written)*
Read every file in §0. Write the R1–R4 addendum to `D-AREA-EXPANSION-01.md`. **No feature code.**

### Phase 1 — Eligibility compute (pure, server) *(gate: unit tests green, no UI)*
- A pure function (model: `first-game-recap.ts`) that, given a completed game's touched domains + each domain's pool depth, returns at most one `ExpansionEligibility | null`: the thinnest area touched this game that is at/under `narrowKbThinnessThreshold()`.
- No writes, no LLM yet. Deterministic and fully unit-tested (eligible / not-thin / not-touched / ties → single thinnest).

### Phase 2 — Candidate generation (per R1) *(gate: curated map covers virtues/vices; fallback constrained to one level up; ≤3 candidates)*
- Curated map first (seven virtues/vices → natural parents). Constrained LLM fallback (one jump only) under `src/server/llm/`, Haiku. Reuse/extend `suggestAdjacentDomains` per R1's resolution — do not add a second LLM entry point for expansion.
- De-dupe against the player's existing declared areas/interests (mirror `buildExpansionOffer`'s `have` set). Return ≤3.

### Phase 3 — The write + provenance (per R2 + R4) *(gate: done-when writes verified; fail-soft proven)*
- Add `via: 'expansion'` to the `openKBDomain` union and widen the `open-domain.ts:15` mapping so it yields `'declared'`. Write the chosen target. Write the `masteryEvents` provenance event carrying the source area. Honor R2's decision on whether a `declaredInterest` is also written.
- Wrap in the fail-soft pattern: a write failure returns a typed failure the caller can detect (no false confirmation).

### Phase 4 — Recap chooser UI (C1) *(gate: inline chooser renders; collapses to confirmation pill; emits `seasonHighlights`)*
- Feed `CompletedRecapHeader.seasonHighlights`. Inline chooser (the existing `ExpandDomainOfferCard` is a strong copy/interaction reference — reuse its accept/dismiss/loading states; do NOT reuse its `addDeclaredInterest`-only write unless R2 says so). On commit it collapses to a single confirmation pill in place. On write failure: no confirmation pill (guardrail).
- Add a Zod-validated route for the commit (or extend an existing one if R2 lands on reuse). New input → Zod.

### Phase 5 — Wire-up + funnel logging + dev preview *(gate: full path works in dev; §7 done-when all checkable)*
- Surface the eligibility through the recap path. Emit `[expansion-offer]` funnel lines (eligible → shown → resolved) consistent with the existing keys so both surfaces share one funnel.
- Add a `/daily/...` or `/dev/...` preview for the recap variant (mirror `expand-preview`) so it's inspectable without a real thin area.

---

## Done-when (from D §7 — make each grep-/test-checkable)

- [ ] A thin area touched in a completed game produces **exactly one** expansion offer in the recap (eligible only when thin + touched; capped to one per game).
- [ ] Choosing a target writes a `playerMastery` row with `territoryType = 'declared'` and the chosen `canonicalSubcategory`, via `via: 'expansion'`.
- [ ] The source area's row is **unchanged** (before/after assertion on the source row).
- [ ] A failed expansion write shows **no** "you expanded" confirmation (asserted at the compute/hook level).
- [ ] The new area shows as **declared (not demonstrated)** on the knowledge portrait until a correct answer lands in it.
- [ ] No raw hex, no new color-only signal, no streak/competition register in any expansion copy (`npm run check:colors` clean; copy review).
- [ ] R1–R4 addendum exists in `D-AREA-EXPANSION-01.md` and the build matches the answers.
- [ ] `npm run lint` + `npx tsc -p tsconfig.typecheck.json` clean.
