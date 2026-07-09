# B-MASTERY-FINEST-NODE-01 · P1 — Write-path finest-node resolution from `subject_entity`

> **STATUS: DEFERRED (2026-07-08).** A prod measurement (see the D-doc
> "Measurement addendum") found this change would re-file only **~16 of 954**
> rows: `subject_entity` is character-level ("the Fool") while `KnowledgeNode` is
> work-level ("King Lear"), so only ~4% of subjects match any node. **Do not
> build as specced.** The real prerequisite is a **work-level "which work" signal**
> (an added field or a `subject_entity`→work resolver), not this plumbing. The
> spec below is retained as the write-path design for when that signal exists.

> Execution prompt (implementation log, not product spec). Product rationale:
> [`D-MASTERY-FINEST-NODE-01.md`](../../D-MASTERY-FINEST-NODE-01.md). This is **P1
> only** — the write-path change that stops *new* rows from mis-filing. It does
> NOT backfill history (P2), flip `KNOWLEDGE_MASTERY_V2` (P3), or size parent
> sets over the subtree (P4). Do not scope-creep into those.

## Goal

At question-write time, file each generated question under its **finest** authored
`KnowledgeNode` — using the already-emitted `subject_entity` — when that finer
node is genuinely **contained** by the subscription domain. A "Shakespearean
Tragedies" subscription that mints a King Lear question should file it under
`King Lear` (if that node exists and is a substantive descendant of Shakespearean
Tragedies), not under the coarse subscription label.

Fully flag-gated and fail-open: with the new flag off, or an empty/faulting
graph, behavior is **byte-identical to today**.

## Current behavior (grounded — read before changing)

- `src/server/daily/generate-questions.ts:1904`
  ```ts
  const taggedDomain = await resolveFinestNode(canonicalDomain);
  ```
  `canonicalDomain` is the reconciled subscription/generation label (e.g.
  `"Shakespearean Tragedies"`). The row is then inserted with
  `canonicalSubcategory: taggedDomain` (`:1915`), `domainKey: domainKey(taggedDomain)`
  (`:1917`), and — separately — `subjectEntity: question.subject_entity` (`:1925`).
  **`subject_entity` is stored but never consulted for filing.**
- `src/server/knowledge/graph.ts:100` — `resolveFinestNode(label, deps)`:
  folds `domainKey(label)` and returns the node's label if a node exists, else the
  input. Gated by `isKnowledgeGraphTaggingEnabled()` (`KNOWLEDGE_GRAPH_TAGGING`,
  **off by default** → today this is a pass-through: `taggedDomain === canonicalDomain`).
  `deps.lookup` is injectable for pure tests.
- `subject_entity` is emitted per question by the generator (`generate-questions.ts:247`,
  schema field `generatedQuestions.subjectEntity` `schema.ts:712`), normalized via
  `normalizeSubjectEntity` (`:662`). Coarser than `fact_key`, names the specific
  work/person/character.
- Graph edges + labels are available via `getClusterContext()` (already used by
  `src/server/db/queries/retrieval-demand.ts`), and `substantiveDescendants(nodeKey, edges)`
  (`graph.ts:148`) walks the containment subtree (cycle/diamond-safe).

## The change

### 1. Extend `resolveFinestNode` (graph.ts)

New optional inputs: the candidate `subjectEntity`, plus an injectable graph
`context` (nodes + edges) for the containment check. New env flag
`FINEST_NODE_FROM_SUBJECT` (default **off**) gates the subject refinement layer
*on top of* the existing label fold.

Resolution order (fail-open at every step — any miss/fault returns the base):

