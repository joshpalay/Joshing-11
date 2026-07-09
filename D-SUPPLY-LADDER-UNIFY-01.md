# D-SUPPLY-LADDER-UNIFY-01 — Decision Record

> **Banner update (2026-07-08):** the finite-set reframe this banner gated on has
> LANDED — `D-SUPPLY-FINITE-SET-01` was **ratified 2026-07-01** (see that doc and
> `D-SUPPLY-FINITENESS-01`). The ladder's rungs stand; what the reframe changed is
> refill's *purpose* (one-time deepening toward a finite target, not perpetual
> top-up), which is exactly why flip 1 remains PAUSED pending its re-scope (§8).

**Status:** ✅ **RATIFIED** — **A2 + D2 + E2** (2026-07-08, Josh, adopting the
recommended defaults; recorded during the question/gameplay/cost health review).
**B2** and **C1** were already closed by live canon (see §5). Ratification settles
the *definitions* — it does **not** un-pause flip 1: `RETRIEVAL_GROUNDING_ENABLED`
stays off per `B-SUPPLY-REFILL-EFFORT-REPORT.md`, and the E2 staging clock starts
only when refill is resumed after its finite-set re-scope. Build prompts may now
be written in §8 order when that happens.
**Coordinates with (does NOT couple to):** `D-AREA-EXPANSION-01` (now **SETTLED + §9-amended + largely built**) and `D-QUESTION-QUALITY-AGENTS-01` / `B-QUESTION-QUALITY-AGENTS-01`. Shared seams only — see §4 and §7.
**Migration head at draft:** `0095_player_mastery_rotation_eligible` (live head; `ls drizzle/*.sql | sort | tail -1`). This doc's *flips* introduce no migration; the §4 `needs_review` seam and the §5-A refill-recovery signal may each require a small storage/derivation decision settled at build time (§8) — so "no migration" is no longer an unconditional promise.
**Source of truth:** live code, not this doc's paraphrase. Every build prompt that descends from this re-reads the named files and lets live code win on divergence.

---

## 0. Reconciliation note (live-code verification, 2026-06-30) — READ FIRST

An earlier draft of this doc was written against a snapshot in which `D-AREA-EXPANSION-01` was "drafted, not built" with **open** decisions A and E, and assumed the rung-5 expansion offer was unbuilt. **That snapshot is stale.** Verified against live code on this branch:

| Earlier-draft claim | Live reality (verified) | Where |
|---|---|---|
| `D-AREA-EXPANSION-01` decisions A/E are **open**; this doc "absorbs/supersedes" them | They are **RATIFIED (A3 + E1)** and **§9-amended** (2026-06-28); a build prompt exists (`B-AREA-EXPANSION-01.md`) | `D-AREA-EXPANSION-01.md` §4, §8, §9 |
| Rung-5 offer surfaces via `seasonHighlights[]` in `CompletedRecapHeader` (the old "C1") | **Superseded by §9 R3.** The shipped surface is `ExpandDomainOfferCard`, rendered inline on the daily-summary page; `CompletedRecapHeader.seasonHighlights` is **not** the expansion chooser | `src/app/daily/summary/page.tsx:220`, `ExpandDomainOfferCard.tsx`, `D-AREA-EXPANSION-01.md` §9 R3 |
| Rung-5 write goes through `openKBDomain()` | **Superseded by §9 R2.** The write goes through the `addDeclaredInterest` chokepoint (`upsertDeclaredInterestRow`), which writes both the rotation row **and** the `declared` portrait row. Routing via `openKBDomain` bypasses the chokepoint and never enters rotation | `src/server/db/queries/users.ts:171,214`, `src/app/api/daily/expand-domains/route.ts`, `D-AREA-EXPANSION-01.md` §9 R2 |
| Rung-5 trigger is unwired ("the only real build") | **Already wired.** `recalibrateDomainDifficultyToSupply` stamps `expansionEligibleSince` when a domain tops the difficulty ladder yet out-runs supply; `buildExpansionOffer` reads it; a funnel diagnostic exists | `src/server/adaptive-difficulty.ts:540-565`, `src/server/db/queries/daily-summary.ts:352,431`, `expansion-offer-diagnostic.ts` |
| Doc "introduces no migration"; the expansion enum is net-new | R4's migration already landed: `masterySourceTypeEnum` has `'expansion'`; `expansionEligibleSince`/`expansionOfferedAt` columns exist | `src/server/db/schema.ts:188,899-901`, `drizzle/0094_expansion_mastery_event_type.sql` |
| Effective-depth seam = "exclude `publicStatus = needs_review` and `deletedAt` from `getDurablePoolDepthForDomains`" | The helper counts **`generatedQuestions`**, which has `isDuplicate` but **no `publicStatus`/`deletedAt`** — those columns live on the canonical **`Question`** table, where the vet path writes `needs_review`. The seam spans a **table boundary** (§4) | `src/server/db/queries/retrieval-demand.ts:63`, `src/server/db/schema.ts:352,390,647-732`, `src/server/llm/vet-question.ts` |

