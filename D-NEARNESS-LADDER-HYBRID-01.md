# D-NEARNESS-LADDER-HYBRID-01 — Hybrid Near-ness Ladder for Supply & Expansion

**Status:** **SETTLED** (ratified 2026-07-01, config **A2 + B2 + C2 + D2 + E1** — see §10). §2 claims verified against the live repo (`joshpalay/Joshing-11`) on 2026-07-01. B and D were pressure-tested against live code before ratification (see §10). Authorizes the build; execution tracked in a `B-NEARNESS-LADDER-*` slate.
**Author:** Claude (with Josh)
**Relates to / builds on:** `D-AREA-EXPANSION-01` (SETTLED), `D-NARROW-KB-FABRICATION-01`, `D-SUPPLY-LADDER-UNIFY-01`, `CATEGORY-HIERARCHY-FINDINGS-01` (audit). Sibling of `B-SUPPLY-REFILL-*` (rung-1 grounded refill, PAUSED — see `B-SUPPLY-REFILL-EFFORT-REPORT.md`); this doc addresses the broaden-borrow + expansion rungs.
**Touches (live symbols):** `getExpansionParents` / `recordAreaExpansion` (`src/server/knowledge/open-domain.ts`), `selectOverflowParents` / `selectUngroundedExcludedDomains` / `narrowKbThinnessThreshold` (`src/server/daily/kb-exhaustion.ts`), the overflow wiring at `src/server/daily/generate-questions.ts:2247-2261`, `masteryEvents` (`src/server/db/schema.ts:520`, `sourceType='expansion'` enum value already present at `schema.ts:205`), the curated candidate map + constrained LLM fallback from `B-AREA-EXPANSION-01`.

---

## 1. The problem in plain language

A player deep in one narrow area — Zelda: Tears of the Kingdom — eventually runs the pool dry. When that happens the system needs two things:

1. **Supply:** keep the "always five" guarantee without fabricating fake TotK canon.
2. **Expansion:** at game-end, offer to graduate the tapped-out area into something broader.

Both need the same missing primitive: **an honest, cheap judgment of what is *near* TotK, and which of those near areas are *safe to serve this specific player*.** Breath of the Wild is a safe sibling; Ocarina of Time is a sibling the player may never have touched; the Zelda TV show is adjacent but maybe unknown; "all Nintendo games" is a broad grandparent. Today the system models none of this.

### What "near-ness" actually decomposes into

The word "ladder" bundles two things with very different cost and staleness profiles. This whole doc rests on separating them:

- **The rungs** — structural, universal facts. Breath of the Wild is TotK's *sibling*; Zelda is the *parent*; Nintendo the *grandparent*. True for every player. Stable (franchise structure doesn't shift month to month).
- **The safe/unsafe overlay** — which rungs are appropriate for *this* player, based on what they've demonstrated / declared / hold as territory. Entirely player-specific. This is the thing that makes a wrong answer feel like discovery, not a betrayal.

**The hybrid decision (ratified premise of this doc):** compute the **rungs globally** (one cached LLM call per domain, ever) and derive the **overlay per-player from data we already hold** (no LLM call). See §3 for why this beats per-player and per-domain-only.

---

## 2. What already exists (verified 2026-07-01 — so we don't rebuild it)

