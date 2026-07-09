# D-MASTERY-FINEST-NODE-01 — Fact-at-finest-node accounting for contained hierarchies

**Status:** ✅ **RATIFIED** 2026-07-08 (Josh, in chat). Resolves the "does
selecting Shakespeare Tragedies get me King Lear questions / mastery?" question.
Depends on and completes `D-SUPPLY-FINITE-SET-01` (finite completable sets) —
this decision is what makes finite sets *coherent* under a containment
hierarchy. Consumes `D-KNOWLEDGE-TAXONOMY-MODEL-01` (substantive vs collection
edges). Cashes in the `KNOWLEDGE_MASTERY_V2` machinery (roll-up + recompute)
that has been built-but-dark.

## The forcing problem (why this decision is not actually optional)

For a **substantive** edge — one where *every* child fact is a valid parent fact
(Hamlet → Shakespeare Tragedies; total containment, per
`D-KNOWLEDGE-TAXONOMY-MODEL-01`) — the parent and child are **one underlying
fact space at two grains**, not two independent bodies of knowledge. The moment
you layer finite completable sets (`D-SUPPLY-FINITE-SET-01`) + cross-surface
fact-key dedup (`D-SUPPLY-NEVER-REPEAT-01`) on top of that, treating the parent
and child as **separate pools with separate ledgers becomes incoherent.**

