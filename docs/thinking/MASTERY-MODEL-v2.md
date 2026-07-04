# Mastery Model v2 — depth-weighted, projection-based

**Status:** DESIGN (not built). Supersedes the shipped frozen-parent design in
`src/server/knowledge/parent-mastery.ts`. Everything here is still behind
`KNOWLEDGE_GRAPH_MASTERY` (off by default) — so this is a direction change made
*before* the model is live, which is the cheap time to make it. · **Date:**
2026-07-04 · Emerged from the taxonomy/mastery discussion; grounded in a read of
the live schema + a prod audit (0 collection edges).

## The problem this fixes

1. **Supply ≠ depth.** "King Lear — 40 Qs" measures how many questions we
   generated, not how much there is to know. So "answered most of the questions"
   conflates *mastered a big topic* with *exhausted a thin one*. A `master` badge
   currently means wildly different amounts of real knowledge across domains.
2. **Reclassification is destructive today.** Splitting "King Lear" out of
   "Shakespearean Tragedy" would strand or forcibly move a player's mastery
   (`applyCorpusRetarget` in `merge-domain.ts` moves points *by label*). If a
   player answered 30 of King Lear's 40 questions while they were tagged
   Tragedy, King Lear opens at 0 mastery with its supply already burned —
   unreachable.
3. **The freeze is on the wrong grain.** `parent-mastery.ts` freezes the
   *parent* terminally and lets the *leaf* float. That's backwards: a parent
   claim ("I know all of Shakespearean Tragedy") is a *breadth* claim that
   should move as the map grows; a leaf claim ("I know King Lear") is a
   demonstrated fact that should be permanent.

## The model (the decisions)

1. **Mastery is a projection, not a ledger.** `MASTERY_EVENTS`
   (`schema.ts:524-546`, append-only, keyed by `question_id`, carries
   `awarded_points`) is the immutable truth. `PLAYER_MASTERY` is a **rebuildable
   cache** of a pure function over `(a player's answer events × the current
   taxonomy)`. A taxonomy change triggers a **recompute**, never a destructive
   point-move. "Redo the classification of points" = re-tag questions' current
   home + recompute; nothing is relocated.

2. **Taxonomy is a single-parent containment tree.** Drop the
   `KnowledgeEdge.edge_type` distinction entirely (prod audit 2026-07-03: 84
   substantive, **0 collection** — free to collapse). Move toward **one home
   parent per leaf** so "a parent is the sum of its leaves" is well-defined
   (multi-parent double-counts a shared leaf). Cross-links for discovery, if ever
   needed, are a separate non-aggregating concept — not mastery edges.

3. **Leaf mastery is permanent; parent mastery is live coverage.** The
   deliberate inversion of today's design: freeze at the **leaf** grain (once you
   demonstrate King Lear, it's forever — never recomputed downward), compute the
   **parent** live (it can rise or fall as the map grows or a split reveals you
   only covered a slice). Honors "can't move mastery back" for the thing you
   actually demonstrated, and "Hamlet ≠ all of Tragedy" for the aggregate.

4. **Parent = 75% of the depth-weighted points.** A parent is mastered when the
   player has accumulated **≥ 75%** of the parent subtree's total
   depth-weighted available points — "most, not all, of its leaves," weighted so
   a big leaf counts more than a small one. Recommended formula:

   ```
   leafProgress(L)   = min(1, earnedPoints(player, L) / leafBar(L))
   parentProgress(P) = Σ_leaves( weight(L) · leafProgress(L) ) / Σ_leaves( weight(L) )
   parent mastered   ⇔ parentProgress(P) ≥ 0.75
   ```

   (Smooth version: partial progress in many leaves counts. The sub-knob is
   whether a leaf contributes its capped fraction, as above, or only 0/1 once
   *fully* leaf-mastered — recommend the smooth capped-fraction version.)

