# D-AREA-EXPANSION-01 — Area Expansion as a Game-End Reward

**Status:** SETTLED — decisions A–E ratified 2026-06-28 (**A3 + B2 + ~~C1~~ + ~~D2~~ + E1**). **Amended same day by the §9 ratification addendum** (R1–R4 + surface), which **supersedes C1, D2, S3, and §6** after a code read surfaced an existing expansion surface the original draft didn't know about. Read §9 — it governs the build. §2 claims verified against the live repo. Ready for `B-AREA-EXPANSION-01`.
**Author:** Claude (with Josh)
**Supersedes / relates to:** narrow-KB exhaustion guard (`src/server/daily/kb-exhaustion.ts`), domain reconciliation (`src/lib/questions/categorization.ts`), game-end recap (`src/server/games/first-game-recap.ts`, `src/components/games/game-details-mode-sections.tsx`).

---

## 1. The problem in plain language

Some declared interest areas are simply *small*. "Pride" — one of the seven virtues and vices — holds only so many quizable facts before it's genuinely tapped out. Today, when an area goes thin, the system's only move is **defensive**: stop writing new questions for it (because the generator starts fabricating false canon at low pool depth) and quietly **borrow questions from your other areas** to fill the slot.

That's the right *safety* behavior, but it wastes a moment. A small area running dry isn't a failure — it's a sign the player has *covered the ground*. The product instinct here is to treat that as a **graduation**: "You've worked through Pride. Want to open it up into something larger?" — Pride → the Seven Deadly Sins, or → Moral Philosophy, or → Dante's Inferno. The player chooses, the system congratulates, and a new (broader) area opens on their knowledge map.

This doc decides how that works without violating product canon.

---

## 2. What already exists (so we don't rebuild it)

Verified against the live repo on 2026-06-28 (branch `claude/area-expansion-game-end-8xn2kc`). Every file and symbol below was confirmed present at the cited location.

| Thing | Where | State |
|---|---|---|
| **Narrow-KB exhaustion guard** | `src/server/daily/kb-exhaustion.ts` | Built, **OFF by default** (`NARROW_KB_GUARD_ENABLED`, defaults `false` at `kb-exhaustion.ts:47`). Detects thin declared areas; suppresses fabrication; backfills from other domains. This is the *detection* signal expansion can reuse. |
| **Thinness threshold** | `narrowKbThinnessThreshold()` (`kb-exhaustion.ts:55`) → `getRetrievalConfig().poolDepthThreshold` | The shared "this area is thin" line. Expansion should fire on the **same** boundary so detection never drifts. |
| **Domain reconciliation** | `reconcileProposedDomain()` at `src/lib/questions/categorization.ts:28` | Built. Tuned to **never fold a narrow area into a broad one** ("Hamlet" ≠ "Shakespearean Tragedy"). Expansion is the deliberate, player-visible exception to this rule. |
| **Game-end recap (server)** | `src/server/games/first-game-recap.ts` | Built as a *pure beat computation* pattern. The model to follow for an expansion beat. |
| **Game-end recap (render)** | `CompletedRecapHeader` in `game-details-mode-sections.tsx` | Built. Renders a `seasonHighlights?: Array<{ id; label; prompt }>` pill row (props at `game-details-mode-sections.tsx:6-16`). **Currently fed nothing** — a rendering slot waiting for content. |
| **Declared-territory write** | `openKBDomain()` in `src/server/knowledge/open-domain.ts` | Built. Writes a `playerMastery` row with `territoryType: 'declared'` when `via === 'authorship'` (the ternary at `open-domain.ts:15`). This is the exact provenance write expansion needs. |
| **Territory model** | `territoryTypeEnum = pgEnum('TerritoryType', ['declared','demonstrated'])` (`schema.ts:190`); `playerMastery.territoryType` (`schema.ts:464`, **defaults `'demonstrated'`**) | Built. Declared = claimed/written; demonstrated = proven by correct answers. Because the column defaults to `'demonstrated'`, an expansion write MUST set `territoryType: 'declared'` explicitly. |

**Net-new work expansion requires** (nothing below exists today):
1. A rule that computes *expansion candidates* for a thin area (Pride → which broader targets?).
2. A **chooser interaction** at game-end (the recap is display-only today; nothing lets a player pick).
3. The wiring that calls `openKBDomain` with the chosen target as **declared** territory.