| Thing | Where | State |
|---|---|---|
| **Overflow wiring in the live supply path** | `generate-questions.ts:2247-2261` | Built. Already calls `getExpansionParents(userId, excluded)` → `selectOverflowParents(...)` and pushes routed parents into `domainsForLlm`. **This is the exact seam the hybrid plugs into — not a new pipeline.** Gated by `isAreaExpansionParentOverflowEnabled()` (off). |
| **`selectOverflowParents`** | `kb-exhaustion.ts:122-134` | Built, pure. Takes an `isHeldTerritory` predicate and an `isAlreadyServed` predicate; returns de-duped parents to route freed slots to. **The overlay filter already has a home here.** |
| **`getExpansionParents`** | `open-domain.ts:242-268` | Built. Reads `masteryEvents` where `sourceType='expansion'`, maps child→parent via `metadata.expandedFrom`. **Today its ONLY source is manual game-end graduations.** The hybrid gives it a second source (the cached tree). |
| **`recordAreaExpansion`** | `open-domain.ts:196-231` | Built. Writes a zero-point `masteryEvents` row on the target with `metadata:{expandedFrom}`. Idempotent via deterministic `answerId`. The edge-write mechanism the tree cache can reuse. |
| **`masteryEvents.sourceType='expansion'`** | `schema.ts:205` (enum) + `instrumentation.ts:161` (idempotent add) | Shipped. No migration needed to store edges of this kind. |
| **Shared thinness threshold** | `narrowKbThinnessThreshold()` → `getRetrievalConfig().poolDepthThreshold` (default 8) | Built. The one boundary supply, guard, and expansion all fire on. The tree must trigger on the **same** boundary so nothing drifts. |
| **Curated candidate map + constrained (one-level-up) LLM fallback** | `B-AREA-EXPANSION-01` (Decision B2) | Built for the *expansion chooser*. The hybrid **generalizes this into the tree cache** so supply and expansion read one source. |
| **Categorization models** | Categorize = **Sonnet** (`ANTHROPIC_MODEL`, `llm.ts:78`); reconcile/grade = **Haiku** (`RECONCILE_MODEL`, `GRADING_MODEL`) | The tree call should be **Haiku**, not Sonnet — near-ness ranking is a reconcile-class task, not a generate-class one. |

**Net-new work the hybrid requires (nothing below exists today):**
1. A **tree cache**: given a thin domain, produce ranked rungs (sibling / cousin / parent / grandparent), computed once globally and stored.
2. A **second source** for `getExpansionParents` (or a sibling reader) that returns the cached tree's rungs, not just manual-expansion edges.
3. A **rung-aware overlay**: `selectOverflowParents` borrows from the *nearest held/declared* rung; unheld near rungs become expansion *offers*, not silent borrows.

---

## 3. Why hybrid (the reasoning, recorded so the build inherits it)