5. **Depth comes from an external, human-malleable proxy.** Seed each node's
   size from a depth signal — **section-count or a one-shot LLM depth score
   (Haiku), NOT raw article byte-length** (length tracks fandom, not depth:
   Pokémon > Kant). Store it in the **existing** `KnowledgeNode.masteryThreshold`
   column (`schema.ts:819,827` — already "human-set absolute bar, NULL → code
   default"); the seed just replaces the constant default and stays overridable.
   - Depth sets **weight everywhere** (leaf weight in its parent's coverage) —
     unconditional win, makes parent-coverage drops proportional and *fair*.
   - Depth influences the **leaf bar** but the bar is **capped by reachable
     supply** (`leafBar ≤ points the existing questions can actually award`), so
     a deep-but-thin domain never becomes unmasterable — the thin-niche trap.

## Immutable vs derived (the recompute story)

- **Immutable:** `MASTERY_EVENTS` — "player U answered question Q, state S, worth
  N points." Never rewritten by a taxonomy edit.
- **Derived / rebuildable:** each question's current home (its `domain_key`), the
  per-leaf and per-parent point totals, `PLAYER_MASTERY`, tiers.
- **Reclassify King Lear → :** re-tag the affected questions' `domain_key`
  (row-granular, by id) → recompute. King Lear's leaf picks up the 30 answers'
  credit; Tragedy's parent coverage re-derives honestly. No point-move, no lost
  history, fully reversible.

## Open knobs (tune later; do not block the write-up)

- Depth proxy: section-count vs LLM depth score — pick empirically.
- Leaf contribution to parent: smooth capped fraction (recommended) vs binary
  mastered.
- Parent weight: pure sum-of-children vs `max(intrinsic, sum)` when the parent
  itself has a depth signal.
- `leafBar` shape: exact function of `(depth, reachable supply)`.

## Refinements from the current-code map (2026-07-04)

Three parallel read-only investigations mapped the live system. Four things that
change the plan:

1. **The leaf bar is a NEW coupling.** Leaf tiers today are driven by a flat
   constant `TIER_THRESHOLD_POINTS` (establishing 0 / familiar 100 / solid 1000 /
   mastery 2000, `src/server/mastery/tiers.ts:4`). `KnowledgeNode.mastery_threshold`
   feeds ONLY the parent rollup, never leaves (Phase 0: **0/77 leaves** have a
   threshold set). So "depth sets the leaf bar" introduces depth into leaf math
   that does not exist today — a larger change than decision #5 implied.
2. **"Depth" is a taken word — use "weight"/"mass".** The admin tree's "N Qs" is
   `depthByKey`, a question COUNT. The v2 depth-weight is a different quantity;
   name it node **weight** to avoid the collision.
3. **Seed source is Wikidata child-count / LLM, NOT Wikipedia section-count.**
   `src/server/knowledge/wikidata.ts` explicitly forbids scraping Wikipedia's
   graph and already provides a wired breadth proxy —
   `getWikidataStructure(label).children.length` (P279 child count), cached, no
   new HTTP. Seed = **Wikidata child-count first, Haiku LLM depth score fallback**
   for non-Wikidata topics. (Revises decision #5's "section-count or LLM".)
4. **Dropping `edge_type` is low-risk in prod but has a UI tail.** Its one
   un-flagged live consumer is supply-depth rollup (`retrieval-demand.ts:168`),
   which already counts substantive-only — and prod has 0 collection edges, so
   collapsing changes no live behavior. BUT the collection-only surfaces
   (`collectCollections`, `collectionMembersCovered`, the coverage-strip UI) must
   be **deliberately removed**, not just filtered.

Storage note (revises decision #5): prefer a **dedicated `node_weight` column**
over overloading `mastery_threshold`, so v1 parent-bar semantics stay intact
during v1/v2 coexistence (additive nullable migration).

## Build plan (phased)

Each phase is independently mergeable; risk rises with phase number; every
irreversible step (migration, recompute, flag flip) is late and flag-gated.
Logic (P1–P3) is proven before schema/surfaces (P4–P5).

- **Phase 0 — Validation queries (no code). ✅ RAN 2026-07-04** (results below).
- **Phase 1 — Pure v2 math** (zero DB, unit-tested): `leafProgress =
  min(1, earned/leafBar)`, `parentCoverage = Σ(weight·leafProgress)/Σweight`,
  mastered ≥ 0.75, `leafBar = f(depth, reachableSupply)`. Tests mirror
  `parent-mastery.test.ts`. Wired to nothing.
- **Phase 2 — Node weight: storage + seeding** (behind flag, no live read
  change): add `node_weight` column (additive nullable migration); seed in
  `createKnowledgeNode` (`knowledge-graph.ts:134`) + backfill script (model on
  `backfill-domain-key.ts`); source Wikidata child-count → LLM fallback;
  human-editable via the admin "bar" field extended to weight.
- **Phase 3 — Recompute engine + reclassification writer** (script-first, behind
  flag): rebuild `PLAYER_MASTERY` from `MASTERY_EVENTS × current taxonomy` with
  the null-`question_id` fallback (re-bucket by the question's current domain
  where present, else the event's stored label); validate it reproduces today's
  aggregate before trusting. Then `reclassifyQuestionsByIds` (updates only the 3
  question columns, never per-user tables) + a `reclassify_questions` admin action
  off the `list_questions` panel.
- **Phase 4 — Drop `edge_type` / single-parent tree** (schema migration): remove
  edge-type branches (`graph.ts:124/152/202/316/353`,
  `knowledge-tree.ts:149/281/333`), deliberately remove collection-only UI, drop
  the column + update the `instrumentation.ts:376` boot guard. Decide
  single-parent enforcement here.
- **Phase 5 — Wire v2 into read surfaces** (behind `KNOWLEDGE_MASTERY_V2`, v1
  default): replace the inline parent calc (`knowledge-tree.ts:212`) with v2
  coverage; leaf progress uses the depth-capped bar; **invert the freeze** (freeze
  the leaf, compute the parent live); retire/repurpose `KnowledgeParentMastery`.
- **Phase 6 — Flip + backfill + validate**: backfill weights (P2), run recompute
  (P3), decide leaf-freeze grandfather backfill, flip flag preview→prod, verify no
  lost leaf mastery.

### Phase 0 results (prod, 2026-07-04)

- **Seeding is tiny.** 113 nodes: 26 parents (all have a threshold), **77 leaves
  (0 have one)**, 10 "both" (1 set). Node-weight seeding ≈ 113 Wikidata/LLM calls,
  ~86 starting from nothing — cheap, cacheable. Confirms refinement #1.
- **Recompute feasible; ~12.5% of events need the label fallback.** 1,345
  `MASTERY_EVENTS`: 1,177 (87.5%) carry a `question_id` → re-bucketable by current
  domain; 168 (12.5%) are null-`question_id` → fall back to the event's stored
  label (72 `domain_merged` bookkeeping, inherently label-only; 96 bot/
  personal-daily `live_correct`/`catchup_correct` with `questionId:null`). Small,
  clear rule.
- **Almost nobody is near mastery — migration blast radius is near-zero.** 212
  `PLAYER_MASTERY` rows: 138 establishing, 73 familiar, **1 solid, 0 mastery**
  (max 1,396, avg 101 vs the 1000/2000 bars). The P6 grandfather concern is nearly
  moot (no high-tier players to protect) — but v2 bars need calibrating for this
  scale or "mastery" stays unreachable.
- **Reclassification earns its keep, bounded.** Of 1,257 bank questions, **111
  (~8.8%)** are tagged at a node that IS a parent (has children) → candidates to
  push into a child. Real, not a backlog. (35 parent keys, 89 child keys across
  the 84 edges.)

Net: nothing in Phase 0 blocks the plan.

## Migration / supersession

- **Revises `parent-mastery.ts`.** The terminal parent-freeze ledger
  (`KnowledgeParentMastery`, `resolveParentMastery` at `parent-mastery.ts:72-94`,
  `litCorners ≥ 2`) is replaced by leaf-freeze + live parent coverage. The
  `KnowledgeParentMastery` table's role changes (or retires).
- **Flag.** All of this is gated by `KNOWLEDGE_GRAPH_MASTERY` (+
  `KNOWLEDGE_GRAPH_ENABLED`), currently off. Turning it on for a player who
  already leaf-mastered a domain that *becomes a parent* needs a decision: under
  this model leaves stay mastered (no backfill needed for leaves), but any
  parent badge is recomputed live — so no freeze-backfill is required, unlike the
  old design. Confirm before flipping.
- **Reclassification writer** is a *new*, row-granular path — NOT
  `applyCorpusRetarget` (which is by-label and consolidates per-user tables for a
  domain *dissolve*). See the merge-vs-reclassify distinction below.

## File anchors

- `MASTERY_EVENTS` — `src/server/db/schema.ts:524-546` (immutable log).
- `KnowledgeNode` (`masteryThreshold`, `domainKey`, `nodeKind`) —
  `schema.ts:819-833`.
- `KnowledgeEdge` (`edge_type` to be dropped) — `schema.ts:840-849`.
- Current frozen-parent design (superseded) — `src/server/knowledge/parent-mastery.ts`.
- Rollup / coverage primitives (`parentProgress`, `litCorners`, `rosterCoverage`,
  `substantiveDescendants`) + flags — `src/server/knowledge/graph.ts`.
- By-label corpus move (merge/rename; NOT the reclassify path) —
  `src/server/knowledge/merge-domain.ts` (`applyCorpusRetarget`,
  `retargetRenamedDomain`, `mergeDomainIntoTarget`).
- Domain-key folding — `src/lib/knowledge/domain-key.ts` (`domainKey()`).

## Related

- Edge-type collapse audit (0 collection edges, prod 2026-07-03) — this doc's
  decision 2 depends on it.
- `reaction-writepath-broken`, `domain-fragmentation-semantic` memories — adjacent
  taxonomy/data-integrity context.
</content>
</invoke>