---

## 3. Settled choices (already decided with Josh)

These are **not** open — recorded here so the build inherits them:

- **(S1) Player chooses the target.** The system proposes candidates; the player picks. No silent/automatic expansion.
- **(S2) Expanded area is `declared` territory.** The player has *claimed* the broader area, not *proven* it. It shows as declared (not demonstrated) on the two-axis portrait until they answer correctly in it. Written via `openKBDomain` with the new `'expansion'` provenance value (see Decision D), which must map to `territoryType: 'declared'`.
- **(S3) Reward lives at game-end, not the biweekly ceremony.** Expansion is celebrated in the **season/game-end recap** (`CompletedRecapHeader`), because that's where *this game's* thin areas actually surfaced. The biweekly ceremony (`BiweeklyCeremony`, Sunday 08:00 UTC) is a separate surface and is **not** touched by this work.

### Canon guardrail this build must honor

The reconciler exists to stop a narrow label from silently serving a broad domain (the "broad domain quietly contains only one slice" bug). Expansion is the *deliberate* version of that fold, so it is only legitimate if it is **player-initiated and provenance-honest**:

- The expansion MUST write an explicit record of *what expanded into what* (Pride → Moral Philosophy), not a silent relabel of the old area.
- "Fail toward the player": if the expansion write fails, the player must not lose their original area or be shown a false "you expanded!" beat. No false-confidence celebration.

---

## 4. Decisions A–E — RATIFIED 2026-06-28

All five locked to the §5 recommended default. Rationale retained for the record.

### Decision A — When is expansion *offered*? → **RATIFIED: A3**

The thin signal already exists mid-play; the reward is at game-end. So which areas get offered?

- **A1.** Offer expansion only for areas that crossed the thinness threshold *during this game* (tightly coupled to play; feels earned).
- **A2.** Offer expansion for any of the player's areas that are currently thin at game-end, regardless of whether they were touched this game (more candidates, but can feel arbitrary — "why is it offering to expand an area I didn't play?").
- **✅ A3 (RATIFIED).** A1, but cap to the single thinnest / most-touched area per game-end so the moment stays focused (one graduation per game, not a checklist).

*Why:* One clear graduation keeps the moment ceremonial rather than chore-like, and respects "interface quiet, content loud."

---

### Decision B — How are expansion *candidates* generated? → **RATIFIED: B2**

Pride → {what}? The candidate set is the heart of the feature.

- **B1.** LLM-proposed at game-end (Haiku, same pattern as `reconcileProposedDomain`): given the thin area, propose 2–3 broader parent domains. Flexible, but adds an LLM call to the recap path and can propose junk.
- **✅ B2 (RATIFIED).** A curated static map for known small areas (the seven virtues/vices → their natural parents), with a **B3-style constrained LLM fallback** (one level up only) for unmapped areas. Predictable for the canonical cases we care about; constrained fallback covers the long tail without hand-authoring it.
- **B3.** LLM-proposed but **constrained to one level up** (a single work → its author/series/genre; never two jumps), mirroring the reconciler's granularity discipline in reverse. *(Folded into B2 as the fallback.)*

*Why:* Gives control over the cases that motivated this, without hand-authoring the whole long tail.

**Ratified sub-question — candidate count:** **3 max**, to keep the chooser a glance, not a menu.

---

### Decision C — Where does the chooser live, structurally? → **RATIFIED: C1**

`CompletedRecapHeader` is display-only today. The chooser is net-new UI.