**Net effect on this doc:** the two flips (refill, guard) and their ordering are unchanged and remain the heart of the work. What changed is rung 5: it is *not* a greenfield build. The supply ladder's contribution to rung 5 is narrow and additive — (i) teach the *exhaustion* signal that gates eligibility to honor refill-recovery (decision A), and (ii) decide the leaf's *refill-demand* fate on graduation (decision D) — both feeding the **already-shipped** eligibility column, offer surface, and write chokepoint. This doc no longer absorbs or supersedes `D-AREA-EXPANSION-01`'s A/E; it **aligns to them** (§7).

---

## 1. Problem statement

"There should ALWAYS be 5 questions" is held up today by the wrong things. When a narrow declared domain (the canonical case: *Spy School Books 1–6*) can't field five genuinely-good questions, the system currently papers over the gap by either (a) **fabricating** plausible-but-false canon — the audited "Academy of Evil" failure at a real pool depth of ~7 facts — or (b) **borrowing** from the player's other declared domains via the top-up broaden path, or, failing both, (c) silently **persisting a short queue** of 3–4 (anything at or above `DAILY_QUEUE_MIN_SIZE`).

Three pieces of machinery that should solve this exist but are misaligned:

- **Retrieval-grounded pool refill** (`RETRIEVAL_GROUNDING_ENABLED`, default **OFF** at `retrieval-config.ts:72`) — the only system that makes a thin domain *deeper* from corroborated sources. Scheduled (`/api/cron/pool-refill`, 09:00) but dark.
- **Narrow-KB exhaustion guard** (`NARROW_KB_GUARD_ENABLED`, default **OFF**, `kb-exhaustion.ts`) — stops fabrication. Its own comment warns that enabling it *without* refill just starves thin domains.
- **Area Expansion** (`D-AREA-EXPANSION-01`, **settled + largely built**) — graduates a genuinely-tapped domain into a broader player-chosen area. Its eligibility trigger is wired to a *difficulty-ceiling* signal today (§0); "exhausted" in the *content-supply* sense is still undefinable without refill establishing the real ceiling.

These are one problem viewed from three angles: **how many genuinely-good questions a narrow domain can yield per day, and what to do when that number is below five.** This doc unifies them into a single ordered ladder and a single staged rollout.

---

## 2. Settled choices (canon — not open for this ratification)

These follow directly from existing product canon and from the user decisions already taken in this thread; they are recorded here as the fixed frame the open decisions sit inside.