1. If `!isKnowledgeGraphTaggingEnabled()` → return `label` unchanged (today's guard, untouched).
2. `base` = node for `domainKey(label)`; `baseLabel = base?.label ?? label`. (This is today's result.)
3. If `FINEST_NODE_FROM_SUBJECT` is **off**, or `subjectEntity` is empty, or there is **no** `base` node → return `baseLabel`.
4. `subjNode` = node for `domainKey(subjectEntity)`. If none → return `baseLabel`.
5. If `subjNode.key === base.key` → return `baseLabel` (no change).
6. **Containment guard:** only refine when `subjNode.key ∈ substantiveDescendants(base.key, edges)`. If so → return `subjNode.label`. Otherwise → return `baseLabel`.

The containment guard is the safety property: it prevents filing a Tragedies
question under an unrelated same-named node, or under a *coarser* ancestor. We
only ever move **strictly downward within the subscription's own subtree.**

Proposed signature (keep the old call shape working):
```ts
export async function resolveFinestNode(
  label: string,
  deps: {
    subjectEntity?: string | null;
    lookup?: (key: string) => Promise<KnowledgeNodeRow | null>;
    context?: () => Promise<ClusterContext>; // defaults to getClusterContext
  } = {},
): Promise<string>
```
Load `context` (for `edges`) **only** when steps 1–4 have already passed and a
refinement is actually possible — don't pay the graph read on the flag-off /
no-subject / no-base path.

### 2. Update the call site (generate-questions.ts:1904)
```ts
const taggedDomain = await resolveFinestNode(canonicalDomain, {
  subjectEntity: question.subject_entity,
});
```
Nothing else at the call site changes — `canonicalSubcategory` / `domainKey` /
`subjectEntity` inserts stay as-is (`subjectEntity` is still stored raw for the
cooldown gate; the finest-node fold only affects the filing label).

## Non-goals / guardrails

- **No schema change.** `subjectEntity` and the node tables already exist.
- **No backfill.** Existing rows are untouched (that's P2 via `recomputeMastery`).
  Respect `D-KNOWLEDGE-TAXONOMY-MODEL-01` §6 "no retroactive re-sort" — this is
  new-writes-only, same as the existing tagging pass.
- **No mastery behavior change.** `KNOWLEDGE_MASTERY_V2` stays off; this only
  changes where a row is *filed*, which is what P3 will later credit.
- **Flag-off / empty-graph / fault = byte-identical to today.** This is a hard
  acceptance criterion, not a nicety.
- **Bespoke-parent case is out of scope.** When `label` has no `base` node but
  `subject_entity` does resolve to one, P1 deliberately does **not** refile (step
  3 returns `baseLabel`). Whether to adopt the subject node as a fresh finest home
  is an open knob in the D-doc — leave it for a later phase.
- **Other call sites (there are THREE — the signature change must stay
  backward-compatible so the untouched two keep today's behavior):**
  1. `src/server/daily/generate-questions.ts:1904` — **primary daily generation.**
     Has `question.subject_entity`. **Thread it here — this is the P1 change.**
  2. `src/server/daily/retrieval-grounded.ts:256` — the grounded-refill path
     (**paused**, `RETRIEVAL_GROUNDING_ENABLED` off). If the grounded record `q`
     carries `subject_entity`, thread it for consistency; if not readily present,
     leave as base behavior and note as follow-up. Low priority (path is dark).
  3. `src/server/db/queries/questions.ts:569` — authored / crafter-keep / house
     writes to the **`questions`** table. `params` has **no `subject_entity`**
     (human-authored rows generally lack one). **Out of P1 scope** — leave the
     one-arg call as-is; the optional-param signature keeps it byte-identical.
  Because `subjectEntity` is an *optional* dep, sites 2–3 compile and behave
  exactly as today with no edit.

## Tests (pure unit — `src/server/knowledge/__tests__/graph.test.ts`)

Use the injectable `lookup` + `context` deps (no DB). Fixtures on the existing
Renaissance/Shakespeare edge sets:

1. **Refines into subtree:** label `"Shakespearean Tragedies"` (has node),
   `subjectEntity "King Lear"` (node, substantive descendant) → returns `"King Lear"`.
2. **Subject not a node:** `subjectEntity "the Fool"` → returns base label.
3. **Subject not contained:** subject node exists but is NOT a descendant of base
   (e.g. an unrelated node, or an ancestor) → returns base label.
4. **Subject == base:** → returns base label.
5. **Flag `FINEST_NODE_FROM_SUBJECT` off:** any subject → returns base label
   (today's behavior).
6. **`KNOWLEDGE_GRAPH_TAGGING` off:** → returns input label unchanged (subject ignored).
7. **No base node (bespoke label) + subject IS a node:** → returns input label (P1 no-op).
8. **Graph context faults / empty edges:** → returns base label (fail-open; assert no throw).
9. **Diamond/cycle safety:** relies on `substantiveDescendants` guards — one fixture with a diamond to prove no infinite loop and correct containment.

## Acceptance criteria

- With both flags on and an authored `King Lear ⊂ Shakespearean Tragedies` edge,
  a freshly generated Lear question under a Tragedies subscription is inserted
  with `canonicalSubcategory = "King Lear"` and `domainKey = domainKey("King Lear")`.
- With `FINEST_NODE_FROM_SUBJECT` off (or `KNOWLEDGE_GRAPH_TAGGING` off, or no edge
  authored), the same generation produces the **exact** row it produces today.
- No new DB reads on the flag-off / no-subject / no-base path.
- `npx tsc -p tsconfig.typecheck.json` clean; `npm run lint` clean; new unit tests pass.
- `.env.example` documents `FINEST_NODE_FROM_SUBJECT` (default off) next to
  `KNOWLEDGE_GRAPH_TAGGING`.

## Verification

- Unit tests above (primary — the logic is pure and fully coverable without DB).
- Manual: with an authored edge in dev, generate for a parent domain and confirm
  the row's `canonicalSubcategory` folds to the child while `subjectEntity` is
  preserved. Flip `FINEST_NODE_FROM_SUBJECT` off and confirm the fold reverts.
- Confirm the three known call sites (above) still compile with the new optional
  dep and that sites 2–3 are byte-identical (no `subjectEntity` passed). The
  existing `resolveFinestNode` unit tests (`graph.test.ts:117+`) must still pass
  unchanged — they exercise the one-arg form.