- **Per-domain global alone** gives the rungs cheaply (1 call per domain, shared across all players, ~never stale) but **cannot do the overlay** — it knows Ocarina is a sibling, not that *you* never played it. Blind-borrow returns in a nicer outfit.
- **Per-player alone** gives the overlay but pays for the universal rungs 500× over, recurs as knowledge shifts (staleness triggers = more machinery), and is ~90% redundant (the rungs are identical across players).
- **Hybrid** splits along the natural seam: rungs global + cached (cheap, stable), overlay per-player from `playerMastery` / answer history / declared interests (free DB reads — *no LLM call*). `selectOverflowParents` already takes the `isHeldTerritory` predicate for exactly this. Most honest of the three because safety comes from the player's **actual record**, not a model's guess about them.
- **When hybrid would be wrong:** only if the *rungs themselves* should differ per player (for one person TotK's neighbor is "open-world design," for another "Nintendo franchises"). Product read: they shouldn't — rungs are structural; the personalization that matters is *safety*, and safety is free from data we hold. (If Josh wants framing-level personalization, this whole doc flips to per-player — flagged as the one exit condition.)

---

## 4. Mastery attribution — CLOSED, do not touch

The live code already does the honest thing and this doc must not disturb it. Verified in `CATEGORY-HIERARCHY-FINDINGS-01`:

- **No mastery roll-up exists.** Answering a Hamlet question credits only `(user, "Hamlet")` on `PLAYER_MASTERY`. Nothing propagates to "Shakespeare" or "Literature."
- **Parents are render-time string groupings, not scored buckets.** There is no "Nintendo mastery" tier to falsely earn. The "I only know Zelda but I'm Master of Nintendo" lie is **structurally impossible** today.
- **The merge job manually sums child points** precisely *because* no automatic roll-up exists.

**Guardrail for this build:** the near-ness tree is a **supply-and-offer** structure only. It MUST NOT introduce any roll-up, any parent scoring, or any credit propagation across rungs. A question answered after routing to a parent earns mastery in **that parent's own** `canonical_subcategory`, exactly as any other question does — never a synthetic credit to the child, never an up-propagation. (This is already how `openKBDomain`/`writeMasteryEvent` behave; the tree changes *which domains get served*, never *how points are attributed*.)

---

## 5. Decisions A–E — RATIFIED 2026-07-01

All five ratified at the §6 recommended defaults. B and D were pressure-tested against live code first (§10). Kept here for the rationale the build inherits.

### Decision A — Tree granularity of the rungs → **A2 (ratified)**
- A1. Two rungs only: nearest siblings + one parent. Minimal, matches the existing one-level-up discipline.
- **A2 (RATIFIED).** Four labeled rungs: sibling / cousin / parent / grandparent, each a small ranked list. Matches Josh's mental model; lets supply prefer the nearest held rung and lets expansion offer the most meaningful graduation. One call produces all four.
- A3. Unbounded LLM-proposed ladder. Rejected — least predictable, hardest to cache/verify.

### Decision B — Where the tree is stored → **B2 (ratified)**
- B1. Reuse `masteryEvents` (`sourceType='expansion'`) with a sentinel `userId`. **Rejected under pressure-test** (§10): `masteryEvents.userId` is a NOT-NULL FK (needs a fake user), and the table is filtered by `userId`+`sourceType` across ~12 surfaces → global rows are a pollution landmine.
- **B2 (RATIFIED).** A dedicated `domain_relations` table (child, related, rung, source `'curated'|'llm'`, createdAt). One migration; clean read model; `getExpansionParents` gains a second, clearly-scoped source; the `source`/`rung` columns serve the §4 honesty-provenance guardrail. Keeps the per-user `masteryEvents` ledger meaning only "*this player* expanded X→Y." **Note:** rows are keyed on `canonical_subcategory`, so `domain_relations` becomes an additional table the domain-merge routine must rewrite on a merge/rename.
- B3. In-memory / KV only. Rejected — recompute churn, no durable provenance.

### Decision C — Overlay data sources ("the player holds this rung") → **C2 (ratified)**
- C1. `playerMastery` territory only. Matches the current `selectOverflowParents` filter.
- **C2 (RATIFIED).** `playerMastery` **OR** a correct answer in the rung's domain in answer history **OR** an active declared interest. Broader "safe" set → fewer forced expansion prompts, more seamless supply; all free DB reads. Directly de-risks D2 (more near rungs count as held → seamless borrowing).
- C3. C2 plus a negative "dismissed → unsafe" signal. Deferred as a follow-up refinement (not blocking).

### Decision D — Unheld-rung boundary behavior → **D2 (ratified)**
- D1. Silent borrow anyway. Rejected — reintroduces "questions I can't engage."
- **D2 (RATIFIED).** Do NOT borrow from an unheld rung for *supply*; surface it as an **expansion offer** at the existing game-end chooser. Supply borrows only from **held** rungs (fail toward the player). Pressure-test (§10): this is the *minimal, consistent* extension — `selectOverflowParents` already filters to held territory; the tree just feeds more candidates into that same filter. **By-design property:** a genuinely-new-but-near area reaches the player only via the offer, and the chooser is one-per-game (matches A3) — the tree never *seamlessly* serves a brand-new area (the no-betrayal guarantee).
- D3. Borrow from an unheld rung flagged "exploratory." Rejected — bypasses the load-bearing held-filter and adds a per-question provenance state the product otherwise avoids.

### Decision E — Model & trigger for the global tree call → **E1 (ratified)**
- **E1 (RATIFIED).** Haiku (`claude-haiku-4-5-20251001`), fired **once per domain** on first thin-crossing (`narrowKbThinnessThreshold`), result cached durably (B2). Curated map checked first; LLM only on cache miss. Cheapest defensible: reconcile-class task on reconcile-class model, amortized across all players sharing the domain.
- E2. Sonnet. Rejected — 5× cost for marginal gain on a ranking task.
- E3. Precompute cron for popular domains. Deferred to a follow-up; launch lazy/on-demand.

---

## 6. Ratified configuration

> **A2 + B2 + C2 + D2 + E1 — RATIFIED 2026-07-01.**
> Four labeled rungs per domain, stored in a dedicated `domain_relations` table, computed once globally by a lazy Haiku call (curated-map-first) on the shared thinness boundary. Overlay is a free per-player filter over territory ∪ answer history ∪ declared interests. Supply borrows only from **held** rungs via the existing `selectOverflowParents` seam; unheld near rungs become opt-in expansion offers at game-end. No mastery roll-up, ever.

This is the smallest version that: kills blind borrowing, unifies supply + expansion on one cached source, drops the per-graduation expansion LLM call, and keeps mastery attribution untouched and honest.

---

## 7. Cost effect (why this is a net reduction)

- **Removes** the separate expansion-chooser LLM call (chooser reads the cache).
- **Removes** repeated per-question near-ness guessing; the tree is one Haiku call per *domain*, amortized across every player who shares it.
- **Adjacent free win (from `CATEGORY-HIERARCHY-FINDINGS-01`, incidental #2):** the user-authored question path (`POST /api/questions`) categorizes *blind* — no reconcile. Running `reconcileProposedDomain` there too (no schema change) cuts duplicate sibling domains, which *reduces* how often areas go artificially thin. Worth folding into the same B-prompt or a sibling one.
- **Net:** fewer calls, cheaper model, one cached structure feeding three surfaces.

---

## 8. Explicitly out of scope

- Turning on `NARROW_KB_GUARD_ENABLED` in prod — separate retrieval-flip decision; the tree *reads* the same threshold but doesn't flip that flag.
- Any change to **mastery attribution / roll-up** (§4 — closed).
- The biweekly ceremony surface.
- Framing-level per-player rungs (the §3 exit condition).
- Precompute cron (E3) and the dismissed→unsafe overlay signal (C3) — deferred.

---

## 9. Done-when (for the `B-NEARNESS-LADDER-*` build to satisfy)

- A domain crossing the thinness boundary triggers **at most one** Haiku tree call, and only on cache miss (grep-checkable: call site guarded by a cache lookup + curated-map check).
- The tree call is **Haiku**, not Sonnet (grep the model constant at the call site).
- `getExpansionParents` (or its sibling reader) returns rungs from the global tree **and** the player's manual-expansion edges, correctly merged.
- `selectOverflowParents` borrows for **supply** only from rungs the overlay marks **held** (C2 set); an unheld near rung never enters `domainsForLlm` via this path.
- An unheld near rung surfaces as an **expansion offer** at game-end (reusing the B-AREA-EXPANSION chooser), not a silent borrow.
- **No** new roll-up: a `PLAYER_MASTERY` before/after diff around a parent-routed answer shows credit on the parent's own row only — no child credit, no grandparent propagation.
- A failed tree call **fails open**: supply falls back to today's behavior, no error surfaced to the player (mirrors the existing `try/catch` at `generate-questions.ts:2262`).
- No raw hex, no color-only signal, no streak/competition register in any new copy.
- `domain_relations` is added to the domain-merge routine's rewrite scope (B2 note) so rungs follow a merge.

---

## 10. Ratification record

| ID | Question | Options | Ratified |
|---|---|---|---|
| A | Tree rung granularity | A1 / **A2** / A3 | ✅ A2 |
| B | Tree storage | B1 / **B2** / B3 | ✅ B2 (pressure-tested vs live code) |
| C | Overlay data sources | C1 / **C2** / C3 | ✅ C2 |
| D | Unheld-rung boundary behavior | D1 / **D2** / D3 | ✅ D2 (pressure-tested vs live code) |
| E | Model & trigger | **E1** / E2 / E3 | ✅ E1 |

**Pressure-test (2026-07-01, before ratification):**
- **B → B2 confirmed.** `masteryEvents.userId` is a NOT-NULL FK (`schema.ts:520`) so B1 needs a fake sentinel user; the table is filtered by `userId`+`sourceType` across ~12 surfaces (answer-history, ceremony beats, daily mastery, archive, common-ground…), and `getExpansionParents` reads exactly `userId=X AND sourceType='expansion'` — global rows would pollute all of it. B2's migration cost is trivial in this repo. New note captured: `domain_relations` becomes an added merge-rewrite table.
- **D → D2 confirmed.** `selectOverflowParents` (`generate-questions.ts:2248`) already filters to held territory, so D2 is the minimal, consistent extension; D3 would bypass that load-bearing filter and add a per-question provenance state. D2's friction is mitigated by C2 (broader "held" set). By-design: brand-new-but-near areas reach the player only via the one-per-game offer.