- **S1 — A short queue is never a silent terminal state.** It is either a refill backlog (rung 2 hasn't caught up — transient, acceptable) or a graduation signal (rung 5 — surface it). It is never "we quietly shipped four and said nothing."
- **S2 — The "always 5" guarantee is held up by grounded supply plus honest graduation — never by fabrication.** Fabricated canon that grades a real fan *wrong* is the product betrayal canon already forbids ("grading must fail toward the player").
- **S3 — The supplement order is fixed (the ladder, §3).** Grounded supply is always tried before borrowing; borrowing is always tried before graduating. Provenance stays honest at every rung.
- **S4 — Rung 4 (broaden-borrow) precedes rung 5 (expansion).** Per ratified user decision: when own-territory supply is short, borrow from the player's *other declared* domains first; only offer expansion if still short. Borrowing is the player's own territory, never silent, never machine-as-person.
- **S5 — Flip ordering is canon-bound, not preference: refill before guard, always.** The guard suppresses fabrication; refill fills the hole it opens. Guard-first or guard-with-refill reintroduces starvation.

---

## 3. The supply ladder (canon)

Every short build walks this ordered ladder. Each rung is provenance-honest; the last rung is graduation, not padding.

| Rung | Mechanism | Effect on a thin domain | Provenance |
|------|-----------|------------------------|------------|
| 1 | Authored + durable pool | Serves what genuinely exists | Human / vetted machine |
| 2 | **Grounded refill** (`RETRIEVAL_GROUNDING_ENABLED`) | Deepens the domain from ≥2-source corroborated material, off critical path | Machine, source-backed (`source_refs`) |
| 3 | **Guard on** (`NARROW_KB_GUARD_ENABLED`) | Stops fabrication; routes thin domains to grounded supply | n/a (suppresses fake canon) |
| 4 | **Honest broaden-borrow** (`DAILY_TOPUP_BROADEN_ENABLED`, already on) | Fills to five from the player's *other declared* domains | Player's own territory, labelled |
| 5 | **Graduation** (Area Expansion — *built*; see §0/§7) | Offers to grow the tapped domain into a broader player-chosen area, via the shipped `ExpandDomainOfferCard` on the daily-summary surface; accepted via the `addDeclaredInterest` chokepoint | Player-initiated, declared write |

**The reframe:** a domain is not "exhausted" until grounded refill (rung 2) cannot corroborate new material to deepen it. That — not a standalone pool-depth heuristic, and not solely the current "topped the difficulty ladder" signal — is the honest *content-supply* definition of exhausted, and the legitimate trigger condition this doc adds to rung 5 (decision A).

---

## 4. The shared seam with the quality-agents work (READ TWICE)

`B-QUESTION-QUALITY-AGENTS-01` is **subtractive** (demotes bad questions to `needs_review`); this ladder is **additive/routing**. They are a quality inspector and a producer — same factory, different stations. **They are coordinated, not coupled.** Do not merge the build efforts. The entire interface between them is one definition:

> **Effective pool depth = distinct live durable facts for a domain, EXCLUDING duplicates, soft-deleted rows, AND any row demoted to `needs_review`.**

**Live-code correction (the gap is bigger than a WHERE clause).** Today's depth metric — `getDurablePoolDepthForDomains` in `src/server/db/queries/retrieval-demand.ts:63` (and its demand-side twin `getThinActiveDomains`) — counts `count(distinct factKey)` over **`generatedQuestions`** where `isDuplicate = false` and `factKey is not null`. Two facts the earlier draft missed:

1. **The `generatedQuestions` pool table has no `publicStatus` or `deletedAt` column** (`schema.ts:647-732`). It carries `isDuplicate`/`suppressedBy` only.
2. **`needs_review` (`publicStatus`) and `deletedAt` live on the canonical `Question` table** (`schema.ts:352,390`), where the vet path writes them (`vet-question.ts`, `POST /api/questions`). The quality verifier demotes a **`Question`**, not a `generatedQuestions` pool row.

So "exclude `needs_review` from effective depth" **cannot be done by adding a predicate to the existing helper** — the column it would filter on is on a different table. The seam build must first settle *how a demotion on the canonical side lowers pool depth on the machine side*. Options to decide at build time (not in this doc):
- **(i)** Mirror the demote onto the corresponding `generatedQuestions` row (a pool-side `needs_review`/excluded flag the verifier also sets), then filter it in the helper; or
- **(ii)** Join `generatedQuestions → Question` on the promotion linkage and exclude demoted canonical rows; or
- **(iii)** If the quality verifier is (re)scoped to operate on the machine pool directly, add the demote-state column there.

Whichever is chosen, the invariant below holds on **one** shared effective-depth helper that both refill demand and the expansion-exhaustion read.

- The verifier *writes* the demote. That must **lower** effective depth.
- Refill demand and the expansion trigger *read* effective depth. A demotion correctly raising refill demand for that domain is the system working as intended.
- **Tripwire (belongs in both docs):** *Never count a demoted (`needs_review`) question as supply.* Both refill demand and expansion-exhaustion read the same effective-depth helper.

**Build interface:** the quality-agents Phase 1 carries a one-line pointer at the demote site. This ladder's refill-flip build owns landing the shared effective-depth definition (per the table-boundary resolution above), so both systems read one definition.

**Build correction — `B-SUPPLY-REFILL-FLIP-01` (2026-06-30): flip 1 changes the metric NOTHING, and here is why that is correct, not a punt.** The depth metric refill *and* the narrow-KB guard actually read (`getDurablePoolDepthForDomains` / `getThinActiveDomains`, `retrieval-demand.ts`) is **already correct** for its purpose:

1. It counts `count(distinct fact_key)` over `generatedQuestions` where `is_duplicate = false ∧ fact_key is not null`. `generatedQuestions` has **no `deletedAt`** — machine rows are flagged, never deleted (`schema.ts:710-713`, comment: *"Never deleted."*).
2. Every `suppressed_by` loser is a **strict subset** of `is_duplicate = true`: the only writer, `markPoolDuplicate` (`pool.ts:286-302`), sets `{ is_duplicate: true, suppressed_by: survivorId }` together. So the existing `is_duplicate = false` predicate already excludes every suppressed loser — **no not-live machine row is counted as supply.**
3. The §4 tripwire *"never count a demoted (`needs_review`) question as supply"* concerns **`Question`** rows. The refill metric counts **zero** `Question` rows (the machine pool has no `publicStatus`/`needs_review`), so the tripwire is **trivially satisfied and not actionable on this metric** — there is no predicate to add and nothing currently mis-counted.

What remains genuinely open — options (i)/(ii)/(iii) above, i.e. whether a human-side `needs_review` demote of a *promoted* machine fact should retroactively lower the machine pool's supply depth — is a **cross-pool accounting** question that does **not** block refill and is **explicitly out of scope for flip 1** (see this flip's DO-NOT: *no `questions.publicStatus` join on the `generatedQuestions` aggregate on the D-doc's say-so*). It is deferred to `B-SUPPLY-EXPANSION-EXHAUSTION-REFINE-01`, which owns the content-exhaustion definition. The §9 done-when *"a single effective-depth helper excludes `needs_review` across the boundary"* is therefore **not required for, and not delivered by, flip 1** — reframe it as a refinement-build obligation (or drop it if the two pools are deemed independent at that point). No filter change, no new test in this flip.

---

## 5. Open decisions (RATIFIED 2026-07-08 — A2 + D2 + E2)

Each carried a recommendation; Josh ratified the recommended defaults as a set on
2026-07-08. §6's bundle is now the settled configuration. **B and C were already
closed by live canon and are recorded here only for the trail** (see notes).

### A — How is "exhausted" defined for the rung-5 expansion trigger? *(RATIFIED: A2)*
*(Absorbs `D-AREA-EXPANSION-01` decision A's *content-supply* aspect; note A3 there already settled the **which-domain/when** of the offer — see §7. This decision concerns the **content-exhaustion gate**, which is additive to the existing difficulty-ceiling stamp.)*
- **A1 —** Effective depth below a fixed threshold (reuse `RETRIEVAL_POOL_DEPTH_THRESHOLD`, default 8). Simple, but a static number, not a true ceiling.
- **A2 — (recommended)** Effective depth below threshold **AND** the most recent refill run for that domain recovered **zero** new corroborated facts (refill has hit its honest ceiling). This is the §3 definition: exhausted = refill can't deepen it further. Requires refill (flip 1) live to be meaningful.
- **A3 —** Effective depth below threshold AND N consecutive short builds for that domain. Behavioural, but conflates "thin pool" with "thin yield today."

**Recommendation: A2.** It's the only option that makes content-exhaustion *earned* rather than *guessed*, and it's why the flips must precede the trigger refinement. **Live-code note:** today eligibility is stamped purely on `servedDifficulty === 'specialist'` + out-running supply (`adaptive-difficulty.ts:540`). A2 is **additive** — the refinement makes the content-supply ceiling a (co-)condition, so a player who tops the ladder but whose domain *can still be deepened by refill* is not prematurely graduated. Requires deciding where the per-domain "last refill recovered N facts" signal is stored/read (§8).

### B — What ships at the moment a build can't reach 5 from own territory and refill is still backlogged? *(CLOSED by S4 + live broaden path)*
- **B1 —** Short queue of 3–4 (honest, never padded) — acceptable only as a transient refill backlog (S1).
- **B2 — (canon)** Broaden-borrow to 5 from other declared domains (rung 4, `DAILY_TOPUP_BROADEN_ENABLED`, already on); if *still* short, the expansion offer surfaces at game-end via the built path (rung 5). Matches S4 and the ratified user decision.
- **B3 —** Always offer expansion immediately rather than ship short — rejected (mid-session interstitial, off-brand; see C).

**Resolution: B2** — already canon (S4) and already the live behavior (broaden path on; expansion offer at game-end). No new ratification needed; listed for the trail. Note: B2 reaches rung 5 *mid-build* only if broaden also can't fill; otherwise expansion surfaces at game-end per `D-AREA-EXPANSION-01`'s settled "reward at game-end / daily-summary card" choice.

### C — Where does the rung-5 expansion offer surface? *(CLOSED by `D-AREA-EXPANSION-01` §9 R3)*
- **C1 (live canon) —** The **daily-summary** surface, via the shipped `ExpandDomainOfferCard` (`src/app/daily/summary/page.tsx:220`). `D-AREA-EXPANSION-01` §9 R3 explicitly settled "the daily summary *is* the game-end recap that hosts this; no `CompletedRecapHeader` chooser is built."
- ~~**C-alt —** `seasonHighlights[]` pill row in `CompletedRecapHeader`~~ — **struck.** The earlier draft's recommendation; superseded by R3. That pill row is not the expansion chooser.
- **C-reject —** Inline mid-session interstitial — rejected (interruptive "you failed to fill" read mid-play, off-brand).

**Resolution: C1 (daily-summary `ExpandDomainOfferCard`)** — settled in `D-AREA-EXPANSION-01`, not re-opened here. Recorded so this doc names the correct surface.

### D — What happens to the original leaf domain's **refill demand** after graduation? *(RATIFIED: D2 — this is a refill-budget decision, distinct from territory)*
*(`D-AREA-EXPANSION-01` E1 already settled the **territory** question: the leaf is **kept**, additive — proven territory is never confiscated. This decision is only about whether the leaf stays a **refill spend target**.)*
- **D1 —** Leaf stays an active refill target alongside the new broad area (both keep deepening).
- **D2 — (recommended)** Graduation **freezes refill demand** for the leaf; the broader declared area becomes the new refill target. Prevents tug-of-war and wasted spend re-deepening a domain the player has chosen to grow out of. **Consistent with `D-AREA-EXPANSION-01` §9 R4**, which makes the parent the *overflow reservoir* once the leaf is tapped — so retargeting refill to the parent is the same direction of travel.
- **D3 —** Leaf is retired entirely (no longer surfaces questions) — **rejected** (deletes proven territory; violates E1 and the cumulative-territory canon).

**Recommendation: D2.** Freezes the leaf's *refill demand* only; the leaf's *territory and existing pool* stay (E1). D1 wastes refill budget on a domain the player graduated from.

### E — Staging cadence for the two flips (+ the rung-5 refinement). *(RATIFIED: E2)*
- **E1 —** All flip together once refill is verified populating the pool.
- **E2 — (recommended)** Staged with soak between each: **Flip 1 refill → soak ≥1 week → Flip 2 guard → soak ≥1 week → Rung-5 exhaustion-trigger refinement (decision A) + leaf-refill freeze (decision D).**

**Recommendation: E2.** Each flip changes what "exhausted" means; the rung-5 refinement depends on that definition being stable. Staged keeps each rung's behaviour observable in isolation. (S5 already fixes refill-before-guard regardless of cadence.)

---

## 6. Bundled default configuration (RATIFIED as the set, 2026-07-08)

> **A2 + B2(canon) + C1(canon, daily-summary) + D2 + E2.**

In prose: rung-5 expansion is gated when effective depth is below threshold *and* refill has stopped recovering new facts (A2, additive to the existing difficulty-ceiling stamp); a short build broadens to five from the player's own domains and only then surfaces expansion (B2, already live); the offer surfaces at game-end via the **shipped daily-summary `ExpandDomainOfferCard`** and is accepted via `addDeclaredInterest` (C1, already built); graduation freezes the leaf's *refill demand* and retargets the broad area while keeping the leaf's proven territory (D2 + E1); the two flips roll out staged with soak periods, refill before guard, with the rung-5 refinement last (E2).

---

## 7. `D-AREA-EXPANSION-01` reconciliation (CORRECTED — alignment, not supersession)

The earlier draft proposed marking `D-AREA-EXPANSION-01` decisions A and E "superseded-by this doc." **That is withdrawn.** Per live state (§0): `D-AREA-EXPANSION-01` is SETTLED (A3 + B2 + E1, with §9 R1–R4 amending C/D and the write path) and largely built. This doc does **not** supersede it. The relationship is:

- **Its A3 (one graduation, thinnest area touched this game) stands.** This doc's decision **A** is *additive* — a content-exhaustion gate on the eligibility stamp, not a replacement for "which domain / when offered."
- **Its E1 (keep the leaf; additive) stands.** This doc's decision **D** governs only the leaf's *refill demand*, and lands on D2 specifically to stay consistent with §9 **R4** (parent = overflow reservoir).
- **Its R2 (write via `addDeclaredInterest`, not `openKBDomain`) and R3 (surface = daily-summary `ExpandDomainOfferCard`, not `CompletedRecapHeader`) are honored verbatim** by this doc's §3 rung 5, §5-C, §8, §9.
- **No edit to `D-AREA-EXPANSION-01.md` is required by this doc.** (A back-reference pointer from it to this doc is optional and non-substantive; left to the editor.)

Net: one trigger definition, one fate-of-leaf definition, no spec-vs-spec drift — achieved by *this* doc deferring to the settled one, not the reverse.

---

## 8. Build prompts that descend from this (write only after ratification)

Two flips plus one *refinement*, in flip order. Each independently mergeable; codebase working after each.

1. **`B-SUPPLY-REFILL-FLIP-01`** — Flip `RETRIEVAL_GROUNDING_ENABLED` on. Land the shared **effective-depth** definition that excludes `needs_review`/soft-deleted across the **table boundary** (§4 — pick mirror-flag vs join vs pool-side column, then update `getDurablePoolDepthForDomains`/`getThinActiveDomains` or a thin shared wrapper). Verify via dry-run report (`backlogRemaining`, `questionsPersisted`) that thin-active domains are deepening. **Confirm refill spend is visible in `llmUsageEvent` before soak** (intersects the open grading-telemetry question — flag if unconfirmed). Decide where the per-domain "last refill recovered N facts" signal is recorded if A2 is ratified (feeds prompt 3). Soak ≥1 week. *Mostly flip-plus-verification, not a feature build.*
   - ⛔ **BLOCKED by verification (2026-06-30) — premise was wrong.** See `B-SUPPLY-REFILL-FLIP-01-FINDINGS.md`. The flip is **not** "mostly a flag flip": §4 is already correct (no metric change), the **gates are healthy** (57% of completions persist; only correct corroboration drops), but the refill is **sequential** and **65% of domains time out at the 120s per-call limit**, so a 300s cron drains only ~2–3 domains and the slow domains never deepen. Telemetry note: **web-search spend is not in `LlmUsageEvent`** (token-only ledger). Do **not** flip until throughput is fixed.
   - **`B-SUPPLY-REFILL-THROUGHPUT-01` (built + merged: PRs #1337 concurrency, #1341 adaptive timeout-exclusion / migration 0098, #1342 incremental health-record fix).** Bounded-concurrency worker pool + skip chronically-timing-out domains.
   - ⏸️ **PAUSED (2026-07-01) — refill needs an async re-architecture, not a flip. See `B-SUPPLY-REFILL-EFFORT-REPORT.md`.** The prod flip was attempted and reverted: **0 persists / 8 timeouts / 504**. Root-cause diagnostics proved neither web search nor concurrency is the bottleneck, and **per-call latency is not config-tunable** — the same grounded call swings ~25s → >220s within an hour (temporal variance in Anthropic's agentic web-search), so any synchronous per-call timeout is regularly blown. **The only structural fix is to move refill to the async Batch API** (no 300s ceiling), gated on confirming `web_search` runs inside a Batch. At 18-user scale the ROI is low → **paused with the path documented**; grounding stays `false`. Higher-leverage supply work at this scale is the **domain-fragmentation** fix (independent of refill).
2. **`B-SUPPLY-GUARD-FLIP-01`** — Flip `NARROW_KB_GUARD_ENABLED` on, **only after** flip 1 demonstrably populates the pool. Hard ordering tripwire (S5) lives in this prompt's DO-NOT block. Soak ≥1 week.
3. **`B-SUPPLY-EXPANSION-EXHAUSTION-REFINE-01`** — *Refinement, not a greenfield build* (surface/write/trigger already exist — §0). Add the ratified content-exhaustion condition (decision A) to the eligibility stamp in `recalibrateDomainDifficultyToSupply` (read effective depth + refill-recovery signal), so a domain still deepenable by refill is not graduated on the difficulty ceiling alone; on accepted expansion, **freeze the leaf's refill demand** (decision D) so it drops out of `getThinActiveDomains`. Do **not** rebuild the offer surface or the write — they ship via `ExpandDomainOfferCard` / `addDeclaredInterest` (R2/R3). Last, because "exhausted" isn't content-definable until flips 1–2 settle.

---

## 9. Done-when (for the eventual build prompts, grep-checkable)

- A single effective-depth helper excludes `needs_review` and soft-deleted across the `generatedQuestions`/`Question` boundary; both refill demand and expansion-exhaustion read it.
- `RETRIEVAL_GROUNDING_ENABLED` on; dry-run report shows thin-active domains deepening; refill spend logged to `llmUsageEvent`.
- `NARROW_KB_GUARD_ENABLED` on only after refill verified; no thin-domain starvation in logs (no `generation_failed` spike attributable to guard).
- Expansion eligibility (`expansionEligibleSince`) is stamped only when the ratified content-exhaustion condition (A) holds in addition to the existing difficulty-ceiling signal; the offer renders in the shipped daily-summary `ExpandDomainOfferCard`; accepted expansion writes `declared` territory **via `addDeclaredInterest`** (not `openKBDomain`); graduated leaf's **refill demand** is frozen (drops from `getThinActiveDomains`) while its territory/pool are retained.
- No mid-session expansion interstitial. No `needs_review` row counted as supply anywhere.

---

## 10. DO-NOT (hard stops)

- DO NOT merge this with `B-QUESTION-QUALITY-AGENTS-01`. Coordinated via the §4 seam only.
- DO NOT flip the guard before, or in the same release as, refill (S5).
- DO NOT count `needs_review` or soft-deleted questions as effective supply depth — and DO NOT assume that's a one-table WHERE clause; the demote-state lives on `Question`, the depth metric counts `generatedQuestions` (§4).
- DO NOT rebuild the expansion offer surface or write path. Surface = daily-summary `ExpandDomainOfferCard` (R3); write = `addDeclaredInterest` chokepoint (R2). Routing the write through `openKBDomain` bypasses rotation — forbidden.
- DO NOT mark `D-AREA-EXPANSION-01` decisions A/E as superseded — they are ratified canon; this doc aligns to them (§7).
- DO NOT let a short queue ship silently (S1) — it is a backlog or a graduation, and graduation must surface.
- DO NOT fabricate to reach five (S2). DO NOT render machine content as a person, or borrowed-domain questions as anything but the player's own declared territory.
- DO NOT retire or delete a graduated leaf's proven territory (territory is cumulative; E1). Freezing *refill demand* (D2) is not retiring territory.
- DO NOT add the content-exhaustion refinement (prompt 3) before flips 1–2 have soaked — content-"exhausted" is undefinable until then.