- **✅ C1 (RATIFIED).** Inline in the recap — the expansion beat *is* the chooser (pick a pill → it commits → the pill becomes the "you expanded" confirmation in place). The chooser collapses to a single confirmation pill once chosen.
- **C2.** A separate step/screen in the recap flow (its own beat, like the first-game recap's Beat 2), with the result then shown as a `seasonHighlights` pill.
- **C3.** Deferred-but-pinned: recap shows "An area is ready to grow →", tapping opens the chooser as a modal; if dismissed, it resurfaces. *(Revisit only if A2 had won and there could be many offers — moot under A3.)*

*Why:* Lowest friction for the common single-area case, which A3 guarantees.

---

### Decision D — Provenance value for the write → **RATIFIED: D2**

`openKBDomain` currently takes `via: 'friend_answered' | 'authorship' | 'onboarding' | 'answered_correctly'` (`open-domain.ts:11`). Expansion is none of these exactly.

- **D1.** Reuse `via: 'authorship'`. Zero change, but conflates "wrote a question" with "expanded an area" in any analytics keyed on `via`.
- **✅ D2 (RATIFIED).** Add a new `via: 'expansion'` value (still maps to `declared`). Keeps provenance honest and analytically distinct — which the §3 guardrail requires.

**Verified implementation fact (2026-06-28):** `via` is a **plain TypeScript union on the `openKBDomain` parameter, NOT a database enum.** The only DB enum in play is `TerritoryType` (`schema.ts:190`). Therefore:
- Adding `via: 'expansion'` is a **TS-only union change** — **no Drizzle migration** is needed for the `via` value itself.
- The mapping line `params.via === 'authorship' ? 'declared' : 'demonstrated'` (`open-domain.ts:15`) currently sends any non-`authorship` via to `'demonstrated'`. The B-prompt MUST update this so `'expansion'` also maps to `'declared'` (e.g. `via === 'authorship' || via === 'expansion'`), or the expanded area would wrongly land as demonstrated.

*Why:* The guardrail says expansion must record *what expanded into what*; a distinct provenance value is the cleanest way to make that legible and later measurable.

**Ratified sub-question — recording the source area:** record the source area (Pride) on the new (Moral Philosophy) provenance trail. A `masteryEvents` row is the established mechanism (cf. `sourceType: 'declared_promoted'` written by `promoteDeclaredToDemonstrated` at `open-domain.ts:145-160`); the B-prompt should write an analogous `expansion` event carrying the source `canonicalSubcategory` in its metadata. A dedicated `expandedFrom` column is **not** required for launch — the event row satisfies the honest-provenance guardrail and the recap copy ("expanded *from Pride*").

---

### Decision E — What happens to the original area? → **RATIFIED: E1**

After Pride → Moral Philosophy:

- **✅ E1 (RATIFIED).** Pride stays as its own (now-graduated) area; Moral Philosophy opens *alongside* it. Player keeps the proven Pride mastery and gains a new declared frontier. (Additive — fits "no denominators, no loss" canon.)
- **E2.** Pride *folds into* Moral Philosophy (the old area is absorbed). Cleaner map, but destroys proven territory and is exactly the silent-fold the reconciler forbids — rejected.

*Why:* Expansion is purely additive. The player never loses ground they proved; they gain new ground to prove. This keeps the feature on the right side of canon.

---

## 5. Ratified configuration

> **A3 + B2 + C1 + D2 + E1.**
> One graduation per game, for the thinnest area touched this game. Candidates from a curated map (virtues/vices first) with constrained (one-level-up) LLM fallback, 3 max. Inline chooser in the recap that collapses to a confirmation pill. Written via a new `via: 'expansion'` provenance (TS-only union addition) as `declared` territory, recording the source area in a `masteryEvents` row. The original area is kept; the broader area opens alongside it.

This is the smallest version that delivers the "congratulations, you've expanded this into X, Y, Z" moment, stays additive, and doesn't reintroduce the silent-fold bug.

---

## 6. Explicitly out of scope for this D / its B-prompt

- Touching the **biweekly ceremony** (`BiweeklyCeremony` / `CeremonyPin`) — separate surface (S3).
- Turning on the **narrow-KB guard** in production (`NARROW_KB_GUARD_ENABLED`) — expansion *reads* the same thinness threshold but does not flip that flag; that's its own retrieval-flip decision.
- **Spaced-repetition / Version-B** mechanics — unrelated.
- Any change to how thin areas are **backfilled mid-game** — that defensive behavior stays as-is.

---

## 7. Done-when (for the eventual B-prompt to satisfy)

Recorded here so the build inherits testable gates, not prose:

- A thin area touched in a completed game produces exactly one expansion offer in the recap (grep-checkable: recap view includes an `expansion` beat only when eligible).
- Choosing a target writes a `playerMastery` row with `territoryType = 'declared'` and the chosen `canonicalSubcategory`, via `via: 'expansion'`.
- The source area's row is **unchanged** (E1) — verified by a before/after on the Pride row.
- A failed expansion write shows **no** "you expanded" confirmation (fail-toward-player) — verified at the hook level, not just the route.
- The new area appears as **declared (not demonstrated)** on the knowledge portrait until a correct answer lands in it.
- No raw hex, no new color-only signal, no streak/competition register in any expansion copy.

---

## 8. Ratification record

| ID | Question | Ratified |
|---|---|---|
| A | When is expansion offered? | **A3** — one graduation, thinnest area touched this game |
| B | How are candidates generated? | **B2** — curated map (virtues/vices first) + constrained LLM fallback, 3 max |
| C | Where does the chooser live? | **C1** — inline in recap, collapses to confirmation pill |
| D | Provenance value for the write | **D2** — new `via: 'expansion'` (TS-only union, no migration), records source area |
| E | What happens to the original area? | **E1** — kept; broader area opens alongside (additive) |

Ratified 2026-06-28. **Next artifact: `B-AREA-EXPANSION-01`** — see §9 below for the amendments that govern it.

---

## 9. Ratification addendum (2026-06-28) — prior art reconciliation (R1–R4 + surface)

Authoring `B-AREA-EXPANSION-01` triggered a code read that found a **complete expansion-offer feature already shipping**, which §2 did not account for:

- **Card:** `ExpandDomainOfferCard` — rendered **inline inside the daily-summary page** (`src/app/daily/summary/page.tsx:220`), *not* a separate page. The standalone-looking view is the dev preview only (`/daily/summary/expand-preview`).
- **Builder:** `buildExpansionOffer()` (`src/server/db/queries/daily-summary.ts:366`) → `suggestAdjacentDomains()` proposes **lateral/sibling** candidates (Haiku).
- **Write:** `POST /api/daily/expand-domains` → **`addDeclaredInterest`**, whose chokepoint `upsertDeclaredInterestRow` (`src/server/db/queries/users.ts:171`) already writes **both** the `declaredInterests` row (enters rotation) **and** a `playerMastery` row with `territoryType: 'declared'` (`users.ts:214`).
- **Stamp:** `markDomainExpansionOffered` / `expansionOfferedAt` resolves the offer once per source domain.

This is a *different* feature sharing the name "expansion." Reconciled with Josh:

| ID | Question | Decision | Effect on §1–8 |
|---|---|---|---|
| **R1** | Candidate direction | **Broader** (parent). Pride → Moral Philosophy. Add a new `suggestBroaderDomains` next to `suggestAdjacentDomains`; curated virtues/vices→parent map first (B2), one-level-up Haiku fallback. | Confirms B2 direction. |
| **R3** | One feature or two | **Combine into ONE offer carrying both *wider* (existing siblings) and *broader* (new parent) candidates, surfaced on the existing daily-summary card.** | **Supersedes C1 and S3.** No `CompletedRecapHeader` chooser is built; the daily summary *is* the game-end recap that hosts this. |
| **R2** | Write target | **Both** — rotation row **and** declared portrait row. Achieved by **reusing `addDeclaredInterest`** (the mandated single chokepoint), which already writes both. | **Supersedes D2.** Do **not** add `via: 'expansion'` to `openKBDomain`; do **not** route the write through it (that bypasses the chokepoint and never enters rotation). |
| **R4** | Original area / overflow | **E1 stands (additive — keep Pride).** *Plus* the parent becomes the **overflow reservoir**: when Pride is exhausted mid-game, serve **Moral Philosophy** questions instead of unrelated backfill. **In scope for this build.** | **Supersedes §6's "backfill stays as-is."** Requires recording the Pride→Moral Philosophy link (a `masteryEvents` row, new `'expansion'` value in `masterySourceTypeEnum` — a real **migration**) and consuming it in the narrow-KB backfill / retrieval path. |

**Net supersessions:** C1, D2, S3, and §6 are replaced by the rows above. A3, B2 (direction), and E1 stand. Provenance honesty (the §3 guardrail) is now carried by the `masteryEvents` `'expansion'` record (R4), not by a `via` value (R2 dropped D2).
