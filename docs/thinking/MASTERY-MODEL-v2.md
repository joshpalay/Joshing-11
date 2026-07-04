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
