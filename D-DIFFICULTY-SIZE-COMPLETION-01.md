# D-DIFFICULTY-SIZE-COMPLETION-01 — Size-bounded difficulty + completion

**Status:** 🟡 **RATIFIED IN CHAT** 2026-07-06 (Josh). Build in progress.
Reconciles the ratified `D-SUPPLY-FINITE-SET-01` (completion = trophy) with the
live per-domain difficulty ladder (`PRD-D-5`, `src/server/adaptive-difficulty.ts`)
and mastery-v2 depth sizing (`src/server/llm/domain-depth.ts`). Supersedes the
"always inject a harder stretch into every queue" framing (never canon; off the
finite-set direction). Does **not** adopt the un-ratified human-authored pivot
(`docs/thinking/CONCEPT-master-authored-canonical-sets.md`).

## Why (the trigger)

Two real friends played and it was **too easy + too short**:
- **Marcellus** (new adult; declared Star Wars/LOTR): served tourist-level trivia
  on domains he explicitly chose because he knows them. Root cause: a persisted
  per-domain difficulty row **fully overrides** the global adaptive level
  (`getDomainDifficultyOverrides`, `known.get(domain) ?? seed`), so demonstrated
  skill never reaches already-played domains — the *earned* climb is disconnected.
- **Buttkicker** (thin domain — Spy School — aces everything): difficulty can't
  climb (thin domain can't field harder → supply-recalibration claws it back), so
  he's stuck on easy forever with no escalation and no exit.

## The model (decided)

A topic is a **finite set sized by its real depth**. The player keeps playing,
**difficulty climbing as earned**, until they cover the sized set — that *is*
completion → **trophy → graduate + author**.

1. **Size = a depth-derived TARGET QUESTION COUNT.** Each topic's target number of
   distinct fan-salient questions comes from the LLM/Wikidata depth score (thin
   topic ≈ small set; deep topic ≈ large). Completion = distinct good questions
   answered ≥ target. (Chosen over the mastery-points threshold: a points target
   punishes thin domains that can't climb with a slow 10-pt-per-easy-Q grind.)
2. **Difficulty is a PARALLEL earned ladder**, not tied to the count. It climbs on
   demonstrated skill and must actually reach already-played domains (Phase 0).
   Deep topics (long runway) keep getting harder; thin topics reach their small
   size and graduate before the "stuck easy" feeling sets in.
3. **Good easy questions are kept — the mix is the point.** We never discard a
   quality easy question for being easy; we just don't mine a topic past its
   fan-salient size (`D-SUPPLY-FINITE-SET-01`: "stop mining past the core").
4. **Deep cuts stay opt-in.** No automatic arcane grinding; harder = *earned*,
   bounded by the topic's real size.

## Fandom / grounding posture

- **Now:** flip the **verifier** source allowlist to `wikipedia.org,fandom.com`
  (`VERIFY_WEB_SEARCH_ALLOWED_DOMAINS`) — cost-neutral, strengthens fact-checking
  of the deeper questions topics will surface as they climb. This is the documented
  first flip (`D-FANDOM-GROUNDING-01`).
- **Deferred:** generation-time wiki anchor (`GENERATION_WIKI_ANCHOR_ENABLED`) —
  only if we observe fabrication in deeper questions the verifier can't catch.
  Consistent with grounding being demoted to an anti-fabrication guard, not a
  primary supply lever.

## Build phases

- **Phase 0 — earned-difficulty reconnect** ✅ DONE (`adaptive-difficulty.ts`).
  `liftServedToGlobalSkill()` raises an already-played domain's requested tier up
  to the player's demonstrated global skill (max-only; suppressed on an incorrect
  streak in that domain). Wired into `getDomainDifficultyOverrides`. Unit-tested.
  No migration. NB: changes requested difficulty for every adaptive-mode user
  whose global level exceeds their per-domain rows — intended; review before deploy.
- **Phase 1 — size-based completion** ✅ DONE (sizing + re-key).
  - New `DomainDepthEstimate` cache (migration **0116**), keyed on `domain_key` so
    every played `canonical_subcategory` is sizable (the ~dozens of authored
    `KnowledgeNode`s don't cover them — the resolved integration gap). Caches the
    DEPTH score; the count is derived at read time.
  - `src/server/daily/domain-size.ts`: `depthToTargetCount` (`count = coeff·depth²`,
    env-tunable — `DOMAIN_SIZE_COUNT_COEFFICIENT` default 2, clamp [12, 200]) +
    `getTargetQuestionCountForDomains` (fold → cache → score-on-miss, fail-open).
  - `set-completion.ts`: `setSize` now = depth target (was durable pool depth).
    LLM sizing gated to candidates the player has answered ≥ min-target distinct in.
    Kill-switch `DEPTH_SIZED_COMPLETION_ENABLED=0` + fail-open to the old pool-depth.
- **Phase 1b — graduate-on-completion wiring** ✅ DONE. `markDomainExpansionEligible()`
  (`adaptive-difficulty.ts`) stamps `expansionEligibleSince` on a completed domain, so
  it flows through the EXISTING expansion funnel (getPendingExpansionDomains →
  selectExpansionSource → buildExpansionOffer → ExpandDomainOfferCard) — reusing the
  adjacency, card, accept/dismiss route, and once-per-area suppression with no UI
  change (`trigger` is telemetry-only, not in the card). `evaluateSetCompletions` now
  runs BEFORE `buildExpansionOffer` in the summary so the graduation card surfaces the
  SAME day as completion. Copy valence ("you mastered X → branch out" vs the generic
  "related areas") is a separate owed refinement (D-SUPPLY-FINITE-SET-01 §graduation).
- **Phase 2 — verifier allowlist flip** ✅ DONE 2026-07-08: shipped as the CODE
  DEFAULT (`verify-question.ts` — `wikipedia.org,fandom.com` when the env var is
  unset; `"*"` restores unrestricted), flipped together with the thin-declared
  verify gate default (`VERIFY_GATE_THIN_DECLARED_ENABLED`, now default ON).

## Notes
- **Sizing vs supply:** a target above what the topic can actually supply won't
  complete (player exhausts the material first). Mitigation: the coefficient tunes
  down with no re-seed, and completion fails open to pool-depth. Watch for topics
  that never complete → coefficient too high for supply.
- **To apply:** migration 0116 must be applied to prod (`npm run db:migrate` /
  Josh's usual path); the instrumentation guard also creates it defensively.