**Worked example (Josh's, the motivating case):**
- King Lear is bounded at ~30 fan-salient facts.
- A player answers **12 Lear questions while subscribed to "Shakespearean
  Tragedies"** — filed as `canonical_subcategory = "Shakespearean Tragedies"`.
- Fact-key dedup is cross-surface, so those 12 Lear facts are now **burned** —
  never served again, anywhere.
- Under separate-pool accounting, those 12 credited the **Tragedies** node, not
  the **King Lear** node.
- The player now "enters King Lear." It opens at **0/30 with 40% of its supply
  already gone.** Maximum reachable coverage is **18/30 = 60%.** If
  completion/designation needs the set (or ~75% of it), **King Lear is literally
  un-masterable** — not hard, impossible.

This is the exact "stranded mastery / burned supply" failure the
`KNOWLEDGE_MASTERY_V2` inversion was designed to prevent ("if a player answered
30 of King Lear's 40 questions *while tagged as Tragedy*, King Lear would open at
0 mastery with its supply already burned"). Roll-up **alone does not fix it** —
roll-up flows child→parent (Lear credits Tragedies), never parent→child.

**Conclusion:** over a contained hierarchy with finite sets, the **fact — filed
at its finest node — is the only coherent unit of mastery.** The choice we
thought we had ("parent as its own pool" vs "parent as aggregator") is closed for
substantive edges. Independent pools survive **only** for *collection* edges
(e.g. Hamlet → Branagh's Films), where the child and parent genuinely do not
share a fact space.

## The decision

### 1. Account every question at its FINEST node; credit rolls up.
A question's mastery credit lands on the finest node it belongs to (the specific
play), and rolls up **at full value** to every substantive ancestor (the genre,
the author). A Lear fact credits King Lear **and** Shakespeare Tragedies,
regardless of which subscription the player reached it through. This is
`rollUpCredit` + `MASTERY_EVENTS`-by-`question_id` + `recomputeMastery`, flipped
on (`KNOWLEDGE_MASTERY_V2`).

### 2. Generate-at-parent, tag-at-finest (chosen mechanism — option **a**).
A "Shakespearean Tragedies" subscription **generates broad tragedy questions as
today** (the generator cannot write a tragedy question that isn't about a
specific tragedy), but each question is **filed to its finest node** rather than
to the coarse subscription label. We do **not** rebuild serving to draw down from
child pools (that was the rejected option **b**, serve-down). Serving stays
per-subscription; only the *filing/accounting* grain changes.

- **Why (a) over (b):** it's the smaller change (serving is untouched), it keeps
  the finite-set-per-domain boundary that `D-SUPPLY-FINITE-SET-01` and the
  finiteness state machine (`D-SUPPLY-FINITENESS-01`) depend on intact, and the
  finest-node signal it needs is **already captured on every row** (see below).
  (b)'s "parent set = literal union of child pools at serve time" muddies
  designation and the discrepancy alarm for no gain the accounting fix doesn't
  already deliver.

### 3. A parent's finite set is the union of its substantive descendants' sets.
"Complete Shakespeare Tragedies" means breadth across the plays, not a separate
Tragedies-only pool run to depth. The supply-depth counter already aggregates
over the substantive subtree (`getDurablePoolDepthForDomains` uses
`substantiveDescendants`); set-completion sizing must do the same for parent
nodes.

## What makes this cheap: the machinery already exists

- **The finest-grain signal is already on every row.** The generator emits
  `subject_entity` per question (`generate-questions.ts:247`) — a "Shakespearean
  Tragedies"-filed question **already records** `subject_entity: "King Lear"`.
  The "which play is this really about" data exists today; it is simply not yet
  wired into node resolution, mastery, or set-sizing.
- **Fact-centric accounting is built (dark).** `MASTERY_EVENTS` stores points
  immutably per `question_id`; `recomputeMastery` re-buckets each answer to its
  question's *current* finest node; `rollUpCredit` sends finest-node credit to
  every ancestor. All behind `KNOWLEDGE_MASTERY_V2` (off).
- **The supply side already walks the subtree.** `getDurablePoolDepthForDomains`
  counts distinct facts across `substantiveDescendants` — parent set-size =
  subtree union is half-wired.

The missing connective tissue is: (i) resolve each question's finest node from
`subject_entity` against the graph at write time (and a backfill pass for
existing rows), (ii) flip `KNOWLEDGE_MASTERY_V2` on, (iii) make parent
set-completion aggregate over the substantive subtree.

## Build implications (phased; each independently mergeable)

- **P1 — Finest-node resolution from `subject_entity` (write path).** At question
  write, resolve `subject_entity` → finest `KnowledgeNode` via the graph; store
  that as the accounting node (keep the subscription label for provenance/serving
  if needed). Falls back to today's behavior when `subject_entity` has no authored
  node (bespoke stays bespoke). Flag-gated, no mastery behavior change yet.
- **P2 — Backfill existing rows.** One-time reclassification of historical
  questions using `subject_entity` → finest node via `recomputeMastery`
  (already the engine for this). Immutable `MASTERY_EVENTS` means no points are
  created or destroyed — only regrouped. This is what un-strands the 12
  Lear-under-Tragedies answers.
- **P3 — Flip `KNOWLEDGE_MASTERY_V2` on.** Credit lands at the finest node and
  rolls up. Validate the King Lear worked example end-to-end: 12 Lear answers →
  King Lear reads 12/30, Tragedies gets the roll-up.
- **P4 — Parent set-completion over the subtree.** Set-completion / designation
  for a parent node aggregates distinct-answered across `substantiveDescendants`,
  reusing the graph-aware depth counter.

## Open knobs (tune later; do not block the build)

- `subject_entity` → finest-node matching: exact `domainKey` fold only, or fuzzy?
  What to do when `subject_entity` names an entity with no authored node yet
  (auto-create a leaf, or hold at parent until a node exists?).
- Whether a parent can *also* be directly masterable (breadth gate: the existing
  "≥2 corners lit" parent-mastery condition) vs. purely a roll-up of children.
- Provenance: do we keep the original subscription label on the row, or is the
  finest node the only stored home? (Affects "why did I get this question" UX.)
- Re-tag valence for `D-KNOWLEDGE-TAXONOMY-MODEL-01` §6 ("old questions do not
  retroactively re-sort") — P2's backfill is a *deliberate, one-time* exception,
  not a standing re-sort. Keep the standing rule.

## Interacts with

- `D-SUPPLY-FINITE-SET-01` — this is the accounting model that makes finite sets
  coherent under containment; without it, fine-grained sets are un-masterable
  once a coarser subscription has burned their supply.
- `D-KNOWLEDGE-TAXONOMY-MODEL-01` — supplies the substantive-vs-collection edge
  distinction that scopes where fact-at-finest-node applies (substantive only).
- `KNOWLEDGE_MASTERY_V2` (`rollUpCredit`, `recomputeMastery`,
  `MASTERY_EVENTS`-by-`question_id`) — this decision is the reason to turn it on.
- `D-SUPPLY-FINITENESS-01` — parent set-sizing must aggregate over the subtree
  without breaking the per-domain finiteness state machine / discrepancy alarm.
- Serving (`pickBankSource`, `daily.ts`) — **explicitly unchanged.** This is the
  point of choosing (a): serving stays flat/per-subscription; only accounting
  grain moves.

## Scale note

Like `D-SUPPLY-FINITE-SET-01`, this is **latent at ~6 weekly players** — few
players will have burned a fine set's supply through a coarse subscription yet.

## Measurement addendum (2026-07-08) — P1 is empirically near-inert; DEFERRED

Before scheduling P1 we measured the actual re-file population against prod. It
is tiny, and the reason reshapes the phasing:

- **Graph population:** 116 `KnowledgeNode`s (39 parents), 92 `KnowledgeEdge`s.
  (Also noted: the substantive/collection edge split was **dropped** — migration
  0110, prod had 0 collection edges — so *every* authored edge is depth-eligible
  today. The "collection edges keep independent pools" caveat is now
  hypothetical, not live.)
- **Filing is already mostly fine-grained.** Of 954 live `GeneratedQuestion`
  rows: **643 (67%) already filed at leaf nodes**, 164 (17%) at parent nodes, 147
  (15%) off-graph/bespoke (35 domains). The "coarse subscription burns a fine
  set" case barely occurs because subscriptions are already mostly fine.
- **The `subject_entity` signal doesn't align with the graph.** Of 840 rows with
  a `subject_entity`, only **33 (4%) match any authored node**, and only **16**
  (2 domains) would re-file. Root cause: `subject_entity` is
  character/entity-level ("the Fool", "Cordelia", "Peter Pettigrew"); nodes are
  work/period-level ("King Lear"). They almost never meet — so `subject_entity`
  cannot drive finest-node filing for ~96% of rows, and P1 wouldn't prevent much
  future drift either.

**Correction to the phasing:** P1 as written (`B-MASTERY-FINEST-NODE-01-P1.md`)
is **DEFERRED, not next-up** — it would touch ~16 rows. The decision above
stands as the correct model and a guardrail for when it matters. The genuine
prerequisite is a **work-level "which work" signal** (an added `work_entity`, or
resolving `subject_entity` → work via the graph/an LLM step) that sits between
the character-level `subject_entity` and the coarse subscription label — *that*
is what P1/P2 need to bite, not the write-path plumbing. Revisit when (a)
parent-level subscriptions grow and (b) that work-level signal exists.
