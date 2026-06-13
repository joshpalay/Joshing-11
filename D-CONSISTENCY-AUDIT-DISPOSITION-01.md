# D-CONSISTENCY-AUDIT-DISPOSITION-01

**Subject:** Disposition of the “Joshing Design Consistency Audit and Polish Plan” (15-item generic consistency audit)
**Date:** 2026-06-13
**Status:** Reviewed and code-verified (2026-06-13) — 3 claims corrected. One real finding surfaced (#7, shadows). Audit still not converted to a backlog; see corrections below.

-----

## Why this doc exists

An external “design consistency audit” proposed a 15-item design-debt inventory, a sweeping design-token system, a component-unification program, and a 30-day polish plan. This document records the review so the audit does **not** quietly become a backlog.

**Bottom line:** Of 15 items, **zero are net-new actionable findings.** Two overlap work already tracked under the color/token system. The rest are either contradicted by canon, invented (describe surfaces Joshing doesn’t have), or generic checklist items with no Joshing-specific evidence.

**Provenance caveat:** The audit names none of the real drift surfaces (`DomainCircle.tsx`, `SharePortraitCard.tsx`, `knowledge/page.tsx`, `feed/visual.ts`), references “illustrations below” that aren’t present, and prescribes fixes that contradict load-bearing product decisions. It reads as a template audit run against a screenshot set or a description, not against live `globals.css` / the component tree. Specifics are therefore treated as unreliable unless corroborated by spec, prototype, or screenshot.

**Disposition legend:**

- **ALREADY-TRACKED** — a real signal, but already owned by an existing workstream; do not open a new track.
- **NOT-APPLICABLE (canon)** — contradicts a load-bearing product decision; acting on it would damage the product.
- **NOT-APPLICABLE (invented)** — describes a problem/surface that does not exist in Joshing.
- **NOT-APPLICABLE (generic)** — boilerplate checklist item with no Joshing-specific evidence.

-----

## Code-verification results (2026-06-13)

This doc was originally written without live-code access (see provenance caveat). A read-only verification pass (`B-AUDIT-DISPOSITION-VERIFY-01`) checked the four code-checkable claims. Three were wrong; corrections are folded into the table and notes below.

|Check            |Claim as written                                                                            |Code reality                                                                                                                                                                                                                                                                                                                      |Outcome                                         |
|-----------------|--------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------|
|Token baseline   |~90–110 hex literals in `feed/visual.ts`, `knowledge/*`, `app/knowledge/page.tsx`           |Path `src/feed/visual.ts` doesn’t exist (real path `src/components/feed/visual.ts`); corrected count is **62**. Named drift sources still hardcode hex (SharePortraitCard 19, DomainCircle 2, knowledge/page 2).                                                                                                                  |**Corrected** — baseline reset to 62, path fixed|
|Palette collision|`--game-wrong-strong` ≈ `--cat-literature`; `data-palette="proposed"` fix staged & dev-gated|**Palette already PROMOTED.** `--game-wrong-strong: #c1121f`, `--cat-literature: #7d2c3f` (bordeaux, “moved off the grading red”). No collision; no `[data-palette="proposed"]` selector remains.                                                                                                                                 |**Resolved** — collision fixed and shipped      |
|Navigation       |Single bottom nav: Home / Questions / Knowledge / **Account**; no drawers/top-tabs          |One bottom nav (`src/components/Nav.tsx`); no competing drawer/top-tab (`SendQuestionDrawer` is a feature panel, not nav). Bottom-nav items are Home / Questions / Knowledge / **Friends**; Account is in the top header.                                                                                                         |**Holds, label corrected**                      |
|Shadows          |Intentional flat `1px 1px 0` letterpress, consistent (#7)                                   |**Mixed.** Flat offsets exist (OverlapMap, ShareCard, KnowledgeOverviewClient, SharePortraitCard) but blurred drop shadows appear widely (ActivityStreamItem `0 4px 12px`, QuickAddQuestionModal `0 8px 32px`, GameplayChat `0 8px 20px`, KnowledgeCard, TerritorySetupClient, ceremony page). Nothing uses literally `1px 1px 0`.|**#7 reclassified — real finding**              |

**Consequence of the palette result:** the precondition for `B-VISUAL-LITERAL-TO-TOKEN-01` (“must run after palette promotion is merged”) is now **satisfied**. That gate is cleared.

-----

## Disposition table

|# |Audit item                           |Disposition                           |Reason                                                                                                                                                                                                                                                                                                                                                                                                      |
|--|-------------------------------------|--------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|1 |Inconsistent button styling          |**ALREADY-TRACKED** (partial)         |Prototype uses a consistent token system (`INK`, `RULE`, `FF`/`FM`). The “blue vs. green” complaint misreads a rule: blue is reserved for action CTAs only. The one real sub-point — hardcoded values vs. tokens — is already owned by `B-VISUAL-TOKEN-BUDGET-01`.                                                                                                                                          |
|2 |Duplicate card patterns              |**NOT-APPLICABLE (canon)**            |Blanket card unification steamrolls deferred-by-design choices. Card-tier work is already deferred to `B-VISUAL-CARD-TIERS-01` pending decisions; `LoadingScreen` / `OverlapMap` are intentional bespoke primitives.                                                                                                                                                                                        |
|3 |Inconsistent iconography             |**NOT-APPLICABLE (generic)**          |No Joshing surface, screenshot, or file cited. Standard template checklist item.                                                                                                                                                                                                                                                                                                                            |
|4 |Duplicate modals & bottom sheets     |**NOT-APPLICABLE (canon)**            |Same as #2 — a global overlay sweep overrides deferred card/primitive decisions. Real subset, if any, lives in the deferred card-tiers prompt.                                                                                                                                                                                                                                                              |
|5 |Multiple spacing systems             |**ALREADY-TRACKED**                   |Plausible low-grade drift; overlaps the hardcoded-literal problem already inventoried under the token-budget work. Fold in there, don’t open a separate track.                                                                                                                                                                                                                                              |
|6 |Varying corner radii                 |**ALREADY-TRACKED**                   |Same as #5 — same files re-literalize values; covered by token-budget inventory.                                                                                                                                                                                                                                                                                                                            |
|7 |Inconsistent elevation/shadows       |**REAL — LOW (per code verification)**|Originally marked NOT-APPLICABLE on the assumption of a uniform flat letterpress treatment. Live CSS disproves that: flat offsets (OverlapMap, ShareCard, etc.) coexist with widespread blurred drop shadows (`0 4px 12px`, `0 8px 32px`, `0 12px 28px`), and nothing uses `1px 1px 0`. Genuine shadow drift exists. **Needs a product decision before any prompt** — see open fork below.                  |
|8 |Non-standard typography hierarchy    |**NOT-APPLICABLE (generic)**          |Font tokens are defined (Montserrat body, Caveat handwriting-only; `FF`/`FM` in prototype). The “14px/1.2 vs 16px/1.5” complaint isn’t grounded in the actual system.                                                                                                                                                                                                                                       |
|9 |Mixed illustration styles            |**NOT-APPLICABLE (generic)**          |No specific screens cited. Boilerplate.                                                                                                                                                                                                                                                                                                                                                                     |
|10|Inconsistent form controls           |**NOT-APPLICABLE (generic)**          |No Joshing form surface cited. Boilerplate.                                                                                                                                                                                                                                                                                                                                                                 |
|11|Multiple progress-indicator styles   |**NOT-APPLICABLE (generic)**          |Progress is already a unified system (`GeometricProgress`, Daily Five dots). Claimed inconsistency unevidenced.                                                                                                                                                                                                                                                                                             |
|12|Duplicate tag/chip/badge components  |**NOT-APPLICABLE (generic)**          |No specific instances cited. Boilerplate.                                                                                                                                                                                                                                                                                                                                                                   |
|13|Uneven navigation patterns           |**NOT-APPLICABLE (invented)**         |Confirmed in code (`src/components/Nav.tsx`): one consistent bottom nav, no competing drawer/top-tab (`SendQuestionDrawer` is a send-a-question feature panel, not navigation). The “side drawers vs. top tabs” inconsistency described does not exist. *(Label correction: bottom-nav items are Home / Questions / Knowledge / Friends; Account lives in the top header — not the four originally listed.)*|
|14|Different animation language         |**NOT-APPLICABLE (generic)**          |No specific interactions cited. Boilerplate.                                                                                                                                                                                                                                                                                                                                                                |
|15|Knowledge-visualisation inconsistency|**NOT-APPLICABLE (canon)**            |The thesis-violating move. Category colors (Literature `#c0392b`, etc.) are identity signals, not a palette to normalize. “Unified palette” would collapse the knowledge-portrait. Actively harmful.                                                                                                                                                                                                        |

-----

## Summary counts (post-verification)

- **Net-new actionable findings:** 1 → **#7 (shadow/elevation drift)**, surfaced by code verification; was wrongly dismissed pre-verification
- **Already-tracked (no new track):** 3 sub-signals → #1 (token sub-point), #5, #6 — all inside `B-VISUAL-TOKEN-BUDGET-01` (baseline now 62, not ~90–110)
- **Resolved/shipped since audit:** the palette collision underlying #15 is fixed and promoted
- **Not-applicable (canon):** #2, #4, #15
- **Not-applicable (invented):** #13
- **Not-applicable (generic):** #3, #8, #9, #10, #11, #12, #14

-----

## The one legitimate signal — and why it’s already handled

The only real thread in the audit is *hardcoded values that should be tokens*. This was discovered independently and is tracked more precisely than the audit states:

- Off-system ratchet baseline: **62** hex literals (verified 2026-06-13) across `src/components/feed/visual.ts`, `src/components/knowledge/*`, `src/app/knowledge/page.tsx`. *(The original “~90–110” figure and the `src/feed/visual.ts` path were both wrong — that path does not exist.)*
- Build prompt `B-VISUAL-TOKEN-BUDGET-01` (inventory-first approach) already written to address it
- Three known drift sources already named: `SharePortraitCard.tsx` (OG canvas can’t read CSS vars), `DomainCircle.tsx`, `app/knowledge/page.tsx`

No part of this audit improves on that. The audit’s broader token-system proposal also directly conflicts with the standing rule: **no new design tokens without an explicit decision.**

-----

## Recommendation

Do **not** convert this audit into tickets. Mark it reviewed-and-closed via this doc. If real visual-consistency work is wanted beyond the token budget, the correct input is a pass against live `globals.css` and the component tree that names actual surfaces — not this document.

## Canon guardrails this audit tripped (for the record)

- Category colors are identity signals; never normalize them into a unified palette (#15). *(The specific collision that motivated this has since been resolved — see verification block.)*
- Blue is reserved for action CTAs only; entity names render in INK bold without color (#1).
- No new design tokens without explicit decision (the audit’s entire token-system thesis).
- Copy before pixels; bespoke primitives (`LoadingScreen`, `OverlapMap`) and card tiers are deferred by decision, not awaiting a sweep (#2, #4).

*(Removed: the prior “flat letterpress shadow treatment is intentional, not drift” guardrail — code verification disproved it. Shadows are mixed; see #7.)*

-----

## Open fork — #7 shadow/elevation (needs decision before any prompt)

Code verification turned #7 into a real low-severity finding. Before writing any build prompt, one product/visual decision is required (governed by “no new tokens without an explicit decision,” not copy-before-pixels):

- **Option A — Uniform flat letterpress.** The flat `Npx Npx 0` offset is the intended system everywhere; the blurred drop shadows (modals, ceremony, activity items, knowledge cards) are drift to be removed/converted. Heavier change; touches many surfaces.
- **Option B — Two intentional registers.** Blurred shadows belong on specific elevated surfaces (modals, ceremony, transient overlays) by design; flat offsets belong on inline/card surfaces. The fix is then only to define which register each surface uses and remove off-pattern outliers — not to flatten everything.

No prompt should be written until A or B is chosen. Either way the work is flag-gated and separate from the token-budget/literal-to-token sequence.
