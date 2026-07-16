'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

import type { KnowledgeEdgeRow, KnowledgeNodeRow } from '@/server/db/queries/knowledge-graph';
import { AdminTabs } from '@/app/admin/AdminTabs';
import { InfoTerm } from '@/app/admin/InfoTerm';

// B-KNOWLEDGE-ADMIN-01 P1 — nodes, edges, thresholds, edge types. Internal ops
// idiom (AdminReportsClient precedent). Every commit here is a deliberate
// human act (D-doc §4); the collision path surfaces the existing node instead
// of minting a sibling — the whole model exists to kill that failure mode.


async function post(body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  body: { error?: string; existing?: { label: string } | null } | null;
}> {
  try {
    const res = await fetch('/api/admin/knowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}


// A corpus area with questions but no authored node — real territory that
// exists only as a raw label until it's added to the tree.
export type UnfiledArea = {
  domainKey: string;
  label: string;
  questions: number;
  points: number;
  genTotal: number;
  genDupes: number;
  exhausted: boolean;
};

// The supply lens for one area ("knowledge graph and domain supply should have
// the same information") — the same classification the supply table shows,
// rendered as a compact readout on every row here, linking to the full row.
export type SupplyReadout = {
  state: 'unsized' | 'filling' | 'raise_estimate' | 'soft_finite' | 'discrepancy';
  realized: number;
  estimatedQuestions: number | null;
  ratio: number | null;
  capped: boolean;
  /** Corpus-resolved size estimate + fandom host — the richness signals that tell
   * an exhausted leaf apart: a deep-corpus / fandom-backed topic that ran dry is a
   * generator failure (author/ground it), not a too-granular leaf (merge it up). */
  corpusEstimatedQuestions: number | null;
  fandomHost: string | null;
  /** Refill-observation signals (0118): whether the finite-set generation loop has
   * ever actually worked this domain — `hasEverYielded` = it once produced a
   * surviving fact, `consecutiveDryRounds` > 0 = it was offered and came back dry.
   * A RICH leaf with neither is UN-MINED, not exhausted (see the worklist filter). */
  hasEverYielded: boolean;
  consecutiveDryRounds: number;
};

// Same plain-speech vocabulary as the Supply view's STATE_LABEL — the two
// surfaces must speak the same words for the same states.
const SUPPLY_STATE_TEXT: Record<SupplyReadout['state'], string> = {
  discrepancy: '⚠ ran dry early',
  raise_estimate: 'estimate too low',
  filling: 'filling',
  soft_finite: 'likely complete',
  unsized: 'unsized',
};

function SupplyChip({ domainKeyValue, supply }: { domainKeyValue: string; supply?: SupplyReadout }) {
  if (!supply) return null;
  const tone =
    supply.capped || supply.state === 'discrepancy'
      ? 'var(--danger)'
      : supply.state === 'raise_estimate'
        ? 'var(--brand-navy)'
        : 'var(--text-muted)';
  const text = supply.capped
    ? `⛔ capped · ${supply.realized} made`
    : supply.estimatedQuestions != null
      ? `${SUPPLY_STATE_TEXT[supply.state]} · ${supply.realized}/${supply.estimatedQuestions}${
          supply.ratio != null ? ` (${Math.round(supply.ratio * 100)}%)` : ''
        }`
      : `unsized · ${supply.realized} made`;
  return (
    <a
      href={`/admin/supply#supply-${domainKeyValue}`}
      className="underline-offset-2 hover:underline"
      style={{ color: tone }}
      title="Generation supply for this exact area (made / estimated) — tap for its full Supply row: estimate basis, dry rounds, cap and re-estimate actions"
    >
      supply: {text} →
    </a>
  );
}

export function KnowledgeAdminClient({
  nodes,
  edges,
  depthByKey,
  pointsByKey,
  genStatsByKey,
  exhaustedByKey,
  unfiled,
  supplyByKey,
}: {
  nodes: KnowledgeNodeRow[];
  edges: KnowledgeEdgeRow[];
  depthByKey: Record<string, number>;
  pointsByKey: Record<string, number>;
  genStatsByKey: Record<string, { total: number; dupes: number }>;
  exhaustedByKey: Record<string, { self: boolean; descendants: number }>;
  unfiled: UnfiledArea[];
  supplyByKey: Record<string, SupplyReadout>;
}) {
  const router = useRouter();

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 pt-6 pb-24">
      <header className="mb-5">
        <div className="mb-3">
          <AdminTabs active="knowledge" />
        </div>
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">
          Territory tree
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          The subject structure you&apos;ve authored — every{' '}
          <InfoTerm term="territory">territory</InfoTerm>, its children, and its mastery target.
          Areas with questions but no territory yet wait in{' '}
          <InfoTerm term="unfiled">Unfiled areas</InfoTerm> below. Tap any underlined stat or flag
          for what it means. Nothing here touches questions or any player&apos;s mastery.
        </p>
      </header>

      <StructureSuggester graphIsEmpty={nodes.length === 0} onDone={() => router.refresh()} />

      <KnowledgeTreeEditor
        nodes={nodes}
        edges={edges}
        depthByKey={depthByKey}
        pointsByKey={pointsByKey}
        genStatsByKey={genStatsByKey}
        exhaustedByKey={exhaustedByKey}
        supplyByKey={supplyByKey}
        onDone={() => router.refresh()}
      />

      <UnfiledAreas unfiled={unfiled} supplyByKey={supplyByKey} onDone={() => router.refresh()} />

      {/* Only the two tools with NO tree equivalent live here: the orphan
          check (structural gaps at a glance) and the edge composer (typed
          COLLECTION edges — the tree only draws substantive ones). Everything
          else the old forms did — create, rename, re-parent, thresholds,
          proposals — happens in the tree above. */}
      <details className="mt-6">
        <summary className="text-muted-foreground cursor-pointer text-sm font-medium">
          Advanced: orphan check &amp; collection edges
        </summary>
        <div className="mt-3 space-y-4">
          <p className="text-muted-foreground text-xs">
            You rarely need this section. The orphan check lists structural gaps; the composer
            below draws <em>collection</em> edges (coverage-only groupings like “Bach’s Music” —
            the tree’s drag always draws <em>substantive</em> ones).
          </p>
          <OrphanCheck nodes={nodes} edges={edges} />
          <EdgeComposer nodes={nodes} onDone={() => router.refresh()} />
        </div>
      </details>
    </main>
  );
}

// ─── the tree editor ─────────────────────────────────────────────────────────
// The primary authoring surface (Josh, 2026-07-02: "a modified tree format
// where you can expand categories and drag things up and down"). Tap-first —
// Move/Copy put the editor in placement mode and every eligible node grows a
// "Place here" target (drag-and-drop is miserable on mobile Safari; this is
// three taps and works everywhere). Copy = the §7 multi-parent case: the node
// then lives under BOTH parents. Moving under a leaf promotes it to 'both'
// server-side (Beethoven becomes masterable AND a parent).

// 'merge' folds the picked territory INTO the destination (questions, mastery,
// history move; the source ceases to exist) — same-scope duplicates only.
type PickState = {
  mode: 'move' | 'copy' | 'merge';
  childKey: string;
  childLabel: string;
  fromParentKey: string | null;
} | null;

// The tree filter's derived sets: matched rows, the ancestors that must show
// (and force-expand) so a match is on screen, and every visible key (matches +
// their ancestors + their subtrees). null when no filter is active.
type FilterState = {
  visible: Set<string>;
  ancestors: Set<string>;
  matches: Set<string>;
} | null;

// A leaf under this many questions is "too small to stand alone" — the signal
// to condense it upward (Move it under a parent). Matches the exhaustion
// story: a thin leaf gets played out fast.
const THIN_LEAF_THRESHOLD = 6;

// Mastery-threshold heat scale (mastery v2, in POINTS): every node — leaf AND
// parent — carries a points threshold to master it (progress = points ÷
// threshold ≥ 75%). Color by magnitude so a curator can scan how big each
// territory is at a glance (small → large). Tokens follow the crafter admin's
// heat convention (success/gold/danger as a magnitude ramp on an internal ops
// surface), not grading semantics.
function thresholdColor(points: number): string {
  if (points <= 2000) return 'var(--success)'; // small
  if (points <= 8000) return 'var(--accent-gold)'; // moderate
  return 'var(--danger)'; // large
}

// "Hard to find questions" heat: the share of a domain's GENERATED questions that
// came back DUPLICATES. A high share means the generator keeps repeating itself —
// the topic's fresh facts are drying up, so new questions are hard to source (vs
// a domain like Shakespearean Tragedy where they still come easily). Only shown
// when there's a real sample AND it's actually hard (≥ 50%), so the tree
// highlights only the territories that need authoring attention.
const HARD_TO_SOURCE_MIN_SAMPLE = 10;
const HARD_TO_SOURCE_MIN_RATE = 0.5;
function dupRateColor(rate: number): string {
  return rate >= 0.65 ? 'var(--danger)' : 'var(--accent-gold)'; // ≥65% red; 50–65% gold
}

function KnowledgeTreeEditor({
  nodes,
  edges,
  depthByKey,
  pointsByKey,
  genStatsByKey,
  exhaustedByKey,
  supplyByKey,
  onDone,
}: {
  nodes: KnowledgeNodeRow[];
  edges: KnowledgeEdgeRow[];
  depthByKey: Record<string, number>;
  pointsByKey: Record<string, number>;
  genStatsByKey: Record<string, { total: number; dupes: number }>;
  exhaustedByKey: Record<string, { self: boolean; descendants: number }>;
  supplyByKey: Record<string, SupplyReadout>;
  onDone: () => void;
}) {
  const nodeByKey = useMemo(() => new Map(nodes.map((n) => [n.domainKey, n])), [nodes]);

  const { childrenByParent, parentCountByChild, parentsByChild, roots, descendantsOf } = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    const parentCountByChild = new Map<string, number>();
    // All parents per child — powers the "in N trees" jump list.
    const parentsByChild = new Map<string, string[]>();
    for (const edge of edges) {
      if (!nodeByKey.has(edge.childDomainKey) || !nodeByKey.has(edge.parentDomainKey)) continue;
      const list = childrenByParent.get(edge.parentDomainKey);
      if (list) list.push(edge.childDomainKey);
      else childrenByParent.set(edge.parentDomainKey, [edge.childDomainKey]);
      parentCountByChild.set(
        edge.childDomainKey,
        (parentCountByChild.get(edge.childDomainKey) ?? 0) + 1,
      );
      const parents = parentsByChild.get(edge.childDomainKey);
      if (parents) parents.push(edge.parentDomainKey);
      else parentsByChild.set(edge.childDomainKey, [edge.parentDomainKey]);
    }
    const byLabel = (a: string, b: string) =>
      (nodeByKey.get(a)?.label ?? a).localeCompare(nodeByKey.get(b)?.label ?? b);
    for (const list of childrenByParent.values()) list.sort(byLabel);

    const roots = nodes
      .map((n) => n.domainKey)
      .filter((key) => !parentCountByChild.has(key))
      .sort((a, b) => {
        // Territories with children first, then alphabetical — scannability.
        const aKids = childrenByParent.has(a) ? 0 : 1;
        const bKids = childrenByParent.has(b) ? 0 : 1;
        return aKids - bKids || byLabel(a, b);
      });

    const descendantsOf = (key: string): Set<string> => {
      const out = new Set<string>();
      const queue = [...(childrenByParent.get(key) ?? [])];
      while (queue.length > 0) {
        const next = queue.pop()!;
        if (out.has(next)) continue;
        out.add(next);
        queue.push(...(childrenByParent.get(next) ?? []));
      }
      return out;
    };

    for (const list of parentsByChild.values()) list.sort(byLabel);

    return { childrenByParent, parentCountByChild, parentsByChild, roots, descendantsOf };
  }, [nodes, edges, nodeByKey]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(roots.filter((key) => childrenByParent.has(key))),
  );
  const [picking, setPicking] = useState<PickState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTopLabel, setNewTopLabel] = useState('');

  // Free-text filter over the tree (128 territories is a lot to scroll). A row
  // is VISIBLE when its label matches, when it's an ANCESTOR of a match (so the
  // path down to it renders), or when it's a DESCENDANT of a match (so filtering
  // to "American History" shows that whole branch). Ancestors of a match are
  // force-expanded so every match lands on screen; a matched node keeps its own
  // expand toggle so its subtree stays collapsible.
  const [filter, setFilter] = useState('');
  const filterState = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return null;
    const matches = new Set<string>();
    for (const n of nodes) {
      if (n.label.toLowerCase().includes(query)) matches.add(n.domainKey);
    }
    const visible = new Set<string>();
    const ancestors = new Set<string>();
    for (const key of matches) {
      visible.add(key);
      for (const d of descendantsOf(key)) visible.add(d);
    }
    const queue = [...matches];
    while (queue.length > 0) {
      const next = queue.pop()!;
      for (const parent of parentsByChild.get(next) ?? []) {
        if (!ancestors.has(parent)) {
          ancestors.add(parent);
          visible.add(parent);
          queue.push(parent);
        }
      }
    }
    return { visible, ancestors, matches };
  }, [filter, nodes, descendantsOf, parentsByChild]);

  // Drag-and-drop state: what's being dragged (label for the overlay; key +
  // from-parent so every row can show whether it's a legal target), and the
  // pending drop awaiting the human's Move-vs-Also-list choice.
  const [drag, setDrag] = useState<{
    label: string;
    childKey: string;
    fromParentKey: string | null;
  } | null>(null);
  // The drop already happened when this is set — it drives the follow-up bar
  // (keep-under-old-too / undo). toParentKey null ⇒ the drop was an un-nest.
  const [pendingDrop, setPendingDrop] = useState<{
    childKey: string;
    childLabel: string;
    fromParentKey: string | null;
    toParentKey: string | null;
    toParentLabel: string;
  } | null>(null);
  // The one-way gate before a domain merge commits (questions/mastery move,
  // the source ceases to exist — there is no undo).
  const [confirmMerge, setConfirmMerge] = useState<{
    sourceKey: string;
    sourceLabel: string;
    targetKey: string;
    targetLabel: string;
  } | null>(null);
  // Dropping a child onto its OWN parent used to be a silent no-op; now it
  // offers the flip — "make Shakespeare the parent of Shakespearean Drama".
  const [pendingFlip, setPendingFlip] = useState<{
    childKey: string;
    childLabel: string;
    parentKey: string;
    parentLabel: string;
  } | null>(null);

  // A tap must still expand / open the ⋯ menu — only a real drag (>8px) grabs.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  // The browser fires a click on the handle when a drag releases over it —
  // without this guard every completed drag would ALSO enter pick-up mode.
  const lastDragEndAt = useRef(0);
  function pickUnlessJustDragged(pick: PickState) {
    if (Date.now() - lastDragEndAt.current < 300) return;
    setPicking(pick);
  }

  const pickedSubtree = useMemo(
    () => (picking ? descendantsOf(picking.childKey) : new Set<string>()),
    [picking, descendantsOf],
  );

  // The global burn-down queue: every leaf flagged ⛔ exhausted (self) anywhere
  // in the graph that ACTUALLY needs a decision — the actionable read of the
  // per-parent "⛔ N exhausted" counters. A leaf already holding enough to master
  // (avail ≥ its threshold) is dropped: generation being walled doesn't matter if
  // a player can already reach mastery from the existing supply, so there's no
  // decision to make. Leaves with no threshold set are kept (setting one is
  // itself a decision). Grouped by home parent so sibling exhaustions sit together.
  const exhaustedLeaves = useMemo(() => {
    const parentLabelOf = (k: string) => {
      const p = parentsByChild.get(k)?.[0];
      return p ? nodeByKey.get(p)?.label ?? p : '';
    };
    const labelOf = (k: string) => nodeByKey.get(k)?.label ?? k;
    const needsDecision = (k: string) => {
      const threshold = nodeByKey.get(k)?.masteryThreshold ?? null;
      if (threshold == null) return true; // no target set — deciding one is the work
      return (pointsByKey[k] ?? 0) < threshold; // still short of masterable
    };
    // A RICH leaf (fandom-backed / deep corpus) that the finite-set refill has
    // NEVER actually worked — never yielded a surviving fact AND never come back
    // dry — is UN-MINED, not exhausted. Its high dup rate is a shallow-sample
    // artifact: a fandom-backed topic estimated in the hundreds does not run dry
    // in ~15 tries, and most of those "failures" are self-containment formatting
    // demotions, not the topic running out. The fix is mechanical — set a target
    // and let refill mine the wiki — not a human shrink/merge/hand-author call, so
    // it does not belong in the decision queue. Gated on "never observed by refill"
    // rather than a gen-count so a rich topic the machine HAS hammered and still
    // can't yield (real generator failure) stays flagged as a genuine decision.
    const unminedRichLeaf = (k: string) => {
      const supply = supplyByKey[k];
      return (
        supply != null &&
        isRichTopic(supply) &&
        !supply.hasEverYielded &&
        supply.consecutiveDryRounds === 0
      );
    };
    return Object.keys(exhaustedByKey)
      .filter(
        (k) =>
          exhaustedByKey[k]?.self &&
          nodeByKey.has(k) &&
          needsDecision(k) &&
          !unminedRichLeaf(k),
      )
      .sort(
        (a, b) =>
          parentLabelOf(a).localeCompare(parentLabelOf(b)) || labelOf(a).localeCompare(labelOf(b)),
      );
  }, [exhaustedByKey, nodeByKey, parentsByChild, pointsByKey, supplyByKey]);

  // "Show all the places and I can go to any of them" — jump to a specific
  // instance of a multi-parent node: expand every ancestor path of the target
  // parent, scroll its row into view, and flash it.
  const [flashInstance, setFlashInstance] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  function jumpToInstance(childKey: string, parentKey: string | null) {
    // parentKey null ⇒ a top-level instance (the worklist can target roots); its
    // row id uses the 'root' sentinel and it has no ancestors to expand.
    const toExpand = new Set<string>(parentKey ? [parentKey] : []);
    const queue = parentKey ? [parentKey] : [];
    while (queue.length > 0) {
      const next = queue.pop()!;
      for (const grand of parentsByChild.get(next) ?? []) {
        if (!toExpand.has(grand)) {
          toExpand.add(grand);
          queue.push(grand);
        }
      }
    }
    setExpanded((prev) => new Set([...prev, ...toExpand]));
    const instanceId = `${parentKey ?? 'root'}::${childKey}`;
    setFlashInstance(instanceId);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashInstance(null), 2000);
    // Let the expansion render before scrolling to the (possibly new) row.
    window.setTimeout(() => {
      document
        .getElementById(`tree-row-${instanceId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }
  // While a drag is live, rows inside the dragged subtree (or the node itself)
  // are the only ILLEGAL targets — everything else lights up as a landing spot.
  const dragSubtree = useMemo(
    () => (drag ? descendantsOf(drag.childKey) : new Set<string>()),
    [drag, descendantsOf],
  );

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as
      | { label?: string; childKey?: string; fromParentKey?: string | null }
      | undefined;
    if (data?.childKey) {
      setPendingDrop(null); // a new drag supersedes the last drop's follow-up
      setPendingFlip(null);
      setDrag({
        label: data.label ?? data.childKey,
        childKey: data.childKey,
        fromParentKey: data.fromParentKey ?? null,
      });
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setDrag(null);
    lastDragEndAt.current = Date.now();
    const child = event.active.data.current as
      | { childKey: string; fromParentKey: string | null; label: string }
      | undefined;
    const over = event.over?.data.current as
      | { toParentKey: string | null; toParentLabel: string }
      | undefined;
    if (!child || over === undefined) return;

    // Root zone → un-nest to top level (remove the current home edge).
    if (over.toParentKey === null) {
      if (!child.fromParentKey) return; // already top-level
      setPendingDrop(null);
      void act({
        action: 'delete_edge',
        childDomainKey: child.childKey,
        parentDomainKey: child.fromParentKey,
      });
      setPendingDrop({
        childKey: child.childKey,
        childLabel: child.label,
        fromParentKey: child.fromParentKey,
        toParentKey: null,
        toParentLabel: 'top level',
      });
      return;
    }

    const toParentKey = over.toParentKey;
    if (toParentKey === child.childKey) return; // onto itself
    if (child.fromParentKey === toParentKey) {
      // Dropped onto its own parent — the one drop that can't mean "nest".
      // Offer the flip: the child becomes the parent's parent.
      setPendingFlip({
        childKey: child.childKey,
        childLabel: child.label,
        parentKey: toParentKey,
        parentLabel: nodeByKey.get(toParentKey)?.label ?? toParentKey,
      });
      return;
    }
    if (descendantsOf(child.childKey).has(toParentKey)) {
      setError('Can’t place a territory inside its own subtree.');
      return;
    }
    // The drop IS the move — no confirmation tap (drag Sonatas onto Beethoven
    // → it's a child, done). The follow-up bar offers "keep under the old
    // parent too" (the multi-parent case) and Undo.
    setError(null);
    setPendingDrop(null);
    void act({
      action: 'attach_child',
      childDomainKey: child.childKey,
      toParentDomainKey: toParentKey,
      ...(child.fromParentKey ? { moveFromParentDomainKey: child.fromParentKey } : {}),
    });
    setPendingDrop({
      childKey: child.childKey,
      childLabel: child.label,
      fromParentKey: child.fromParentKey,
      toParentKey,
      toParentLabel: over.toParentLabel,
    });
  }

  // Post-drop follow-ups. "Keep too" re-adds the old home edge — the node then
  // lives under BOTH parents (Beethoven's Symphony under Beethoven AND
  // Symphonic Works). "Undo" puts everything back.
  function keepUnderOldToo() {
    if (!pendingDrop?.fromParentKey) return;
    const drop = pendingDrop;
    setPendingDrop(null);
    void act({
      action: 'attach_child',
      childDomainKey: drop.childKey,
      toParentDomainKey: drop.fromParentKey,
    });
  }

  function undoDrop() {
    if (!pendingDrop) return;
    const drop = pendingDrop;
    setPendingDrop(null);
    if (drop.fromParentKey) {
      // Move it back home (removing the new edge if one was added).
      void act({
        action: 'attach_child',
        childDomainKey: drop.childKey,
        toParentDomainKey: drop.fromParentKey,
        ...(drop.toParentKey ? { moveFromParentDomainKey: drop.toParentKey } : {}),
      });
    } else if (drop.toParentKey) {
      // Was top-level; un-nest it again.
      void act({
        action: 'delete_edge',
        childDomainKey: drop.childKey,
        parentDomainKey: drop.toParentKey,
      });
    }
  }

  async function act(body: Record<string, unknown>, keepPicking = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await post(body);
    setBusy(false);
    if (!res.ok) {
      setError(
        res.body?.error === 'self_edge'
          ? "Can't place a territory inside its own subtree."
          : `That didn't save (${res.status}).`,
      );
      return;
    }
    if (!keepPicking) setPicking(null);
    onDone();
  }

  function placeInto(toParentKey: string) {
    if (!picking) return;
    if (picking.mode === 'move' && picking.fromParentKey === toParentKey) {
      // Placing onto its own parent → offer the flip instead of a no-op.
      setPendingFlip({
        childKey: picking.childKey,
        childLabel: picking.childLabel,
        parentKey: toParentKey,
        parentLabel: nodeByKey.get(toParentKey)?.label ?? toParentKey,
      });
      setPicking(null);
      return;
    }
    if (picking.mode === 'merge') {
      // Irreversible data merge — one explicit confirmation before commit.
      setConfirmMerge({
        sourceKey: picking.childKey,
        sourceLabel: picking.childLabel,
        targetKey: toParentKey,
        targetLabel: nodeByKey.get(toParentKey)?.label ?? toParentKey,
      });
      setPicking(null);
      return;
    }
    void act({
      action: 'attach_child',
      childDomainKey: picking.childKey,
      toParentDomainKey: toParentKey,
      ...(picking.mode === 'move' && picking.fromParentKey
        ? { moveFromParentDomainKey: picking.fromParentKey }
        : {}),
    });
  }

  function makeTopLevel() {
    if (!picking || !picking.fromParentKey) return;
    void act({
      action: 'delete_edge',
      childDomainKey: picking.childKey,
      parentDomainKey: picking.fromParentKey,
    });
  }

  async function addTopLevel() {
    const label = newTopLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    setError(null);
    const res = await post({ action: 'create_node', label, nodeKind: 'parent' });
    setBusy(false);
    if (!res.ok && res.status !== 409) {
      setError(`Couldn't create "${label}" (${res.status}).`);
      return;
    }
    setNewTopLabel('');
    onDone();
  }

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg font-semibold text-[var(--brand-ink)]">
          The tree ({nodes.length} territories)
        </h2>
        <div className="flex items-center gap-1.5">
          <input
            value={newTopLabel}
            onChange={(e) => setNewTopLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addTopLevel();
            }}
            placeholder="New top-level territory…"
            className="w-44 rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1.5 text-sm focus:border-[var(--brand-navy)]"
            aria-label="New top-level territory"
          />
          <button
            type="button"
            onClick={() => void addTopLevel()}
            disabled={busy || !newTopLabel.trim()}
            className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Filter the tree by name — narrows to matching territories plus their
          path and subtree, so a match deep in 128 rows is one type away. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilter('');
            }}
            placeholder="Filter territories…"
            className="w-full rounded-md border bg-[var(--brand-field)] py-1.5 pl-8 pr-8 text-sm focus:border-[var(--brand-navy)]"
            style={{ borderColor: 'var(--border)' }}
            aria-label="Filter territories by name"
          />
          <span
            className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm"
            aria-hidden
          >
            ⌕
          </span>
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter('')}
              aria-label="Clear filter"
              className="text-muted-foreground absolute inset-y-0 right-1.5 flex items-center px-1 text-base hover:text-[var(--brand-ink)]"
            >
              ✕
            </button>
          ) : null}
        </div>
        {filterState ? (
          <span className="text-muted-foreground text-xs" aria-live="polite">
            {filterState.matches.size === 0
              ? 'No matches'
              : `${filterState.matches.size} match${filterState.matches.size === 1 ? '' : 'es'}`}
          </span>
        ) : null}
      </div>

      {/* Drop-choice — the multi-parent moment: Move re-files; Also list keeps
          the old home AND adds the new one. Fixed to the bottom so it's in
          reach no matter where in a long tree the drop happened. */}
      {pendingDrop ? (
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-toast)] flex justify-center p-3">
          <div
            className="flex w-full max-w-lg flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-quiet shadow-[var(--shadow-overlay)]"
            style={{ background: 'var(--brand-card)', borderColor: 'var(--brand-navy)', color: 'var(--brand-ink-700)' }}
            aria-live="polite"
          >
            <span className="w-full sm:w-auto">
              <strong>{pendingDrop.childLabel}</strong> →{' '}
              <strong>{pendingDrop.toParentLabel}</strong> ✓
            </span>
            {pendingDrop.fromParentKey && pendingDrop.toParentKey ? (
              <button
                type="button"
                onClick={keepUnderOldToo}
                disabled={busy}
                className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-50"
                style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                title="It will live under both parents"
              >
                Keep under {nodeByKey.get(pendingDrop.fromParentKey)?.label ?? 'the old parent'} too
              </button>
            ) : null}
            <button
              type="button"
              onClick={undoDrop}
              disabled={busy}
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => setPendingDrop(null)}
              aria-label="Dismiss"
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium"
              style={{ borderColor: 'var(--border)' }}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}
      {confirmMerge ? (
        // Deliberately NOT the same quiet card as the move/flip/pick bars — a
        // merge is the one irreversible act here, and it must look like one.
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-toast)] flex justify-center p-3">
          <div
            className="flex w-full max-w-lg flex-wrap items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-quiet shadow-[var(--shadow-overlay)]"
            style={{ background: 'var(--destructive-surface, var(--brand-card))', borderColor: 'var(--danger)', color: 'var(--brand-ink)' }}
            aria-live="polite"
          >
            <span className="w-full">
              <strong style={{ color: 'var(--danger)' }}>⚠ Irreversible merge.</strong> Fold{' '}
              <strong>{confirmMerge.sourceLabel}</strong> into{' '}
              <strong>{confirmMerge.targetLabel}</strong>? Its questions, player progress, and
              history move over, and <strong>{confirmMerge.sourceLabel}</strong> ceases to exist.
              This cannot be undone.
            </span>
            <button
              type="button"
              onClick={() => {
                const m = confirmMerge;
                setConfirmMerge(null);
                void act({ action: 'merge_node', sourceDomainKey: m.sourceKey, targetDomainKey: m.targetKey });
              }}
              disabled={busy}
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--danger)', background: 'var(--danger)', color: 'var(--brand-cream-page)' }}
            >
              Merge — cannot be undone
            </button>
            <button
              type="button"
              onClick={() => setConfirmMerge(null)}
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium"
              style={{ borderColor: 'var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {/* The flip offer — a child dropped/placed onto its OWN parent. */}
      {pendingFlip ? (
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-toast)] flex justify-center p-3">
          <div
            className="flex w-full max-w-lg flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-quiet shadow-[var(--shadow-overlay)]"
            style={{ background: 'var(--brand-card)', borderColor: 'var(--brand-navy)', color: 'var(--brand-ink-700)' }}
            aria-live="polite"
          >
            <span className="w-full">
              <strong>{pendingFlip.childLabel}</strong> is already inside{' '}
              <strong>{pendingFlip.parentLabel}</strong> — flip them so{' '}
              <strong>{pendingFlip.childLabel}</strong> is the parent?
            </span>
            <button
              type="button"
              onClick={() => {
                const f = pendingFlip;
                setPendingFlip(null);
                void act({
                  action: 'invert_edge',
                  childDomainKey: f.childKey,
                  parentDomainKey: f.parentKey,
                });
              }}
              disabled={busy}
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
            >
              ⇄ Flip — make it the parent
            </button>
            <button
              type="button"
              onClick={() => setPendingFlip(null)}
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium"
              style={{ borderColor: 'var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {/* Pick-up mode controls are FIXED to the bottom — Cancel must stay in
          reach however deep in a long tree you've scrolled (the old top banner
          left you stranded in "Place here" land). */}
      {picking ? (
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-toast)] flex justify-center p-3">
          <div
            className="flex w-full max-w-lg flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-quiet shadow-[var(--shadow-overlay)]"
            style={{ background: 'var(--brand-card)', borderColor: 'var(--brand-navy)', color: 'var(--brand-ink-700)' }}
            aria-live="polite"
          >
            <span className="min-w-0 flex-1">
              {picking.mode === 'move' ? 'Moving' : picking.mode === 'copy' ? 'Copying' : 'Merging'}{' '}
              <strong>{picking.childLabel}</strong> —{' '}
              {picking.mode === 'merge'
                ? 'tap the territory that absorbs it.'
                : 'tap “Place here” on the destination.'}
              {picking.mode === 'copy' ? ' It will live under both parents.' : ''}
            </span>
            {picking.mode === 'move' && picking.fromParentKey ? (
              <button
                type="button"
                onClick={makeTopLevel}
                disabled={busy}
                className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-50"
                style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
              >
                Make top-level
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPicking(null)}
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium"
              style={{ borderColor: 'var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mb-2 text-xs">
          Drag a ⠿ handle onto another row to nest it — the drop IS the move (Sonatas onto
          Beethoven → child). Or just TAP ⠿ to pick a row up and choose from big “Place here”
          buttons. After a drop you can undo, or keep it under the old parent too.
        </p>
      )}
      {error ? (
        <p className="mb-2 text-quiet" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      {exhaustedLeaves.length > 0 ? (
        <ExhaustedWorklist
          leaves={exhaustedLeaves}
          nodeByKey={nodeByKey}
          parentsByChild={parentsByChild}
          pointsByKey={pointsByKey}
          depthByKey={depthByKey}
          genStatsByKey={genStatsByKey}
          supplyByKey={supplyByKey}
          onJump={jumpToInstance}
        />
      ) : null}

      <DndContext
        sensors={sensors}
        // The drop target is wherever the FINGER is, not a rectangle overlap —
        // much more predictable on touch.
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDrag(null);
          lastDragEndAt.current = Date.now();
        }}
      >
        <RootDropZone dragActive={drag !== null} />
        <div className="rounded-md border py-1" style={{ borderColor: 'var(--border)' }}>
          {roots.length === 0 ? (
            <p className="text-muted-foreground px-3 py-2 text-sm">
              Nothing in the tree yet — accept a suggested group above or add a territory.
            </p>
          ) : filterState && filterState.matches.size === 0 ? (
            <p className="text-muted-foreground px-3 py-2 text-sm">
              No territories match “{filter.trim()}”.
            </p>
          ) : (
            roots
              .filter((key) => !filterState || filterState.visible.has(key))
              .map((key) => (
                <TreeRow
                  key={key}
                  nodeKey={key}
                  parentKey={null}
                  depth={0}
                  ancestors={new Set()}
                  nodeByKey={nodeByKey}
                  depthByKey={depthByKey}
                  pointsByKey={pointsByKey}
                  genStatsByKey={genStatsByKey}
                  exhaustedByKey={exhaustedByKey}
                  supplyByKey={supplyByKey}
                  childrenByParent={childrenByParent}
                  parentCountByChild={parentCountByChild}
                  parentsByChild={parentsByChild}
                  onJump={jumpToInstance}
                  flashInstance={flashInstance}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  filterState={filterState}
                  picking={picking}
                  pickedSubtree={pickedSubtree}
                  dragKey={drag?.childKey ?? null}
                  dragSubtree={dragSubtree}
                  busy={busy}
                  onPick={pickUnlessJustDragged}
                  onPlace={placeInto}
                  onAct={act}
                  onDone={onDone}
                />
              ))
          )}
        </div>
        <DragOverlay>
          {drag ? (
            <div
              // w-max: the overlay container is sized to the DRAG HANDLE (a
              // ~36px button), so without an explicit content width the label
              // smooshes into a vertical sliver.
              className="w-max max-w-[80vw] truncate whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium shadow-[var(--shadow-card)]"
              style={{ background: 'var(--brand-card)', borderColor: 'var(--brand-navy)', color: 'var(--brand-ink)' }}
            >
              {drag.label}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

// ─── unfiled areas ──────────────────────────────────────────────────────────
// Every corpus area that has questions but NO authored territory ("show all
// areas, not just the ones I did"). The tree above is the curated structure;
// this is the complete rest-of-the-map, biggest first. "Add to tree" creates
// the node (it appears as a top-level territory on refresh — drag it into
// place from there); everything else about the area is read-only until then.
const UNFILED_PREVIEW_COUNT = 40;

function UnfiledAreas({
  unfiled,
  supplyByKey,
  onDone,
}: {
  unfiled: UnfiledArea[];
  supplyByKey: Record<string, SupplyReadout>;
  onDone: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (unfiled.length === 0) return null;
  const visible = showAll ? unfiled : unfiled.slice(0, UNFILED_PREVIEW_COUNT);

  async function addToTree(area: UnfiledArea) {
    if (busyKey) return;
    setBusyKey(area.domainKey);
    setError(null);
    const res = await post({ action: 'create_node', label: area.label, nodeKind: 'leaf' });
    setBusyKey(null);
    // 409 = a node raced into existence for this key — that IS the goal.
    if (!res.ok && res.status !== 409) {
      setError(`Couldn't add "${area.label}" (${res.status}).`);
      return;
    }
    onDone();
  }

  return (
    <section className="mt-8">
      <h2 className="mb-1 font-serif text-lg font-semibold text-[var(--brand-ink)]">
        Unfiled areas ({unfiled.length})
      </h2>
      <p className="text-muted-foreground mb-2 text-xs">
        Areas with questions that aren&apos;t in your tree yet — the categorizer filed content
        here, but no territory exists. <strong>Add to tree</strong> makes one (it lands at the top
        level; drag it into place). Biggest first.
      </p>
      {error ? (
        <p className="mb-2 text-quiet" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      <div className="rounded-md border py-1" style={{ borderColor: 'var(--border)' }}>
        {visible.map((area) => {
          const dupRate = area.genTotal > 0 ? area.genDupes / area.genTotal : 0;
          const showDup =
            area.genTotal >= HARD_TO_SOURCE_MIN_SAMPLE && dupRate >= HARD_TO_SOURCE_MIN_RATE;
          return (
            <div
              key={area.domainKey}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5 text-sm last:border-b-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-y-0.5 py-0.5">
                <span className="min-w-0 break-words text-[var(--brand-ink)]">{area.label}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground" title="Questions filed under this label">
                    {area.questions} question{area.questions === 1 ? '' : 's'}
                  </span>
                  <span className="text-muted-foreground" title="Points currently earnable here (difficulty-weighted)">
                    {area.points.toLocaleString()} pts available
                  </span>
                  {area.exhausted ? (
                    <InfoTerm term="exhausted" className="font-semibold" style={{ color: 'var(--danger)' }}>
                      ⛔ exhausted
                    </InfoTerm>
                  ) : showDup ? (
                    <InfoTerm
                      def={`${Math.round(dupRate * 100)}% of the questions generated here came back as duplicates (${area.genDupes} of ${area.genTotal}) — fresh facts are getting hard to find.`}
                      className="font-medium"
                      style={{ color: dupRateColor(dupRate) }}
                    >
                      ⟳ {Math.round(dupRate * 100)}% duplicates
                    </InfoTerm>
                  ) : null}
                  <SupplyChip domainKeyValue={area.domainKey} supply={supplyByKey[area.domainKey]} />
                </span>
              </span>
              <button
                type="button"
                onClick={() => void addToTree(area)}
                disabled={busyKey !== null}
                className="inline-flex min-h-9 shrink-0 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-40"
                style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                title="Create a territory for this area — it appears at the top level of the tree; drag it into place from there"
              >
                {busyKey === area.domainKey ? 'Adding…' : '+ Add to tree'}
              </button>
            </div>
          );
        })}
      </div>
      {unfiled.length > UNFILED_PREVIEW_COUNT ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-muted-foreground mt-2 text-xs underline-offset-2 hover:underline"
        >
          {showAll
            ? 'show fewer'
            : `show all ${unfiled.length} (${unfiled.length - UNFILED_PREVIEW_COUNT} more)`}
        </button>
      ) : null}
    </section>
  );
}

// The drop target for un-nesting: drag a nested row here to make it top-level.
// Lights up the moment a drag starts, so the option is discoverable mid-drag.
function RootDropZone({ dragActive }: { dragActive: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'root-zone', data: { toParentKey: null } });
  return (
    <div
      ref={setNodeRef}
      className="mb-1 rounded-md border border-dashed px-3 py-2 text-center text-xs transition-colors"
      style={{
        borderColor: isOver || dragActive ? 'var(--brand-navy)' : 'var(--border)',
        background: isOver ? 'var(--surface-2)' : 'transparent',
        color: dragActive ? 'var(--brand-ink-700)' : 'var(--text-muted)',
        borderWidth: isOver ? 2 : 1,
      }}
    >
      top level — drop here to un-nest
    </div>
  );
}

// ─── the exhausted-leaves worklist ───────────────────────────────────────────
// A global burn-down queue for every leaf flagged ⛔ exhausted (self) across the
// whole graph — the actionable read of the per-parent "⛔ N exhausted" counters.
// Exhaustion is a leaf-only property (page.tsx never self-flags a parent), so
// this list is exactly the leaves that need a human decision: hand-author more,
// merge into a sibling that names the same scope, or shrink the set target. The
// mutating levers all live in the tree, so each row JUMPS there (expand + scroll
// + flash) rather than duplicating the merge/edit state machines; a read-only
// Questions peek is inlined so you can diagnose before deciding.
// The likely lever for an exhausted leaf, inferred from the only signals we have:
// the gap between current supply (avail) and the mastery target, and how granular
// the leaf is (question count). It is a SUGGESTION, not a verdict — the system has
// no world knowledge, so a genuinely rich topic the generator simply failed (a
// handful of Simpsons Qs) looks identical to a truly finite one. All three levers
// stay open on every row; this only leads with the most probable one.
// A topic is RICH when the corpus sizer found real breadth — a dedicated Fandom
// wiki, or a corpus estimate well above the granular floor. Distinguishes a rich
// leaf the generator merely FAILED on (a handful of Simpsons Qs at 50% dup) from
// a genuinely too-granular one, which the bare question count cannot.
const RICH_CORPUS_ESTIMATE = 60;
function isRichTopic(supply: SupplyReadout | undefined): boolean {
  if (!supply) return false;
  return supply.fandomHost != null || (supply.corpusEstimatedQuestions ?? 0) >= RICH_CORPUS_ESTIMATE;
}

function exhaustedDecisionHint(
  threshold: number | null,
  avail: number,
  qs: number,
  parentLabel: string | null,
  rich: boolean,
): string {
  if (threshold == null) {
    return 'no mastery target set — set one to size it, or merge up / hand-author';
  }
  // A RICH topic (deep corpus / dedicated fandom wiki) that ran dry is almost
  // always the generator failing to mine it, NOT a leaf too granular to stand
  // alone — so lead with author/ground, and never suggest merging it away. This
  // is the Simpsons/Hamlet class: a "handful of Qs" that actually has hundreds.
  if (rich) {
    return parentLabel
      ? `rich topic the generator stalled on — hand-author or ground more (don't merge it into ${parentLabel})`
      : 'rich topic the generator stalled on — hand-author or ground more';
  }
  if (qs < THIN_LEAF_THRESHOLD && parentLabel) {
    return `likely too granular — merge up into ${parentLabel} (or hand-author, if it's actually a rich topic)`;
  }
  if (avail < threshold / 2) {
    return 'target looks too high for the real supply — shrink it to fit, or hand-author / ground more';
  }
  return 'close to masterable — hand-author or ground the rest, or trim the target';
}

function ExhaustedWorklist({
  leaves,
  nodeByKey,
  parentsByChild,
  pointsByKey,
  depthByKey,
  genStatsByKey,
  supplyByKey,
  onJump,
}: {
  leaves: string[];
  nodeByKey: Map<string, KnowledgeNodeRow>;
  parentsByChild: Map<string, string[]>;
  pointsByKey: Record<string, number>;
  depthByKey: Record<string, number>;
  genStatsByKey: Record<string, { total: number; dupes: number }>;
  supplyByKey: Record<string, SupplyReadout>;
  onJump: (childKey: string, parentKey: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [peekKey, setPeekKey] = useState<string | null>(null);

  return (
    <section
      className="mb-3 rounded-md border"
      style={{ borderColor: 'var(--danger)', background: 'var(--brand-field)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="font-semibold" style={{ color: 'var(--danger)' }}>
          ⛔ Exhausted — {leaves.length} need{leaves.length === 1 ? 's' : ''} a decision
        </span>
        <span className="text-muted-foreground ml-auto text-xs">{open ? 'hide' : 'show'}</span>
      </button>
      {open ? (
        <>
          <p className="text-muted-foreground px-3 pb-2 text-xs leading-relaxed">
            These leaves stopped producing new questions — the generator keeps
            repeating itself (the <em>% dup</em>), so supply is frozen below what
            mastering them needs. For each, pick a lever:{' '}
            <strong>shrink the target</strong> to what the topic can really yield,{' '}
            <strong>merge it up</strong> into a broader parent if it&apos;s too granular to
            stand alone, or <strong>hand-author / ground</strong> more if it&apos;s a rich
            topic the machine just failed. The <em>best guess</em> on each row is a
            heuristic, not a verdict — all three levers stay open. Leaves already holding
            enough to master are hidden — nothing to decide there. Rich topics the
            refill has never actually mined are hidden too — they need a generation
            run, not a decision.
          </p>
          <ul className="space-y-1 px-2 pb-2">
          {leaves.map((key) => {
            const node = nodeByKey.get(key);
            if (!node) return null;
            const parents = parentsByChild.get(key) ?? [];
            const firstParent = parents[0] ?? null;
            const parentLabel = firstParent
              ? nodeByKey.get(firstParent)?.label ?? firstParent
              : 'top level';
            const g = genStatsByKey[key];
            const dupPct = g && g.total > 0 ? Math.round((g.dupes / g.total) * 100) : null;
            return (
              <li
                key={key}
                className="rounded-md border bg-[var(--brand-card)] p-2"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-[var(--brand-ink)]">{node.label}</span>
                  <span className="text-muted-foreground text-xs">
                    under {parentLabel}
                    {parents.length > 1 ? ` +${parents.length - 1}` : ''}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onJump(key, firstParent)}
                      className="inline-flex min-h-8 items-center rounded-md border px-2 text-xs font-medium"
                      style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                    >
                      Go there →
                    </button>
                    <button
                      type="button"
                      onClick={() => setPeekKey((k) => (k === key ? null : key))}
                      aria-expanded={peekKey === key}
                      className="inline-flex min-h-8 items-center rounded-md border px-2 text-xs font-medium"
                      style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
                    >
                      Questions
                    </button>
                  </span>
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {(pointsByKey[key] ?? 0).toLocaleString()} avail ·{' '}
                  {node.masteryThreshold
                    ? `${node.masteryThreshold.toLocaleString()} to master`
                    : 'no threshold'}{' '}
                  · {depthByKey[key] ?? 0} Qs{dupPct !== null ? ` · ${dupPct}% dup` : ''}
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--brand-ink-700)' }}>
                  <span style={{ color: 'var(--danger)' }}>→ best guess:</span>{' '}
                  {exhaustedDecisionHint(
                    node.masteryThreshold ?? null,
                    pointsByKey[key] ?? 0,
                    depthByKey[key] ?? 0,
                    firstParent ? parentLabel : null,
                    isRichTopic(supplyByKey[key]),
                  )}
                </div>
                {peekKey === key ? (
                  <QuestionsPeek domainKeyValue={key} onClose={() => setPeekKey(null)} />
                ) : null}
              </li>
            );
          })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function TreeRow({
  nodeKey,
  parentKey,
  depth,
  ancestors,
  nodeByKey,
  depthByKey,
  pointsByKey,
  genStatsByKey,
  exhaustedByKey,
  supplyByKey,
  childrenByParent,
  parentCountByChild,
  parentsByChild,
  onJump,
  flashInstance,
  expanded,
  setExpanded,
  filterState,
  picking,
  pickedSubtree,
  dragKey,
  dragSubtree,
  busy,
  onPick,
  onPlace,
  onAct,
  onDone,
}: {
  nodeKey: string;
  parentKey: string | null;
  depth: number;
  ancestors: Set<string>;
  nodeByKey: Map<string, KnowledgeNodeRow>;
  depthByKey: Record<string, number>;
  pointsByKey: Record<string, number>;
  genStatsByKey: Record<string, { total: number; dupes: number }>;
  exhaustedByKey: Record<string, { self: boolean; descendants: number }>;
  supplyByKey: Record<string, SupplyReadout>;
  childrenByParent: Map<string, string[]>;
  parentCountByChild: Map<string, number>;
  parentsByChild: Map<string, string[]>;
  onJump: (childKey: string, parentKey: string) => void;
  flashInstance: string | null;
  expanded: Set<string>;
  setExpanded: (updater: (prev: Set<string>) => Set<string>) => void;
  filterState: FilterState;
  picking: PickState;
  pickedSubtree: Set<string>;
  dragKey: string | null;
  dragSubtree: Set<string>;
  busy: boolean;
  onPick: (pick: PickState) => void;
  onPlace: (toParentKey: string) => void;
  onAct: (body: Record<string, unknown>) => Promise<void> | void;
  onDone: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [peekOpen, setPeekOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childLabel, setChildLabel] = useState('');
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editThreshold, setEditThreshold] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);

  const node = nodeByKey.get(nodeKey); // not a hook — safe before the hooks below
  // Drag source (the ⠿ handle) + drop target (the whole row). Instance-unique
  // ids so the same node under two parents drags/drops independently. Hooks run
  // unconditionally, before the cycle-guard return below.
  const instanceId = `${parentKey ?? 'root'}::${nodeKey}`;
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `drag::${instanceId}`,
    data: { childKey: nodeKey, fromParentKey: parentKey, label: node?.label ?? nodeKey },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop::${instanceId}`,
    data: { toParentKey: nodeKey, toParentLabel: node?.label ?? nodeKey },
  });

  if (!node || ancestors.has(nodeKey)) return null; // cycle guard

  const allChildren = childrenByParent.get(nodeKey) ?? [];
  // Under an active filter only visible children render — so a filtered parent
  // shows just the path/subtree that reached a match, not every sibling.
  const children = filterState ? allChildren.filter((c) => filterState.visible.has(c)) : allChildren;
  // Ancestors of a match are force-open so the match is on screen; a matched
  // node itself keeps the human's expand state so its subtree stays collapsible.
  const isOpen = filterState?.ancestors.has(nodeKey) ? true : expanded.has(nodeKey);
  const isMatch = filterState?.matches.has(nodeKey) ?? false;
  const parentCount = parentCountByChild.get(nodeKey) ?? 0;
  const isParentish = node.nodeKind !== 'leaf' || allChildren.length > 0;

  // The picked row's CURRENT parent stays tappable — placing there offers the
  // flip (child becomes the parent's parent) instead of a no-op.
  const placeDisabled =
    !picking || busy || nodeKey === picking.childKey || pickedSubtree.has(nodeKey);

  async function submitChild() {
    const label = childLabel.trim();
    if (!label) return;
    setRowError(null);
    const created = await post({ action: 'create_node', label, nodeKind: 'leaf' });
    let childKey: string | null = null;
    if (created.ok) {
      childKey = (created.body as unknown as { node?: { domainKey?: string } } | null)?.node?.domainKey ?? null;
    } else if (created.status === 409) {
      childKey =
        (created.body as unknown as { existing?: { domainKey?: string } } | null)?.existing?.domainKey ?? null;
    }
    if (!childKey) {
      setRowError(`Couldn't create "${label}" (${created.status}).`);
      return;
    }
    await onAct({ action: 'attach_child', childDomainKey: childKey, toParentDomainKey: nodeKey });
    setChildLabel('');
    setAddingChild(false);
  }

  async function saveEdit() {
    setRowError(null);
    const res = await post({
      action: 'edit_node',
      id: node!.id,
      label: editLabel.trim() || undefined,
      // Edit the v2 mastery THRESHOLD in points (progress = points ÷ threshold).
      masteryThreshold: editThreshold.trim() ? Math.max(1, Number(editThreshold)) : null,
    });
    if (!res.ok) {
      setRowError(
        res.status === 409
          ? `That label folds onto "${res.body?.existing?.label ?? 'another territory'}".`
          : `Save failed (${res.status}).`,
      );
      return;
    }
    setEditing(false);
    onDone();
  }

  const smallBtn =
    'rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-40';
  // Revealed-menu buttons: proper tap targets, unlike the old inline row.
  const menuBtn =
    'inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-40';

  // While a drag is live: every legal landing spot is announced, not just the
  // one under the pointer. Illegal = the dragged node itself and anything
  // inside its subtree (a same-parent drop is simply ignored on release).
  const dropEligible = dragKey !== null && nodeKey !== dragKey && !dragSubtree.has(nodeKey);

  const isFlashed = flashInstance === instanceId;

  return (
    <div>
      <div
        ref={setDropRef}
        id={`tree-row-${instanceId}`}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1.5 text-sm transition-colors last:border-b-0"
        style={{
          borderColor: 'var(--border)',
          paddingLeft: `${8 + depth * 18}px`,
          opacity: isDragging ? 0.4 : 1,
          // Jump landing flash > drag states; during a drag every legal target
          // is visibly a landing zone, the one under the finger stronger.
          background: isFlashed ? 'var(--warning-surface)' : isOver ? 'var(--surface-2)' : undefined,
          boxShadow: isFlashed
            ? 'inset 0 0 0 2px var(--accent-gold)'
            : isOver
              ? 'inset 0 0 0 2px var(--brand-navy)'
              : dropEligible
                ? 'inset 0 0 0 1px var(--brand-navy)'
                : // A filter match gets a gold left bar so it stands out from the
                  // ancestor rows that only exist to carry the path down to it.
                  isMatch
                  ? 'inset 3px 0 0 var(--accent-gold)'
                  : undefined,
          borderRadius: isFlashed || isOver || dropEligible ? 6 : undefined,
        }}
      >
        {/* Left group: handle + expander + a two-line content column (name
            wraps; stats beneath). min-w-0 keeps the ⋯ button on the row. */}
        <span className="flex min-w-0 flex-1 items-center gap-x-2">
        {/* Drag handle — a real 44px control, not a bare glyph. Drag it to
            re-file; a plain TAP falls back to pick-up mode (big "Place here"
            buttons on every destination). */}
        <button
          type="button"
          ref={setDragRef}
          {...listeners}
          {...attributes}
          onClick={() =>
            // Tapping the picked row's own handle again puts it back down.
            onPick(
              picking?.childKey === nodeKey
                ? null
                : { mode: 'move', childKey: nodeKey, childLabel: node.label, fromParentKey: parentKey },
            )
          }
          aria-label={`Move ${node.label} (drag, or tap to pick up)`}
          title="Drag to re-file — or tap to pick up and choose a destination"
          className="inline-flex min-h-11 min-w-9 cursor-grab touch-none items-center justify-center rounded-md border active:cursor-grabbing"
          style={{
            touchAction: 'none',
            borderColor: 'var(--border)',
            color: 'var(--brand-ink-700)',
            background: 'var(--brand-field)',
          }}
        >
          ⠿
        </button>
        {children.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(nodeKey)) next.delete(nodeKey);
                else next.add(nodeKey);
                return next;
              })
            }
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.label}`}
            className="w-4 text-[var(--brand-ink-700)]"
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4" aria-hidden />
        )}

        {editing ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              className="w-44 rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-0.5 text-sm"
              aria-label="Label"
            />
            <input
              value={editThreshold}
              onChange={(e) => setEditThreshold(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="points"
              inputMode="numeric"
              maxLength={6}
              className="w-20 rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-0.5 text-sm"
              aria-label="Mastery threshold (points)"
            />
            <button type="button" onClick={() => void saveEdit()} className={smallBtn} style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={smallBtn} style={{ borderColor: 'var(--border)' }}>
              Cancel
            </button>
          </span>
        ) : (
          /* Two lines, always (2026-07-08: "sometimes can't read the category"):
             the NAME gets the full row width and WRAPS — never truncates — and
             the stats live on their own line beneath in plain words, so a long
             territory name and its numbers can both be read on a phone. */
          <span className="flex min-w-0 flex-1 flex-col gap-y-0.5 py-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span
                className={
                  (isParentish ? 'font-medium text-[var(--brand-ink)]' : 'text-[var(--brand-ink)]') +
                  ' min-w-0 break-words'
                }
              >
                {node.label}
              </span>
              {/* Multi-parent chip: tap to see every place this territory lives
                  and jump to any of them. */}
              {parentCount > 1 ? (
                <button
                  type="button"
                  onClick={() => setPlacesOpen((v) => !v)}
                  aria-expanded={placesOpen}
                  aria-label={`${node.label} is in ${parentCount} places — show them`}
                  title="This territory lives in more than one place — tap to see and jump"
                  className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs font-medium"
                  style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                >
                  ⧉ {parentCount}
                </button>
              ) : null}
              {/* "This is too small" — a thin leaf that isn't already nested is a
                  condense-me candidate (Move it under a parent). */}
              {!isParentish && (depthByKey[nodeKey] ?? 0) < THIN_LEAF_THRESHOLD && parentCount === 0 ? (
                <InfoTerm
                  term="thin_leaf"
                  className="shrink-0 rounded-sm px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.06em]"
                  style={{ color: 'var(--warning)', background: 'var(--warning-surface)' }}
                >
                  thin
                </InfoTerm>
              ) : null}
            </span>
            {/* The stats line — spelled out, not abbreviated ("stats hard to
                decipher"): mastery target (color = size), question count and
                points available (both rolled up through the subtree for
                parents), then the escalating supply flag. */}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <InfoTerm
                term="pts_to_master"
                className="font-medium"
                style={{ color: node.masteryThreshold ? thresholdColor(node.masteryThreshold) : 'var(--warning)' }}
              >
                {node.masteryThreshold
                  ? `${node.masteryThreshold.toLocaleString()} pts to master`
                  : 'no mastery target'}
              </InfoTerm>
              <span className="text-muted-foreground" title="Questions filed in this area (rolled up through the subtree for parents)">
                {depthByKey[nodeKey] ?? 0} questions
              </span>
              <InfoTerm term="pts_available" className="text-muted-foreground">
                {(pointsByKey[nodeKey] ?? 0).toLocaleString()} pts available
              </InfoTerm>
              {(() => {
                // Escalating supply signal: EXHAUSTED (at the expansion gate) beats
                // "hard to source" (high dup) beats nothing.
                const ex = exhaustedByKey[nodeKey];
                if (ex?.self) {
                  return (
                    <InfoTerm term="exhausted" className="font-semibold" style={{ color: 'var(--danger)' }}>
                      ⛔ exhausted
                    </InfoTerm>
                  );
                }
                if (ex && ex.descendants > 0) {
                  return (
                    <InfoTerm
                      def={`${ex.descendants} sub-area${ex.descendants === 1 ? '' : 's'} inside this one ${ex.descendants === 1 ? 'is' : 'are'} exhausted — generation dried up there and a human decision is needed.`}
                      className="font-medium"
                      style={{ color: 'var(--danger)' }}
                    >
                      ⛔ {ex.descendants} exhausted
                    </InfoTerm>
                  );
                }
                const g = genStatsByKey[nodeKey];
                if (!g || g.total < HARD_TO_SOURCE_MIN_SAMPLE) return null;
                const rate = g.dupes / g.total;
                if (rate < HARD_TO_SOURCE_MIN_RATE) return null; // only flag where it's hard
                const pct = Math.round(rate * 100);
                return (
                  <InfoTerm
                    def={`${pct}% of the questions generated here came back as duplicates (${g.dupes} of ${g.total}) — fresh facts are getting hard to find.`}
                    className="font-medium"
                    style={{ color: dupRateColor(rate) }}
                  >
                    ⟳ {pct}% duplicates
                  </InfoTerm>
                );
              })()}
              <SupplyChip domainKeyValue={nodeKey} supply={supplyByKey[nodeKey]} />
            </span>
          </span>
        )}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1">
          {picking ? (
            <button
              type="button"
              onClick={() => onPlace(nodeKey)}
              disabled={placeDisabled}
              className="inline-flex min-h-9 items-center whitespace-nowrap rounded-md border px-3 text-sm font-medium disabled:opacity-40"
              style={
                placeDisabled
                  ? { borderColor: 'var(--border)', color: 'var(--text-muted)' }
                  : picking.mode === 'merge'
                    ? { borderColor: 'var(--danger)', color: 'var(--danger)' }
                    : { borderColor: 'var(--success)', color: 'var(--success)' }
              }
            >
              {picking.mode === 'merge' ? 'Merge here' : 'Place here'}
            </button>
          ) : !editing ? (
            // Actions collapse behind one comfortably-tappable toggle — the five
            // inline buttons were sub-target and wrapped on a phone.
            <button
              type="button"
              onClick={() => setActionsOpen((v) => !v)}
              aria-expanded={actionsOpen}
              aria-label={`Actions for ${node.label}`}
              className="inline-flex size-9 items-center justify-center rounded-md border text-base"
              style={
                actionsOpen
                  ? { borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }
                  : { borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }
              }
            >
              ⋯
            </button>
          ) : null}
        </span>

        {/* Revealed action set — full-size targets, one tidy row (wraps at
            most to two on a narrow phone, still tappable). */}
        {actionsOpen && !picking && !editing ? (
          <div className="flex w-full flex-wrap items-center gap-1.5 pt-1.5">
            <button
              type="button"
              onClick={() => {
                setActionsOpen(false);
                onPick({ mode: 'move', childKey: nodeKey, childLabel: node.label, fromParentKey: parentKey });
              }}
              className={menuBtn}
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
            >
              Move
            </button>
            <button
              type="button"
              onClick={() => {
                setActionsOpen(false);
                onPick({ mode: 'copy', childKey: nodeKey, childLabel: node.label, fromParentKey: parentKey });
              }}
              className={menuBtn}
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingChild(true);
                setActionsOpen(false);
                setRowError(null);
              }}
              className={menuBtn}
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            >
              + Child
            </button>
            <button
              type="button"
              onClick={() => {
                setActionsOpen(false);
                setEditing(true);
                setEditLabel(node.label);
                setEditThreshold(node.masteryThreshold?.toString() ?? '');
              }}
              className={menuBtn}
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                setPeekOpen((v) => !v);
                setActionsOpen(false);
              }}
              className={menuBtn}
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
              title="See the questions that actually live in this territory"
            >
              Questions
            </button>
            <button
              type="button"
              onClick={() => {
                setSuggestOpen((v) => !v);
                setActionsOpen(false);
              }}
              className={menuBtn}
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
              title="Ask Wikidata (and the LLM) for candidate parents — you ratify or reject each one"
            >
              Suggest parents
            </button>
            <button
              type="button"
              onClick={() => {
                setActionsOpen(false);
                onPick({ mode: 'merge', childKey: nodeKey, childLabel: node.label, fromParentKey: parentKey });
              }}
              className={menuBtn}
              style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
              title="Fold this territory into another that names the SAME scope — questions and progress move, this one ceases to exist"
            >
              Merge into…
            </button>
            {parentKey ? (
              <button
                type="button"
                onClick={() => {
                  setActionsOpen(false);
                  void onAct({ action: 'delete_edge', childDomainKey: nodeKey, parentDomainKey: parentKey });
                }}
                className={menuBtn}
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                title="Remove from this parent (the territory itself is kept)"
              >
                Remove from here
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Every place this territory lives; tap one to expand + scroll +
            flash that instance. The row you're on is marked, not linked. */}
        {placesOpen && parentCount > 1 ? (
          <div
            className="mt-1 w-full rounded-md border p-2 text-quiet"
            style={{ borderColor: 'var(--border)', background: 'var(--brand-field)' }}
          >
            <p className="text-muted-foreground mb-1 text-xs">
              {node.label} lives in {parentCount} places:
            </p>
            <ul className="space-y-1">
              {(parentsByChild.get(nodeKey) ?? []).map((pKey) => (
                <li key={pKey} className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-[var(--brand-ink)]">
                    {nodeByKey.get(pKey)?.label ?? pKey}
                  </span>
                  {pKey === parentKey ? (
                    <span className="text-muted-foreground shrink-0 text-xs">(you’re here)</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setPlacesOpen(false);
                        onJump(nodeKey, pKey);
                      }}
                      className="inline-flex min-h-7 shrink-0 items-center rounded-md border px-2 text-xs font-medium"
                      style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                    >
                      go there →
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {peekOpen ? <QuestionsPeek domainKeyValue={nodeKey} onClose={() => setPeekOpen(false)} /> : null}

        {suggestOpen ? (
          <ParentSuggestions
            childKey={nodeKey}
            childLabel={node.label}
            existingParentKeys={new Set(parentsByChild.get(nodeKey) ?? [])}
            onRatified={onDone}
            onClose={() => setSuggestOpen(false)}
          />
        ) : null}

        {addingChild ? (
          <span className="flex w-full items-center gap-1.5 pl-6 pt-1">
            <input
              value={childLabel}
              onChange={(e) => setChildLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitChild();
              }}
              placeholder={`New child of ${node.label}…`}
              className="w-52 rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1 text-sm"
              aria-label={`New child of ${node.label}`}
            />
            <button type="button" onClick={() => void submitChild()} disabled={!childLabel.trim()} className={smallBtn} style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>
              Add
            </button>
            <button type="button" onClick={() => setAddingChild(false)} className={smallBtn} style={{ borderColor: 'var(--border)' }}>
              Cancel
            </button>
          </span>
        ) : null}
        {rowError ? (
          <span className="w-full pl-6 text-xs" style={{ color: 'var(--danger)' }}>
            {rowError}
          </span>
        ) : null}
      </div>

      {isOpen
        ? children.map((childKey) => (
            <TreeRow
              key={`${nodeKey}:${childKey}`}
              nodeKey={childKey}
              parentKey={nodeKey}
              depth={depth + 1}
              ancestors={new Set([...ancestors, nodeKey])}
              nodeByKey={nodeByKey}
              depthByKey={depthByKey}
              pointsByKey={pointsByKey}
              genStatsByKey={genStatsByKey}
              exhaustedByKey={exhaustedByKey}
              supplyByKey={supplyByKey}
              childrenByParent={childrenByParent}
              parentCountByChild={parentCountByChild}
              parentsByChild={parentsByChild}
              onJump={onJump}
              flashInstance={flashInstance}
              expanded={expanded}
              setExpanded={setExpanded}
              filterState={filterState}
              picking={picking}
              pickedSubtree={pickedSubtree}
              dragKey={dragKey}
              dragSubtree={dragSubtree}
              busy={busy}
              onPick={onPick}
              onPlace={onPlace}
              onAct={onAct}
              onDone={onDone}
            />
          ))
        : null}
    </div>
  );
}

// Read-only peek at a territory's actual questions — the sanity check Josh
// asked for before moving/merging ("would be good to see some of the questions
// in these areas"). Same load-once idiom as ProposalQueue.
function QuestionsPeek({
  domainKeyValue,
  onClose,
}: {
  domainKeyValue: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Array<{
    text: string;
    answer: string;
    source: 'canonical' | 'bank';
    suppressed: boolean;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      const res = await post({ action: 'list_questions', domainKey: domainKeyValue });
      if (!res.ok) {
        setError(`Couldn't load questions (${res.status}).`);
        return;
      }
      const body = res.body as unknown as { questions: typeof items } | null;
      setItems(body?.questions ?? []);
    })();
  }, [domainKeyValue]);

  return (
    <div
      className="mt-1 w-full rounded-md border p-2 text-quiet"
      style={{ borderColor: 'var(--border)', background: 'var(--brand-field)' }}
    >
      {error ? (
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      ) : items === null ? (
        <p className="text-muted-foreground animate-pulse text-xs">Loading questions…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-xs">No questions in this territory yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((q, i) => (
            <li key={i} className="leading-snug">
              <span className="text-[var(--brand-ink)]">{q.text}</span>{' '}
              <span className="text-muted-foreground">
                — {q.answer}
                {q.source === 'bank' ? ' · machine bank' : ''}
                {q.suppressed ? ' · out of circulation' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onClose}
        className="text-muted-foreground mt-1.5 text-xs underline-offset-2 hover:underline"
      >
        close
      </button>
    </div>
  );
}

// B-KNOWLEDGE-ADMIN-01 P3 — the per-territory proposal queue. Two sources feed
// it: Wikidata (preferred — a clean is-a ontology, direct edges only) and the
// near-ness LLM (for territories Wikidata won't have). Provenance is shown on
// every card; the human always picks the edge type (Wikidata's is-a suggests
// substantive, but P279 ≠ "you learn about the parent"); Ratify is the ONLY
// write, Reject discards client-side and persists nothing (§4).
type ParentProposal = {
  label: string;
  broadCategory: string | null;
  rung: 'parent' | 'grandparent';
  parentDomainKey: string;
  source: 'wikidata' | 'llm';
  qid: string | null;
  description: string | null;
};

function ParentSuggestions({
  childKey,
  childLabel,
  existingParentKeys,
  onRatified,
  onClose,
}: {
  childKey: string;
  childLabel: string;
  existingParentKeys: Set<string>;
  onRatified: () => void;
  onClose: () => void;
}) {
  const [proposals, setProposals] = useState<ParentProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      const res = await post({ action: 'propose', childLabel });
      if (!res.ok) {
        setError(`Couldn't fetch suggestions (${res.status}).`);
        return;
      }
      const body = res.body as unknown as { proposals: ParentProposal[] } | null;
      // A parent this child already lives under isn't a proposal — drop it.
      setProposals((body?.proposals ?? []).filter((p) => !existingParentKeys.has(p.parentDomainKey)));
    })();
    // existingParentKeys is read once on the initial load by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childLabel]);

  async function ratify(proposal: ParentProposal) {
    if (pendingKey) return;
    setPendingKey(proposal.parentDomainKey);
    setError(null);
    const res = await post({
      action: 'ratify',
      childDomainKey: childKey,
      parentLabel: proposal.label,
      parentBroadCategory: proposal.broadCategory,
      wikidataQid: proposal.qid,
    });
    setPendingKey(null);
    if (!res.ok) {
      setError(`Ratify failed (${res.status}).`);
      return;
    }
    setProposals((prev) => prev?.filter((p) => p.parentDomainKey !== proposal.parentDomainKey) ?? null);
    onRatified();
  }

  function reject(proposal: ParentProposal) {
    // Discard — writes nothing (§4).
    setProposals((prev) => prev?.filter((p) => p.parentDomainKey !== proposal.parentDomainKey) ?? null);
  }

  return (
    <div
      className="mt-1 w-full rounded-md border p-2 text-quiet"
      style={{ borderColor: 'var(--border)', background: 'var(--brand-field)' }}
    >
      <p className="text-muted-foreground mb-1.5 text-xs">
        Proposed parents for <strong>{childLabel}</strong> — ratifying adds an unlit corner for
        players who haven&apos;t earned it; it never changes anyone&apos;s existing mastery.
      </p>
      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      {proposals === null && !error ? (
        <p className="text-muted-foreground animate-pulse text-xs">Asking Wikidata and the LLM…</p>
      ) : proposals !== null && proposals.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No suggestions — neither source knows this territory. Add a parent manually with + Child
          on the parent, or Move.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {(proposals ?? []).map((p) => (
            <li key={p.parentDomainKey} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate font-medium text-[var(--brand-ink)]">{p.label}</span>
              <span
                className="shrink-0 rounded-sm px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.06em]"
                style={
                  p.source === 'wikidata'
                    ? { color: 'var(--brand-navy)', background: 'var(--surface-2)' }
                    : { color: 'var(--text-muted)', background: 'var(--surface-2)' }
                }
                title={
                  p.source === 'wikidata'
                    ? `Wikidata entity ${p.qid} — direct is-a relation`
                    : 'Proposed by the near-ness LLM'
                }
              >
                {p.source === 'wikidata' ? `Wikidata ${p.qid}` : 'LLM'}
              </span>
              {p.description ? (
                <span className="text-muted-foreground min-w-0 truncate text-xs">{p.description}</span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={pendingKey !== null}
                  onClick={() => void ratify(p)}
                  className="inline-flex min-h-7 items-center rounded-md border px-2 text-xs font-medium disabled:opacity-40"
                  style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
                  title="Ratify: draw the containment edge under this parent"
                >
                  {pendingKey === p.parentDomainKey ? '…' : 'Ratify'}
                </button>
                <button
                  type="button"
                  disabled={pendingKey !== null}
                  onClick={() => reject(p)}
                  className="inline-flex min-h-7 items-center rounded-md border px-2 text-xs font-medium disabled:opacity-40"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  title="Discard this proposal — nothing is saved"
                >
                  Reject
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onClose}
        className="text-muted-foreground mt-1.5 text-xs underline-offset-2 hover:underline"
      >
        close
      </button>
    </div>
  );
}

// The structure suggester — the answer to "I don't even know what to do":
// one click asks the machine to DRAFT a grouping of the real corpus (the
// domains players actually hold), and each proposed group becomes a reviewable
// card — tune the bar, untick children that don't belong, Accept or Dismiss.
// §4 holds: proposals persist nothing; every node/edge is minted by Accept.
type SuggestedGroup = {
  parentLabel: string;
  broadCategory: string | null;
  suggestedThreshold: number;
  children: Array<{ label: string; machineDepth: number; humanAuthored: number }>;
};

function StructureSuggester({
  graphIsEmpty,
  onDone,
}: {
  graphIsEmpty: boolean;
  onDone: () => void;
}) {
  const [groups, setGroups] = useState<SuggestedGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ corpusSize: number; alreadyStructured: number } | null>(null);

  async function suggest() {
    if (loading) return;
    setLoading(true);
    setError(null);
    const res = await post({ action: 'propose_structure' });
    setLoading(false);
    if (!res.ok) {
      setError(
        res.status === 503
          ? 'The machine is unavailable right now — try again shortly.'
          : `Suggestion failed (${res.status}).`,
      );
      return;
    }
    const body = res.body as unknown as {
      groups: SuggestedGroup[];
      corpusSize: number;
      alreadyStructured: number;
    } | null;
    setGroups(body?.groups ?? []);
    setMeta(body ? { corpusSize: body.corpusSize, alreadyStructured: body.alreadyStructured } : null);
  }

  return (
    <section
      className="rounded-md border p-4 text-sm"
      style={{ borderColor: graphIsEmpty ? 'var(--brand-navy)' : 'var(--border)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-lg font-semibold text-[var(--brand-ink)]">
            {graphIsEmpty ? 'Start here' : 'Suggest more structure'}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-quiet leading-relaxed">
            {graphIsEmpty
              ? 'The machine drafts a structure from the territories players actually hold; you review each group — tune the bar, untick what doesn’t belong, accept or dismiss. Nothing is saved until you accept.'
              : 'Draft groupings for territories not yet in the graph. You verify every group before anything is saved.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void suggest()}
          disabled={loading}
          className="inline-flex min-h-11 items-center rounded-md border px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          {loading ? 'Drafting a structure…' : groups === null ? 'Suggest a structure' : 'Suggest again'}
        </button>
      </div>
      {loading ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Reading the corpus and grouping territories — this takes up to a minute.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-quiet" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      {groups !== null && !loading ? (
        groups.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-quiet">
            Nothing left to group{meta && meta.alreadyStructured > 0 ? ` — ${meta.alreadyStructured} labels are already structured` : ''}.
          </p>
        ) : (
          <SuggestionList
            groups={groups}
            meta={meta}
            onResolve={(parentLabel) =>
              setGroups((prev) => prev?.filter((g) => g.parentLabel !== parentLabel) ?? null)
            }
            onDone={onDone}
          />
        )
      ) : null}
    </section>
  );
}

function groupQuestionTotal(group: SuggestedGroup): number {
  return group.children.reduce((sum, c) => sum + c.machineDepth + c.humanAuthored, 0);
}

function SuggestionList({
  groups,
  meta,
  onResolve,
  onDone,
}: {
  groups: SuggestedGroup[];
  meta: { corpusSize: number; alreadyStructured: number } | null;
  onResolve: (parentLabel: string) => void;
  onDone: () => void;
}) {
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Biggest, most-confident groups first — the ones worth accepting on sight.
  const sorted = useMemo(
    () => [...groups].sort((a, b) => groupQuestionTotal(b) - groupQuestionTotal(a)),
    [groups],
  );

  // "High-confidence" = a substantial group (≥3 children AND ≥20 questions):
  // a real body of knowledge, not a thin pairing. These are safe to accept in
  // one gesture; the rest still get individual review.
  const highConfidence = sorted.filter(
    (g) => g.children.length >= 3 && groupQuestionTotal(g) >= 20,
  );

  async function acceptAllHighConfidence() {
    if (bulkPending || highConfidence.length === 0) return;
    setBulkPending(true);
    setBulkError(null);
    let failed = 0;
    for (const group of highConfidence) {
      const res = await post({
        action: 'ratify_structure_group',
        parentLabel: group.parentLabel,
        broadCategory: group.broadCategory,
        masteryThreshold: group.suggestedThreshold,
        childLabels: group.children.map((c) => c.label),
      });
      if (res.ok) onResolve(group.parentLabel);
      else failed += 1;
    }
    setBulkPending(false);
    if (failed > 0) setBulkError(`${failed} group${failed === 1 ? '' : 's'} didn’t save — review them below.`);
    onDone();
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {meta ? (
          <p className="text-muted-foreground text-xs">
            {groups.length} group{groups.length === 1 ? '' : 's'} from {meta.corpusSize} unstructured
            territories — biggest first. Tap one to review, or accept the obvious ones in bulk.
          </p>
        ) : null}
        {highConfidence.length > 0 ? (
          <button
            type="button"
            onClick={() => void acceptAllHighConfidence()}
            disabled={bulkPending}
            className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
          >
            {bulkPending ? 'Accepting…' : `Accept ${highConfidence.length} high-confidence`}
          </button>
        ) : null}
      </div>
      {bulkError ? (
        <p className="text-quiet" style={{ color: 'var(--danger)' }}>
          {bulkError}
        </p>
      ) : null}
      {sorted.map((group) => (
        <SuggestedGroupCard
          key={group.parentLabel}
          group={group}
          onResolved={() => {
            onResolve(group.parentLabel);
            onDone();
          }}
          onDismiss={() => onResolve(group.parentLabel)}
        />
      ))}
    </div>
  );
}

function SuggestedGroupCard({
  group,
  onResolved,
  onDismiss,
}: {
  group: SuggestedGroup;
  onResolved: () => void;
  onDismiss: () => void;
}) {
  const [threshold, setThreshold] = useState(String(group.suggestedThreshold));
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(group.children.map((c) => [c.label, true])),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const selectedCount = group.children.filter((c) => checked[c.label]).length;

  async function accept() {
    if (pending || selectedCount === 0) return;
    setPending(true);
    setError(null);
    const res = await post({
      action: 'ratify_structure_group',
      parentLabel: group.parentLabel,
      broadCategory: group.broadCategory,
      masteryThreshold: threshold.trim() ? Number(threshold) : null,
      childLabels: group.children.filter((c) => checked[c.label]).map((c) => c.label),
    });
    setPending(false);
    if (!res.ok) {
      setError(`Accept failed (${res.status}).`);
      return;
    }
    onResolved();
  }

  const total = group.children.reduce((sum, c) => sum + c.machineDepth + c.humanAuthored, 0);

  // Collapsed by default — a header you scan, expand to review, so 20+ groups
  // aren't a wall. Accept/Dismiss live on the header for a quick call.
  return (
    <div className="rounded-md border" style={{ borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden className="text-[var(--brand-ink-700)]">
            {open ? '▾' : '▸'}
          </span>
          <span className="min-w-0">
            <span className="font-serif text-base font-semibold text-[var(--brand-ink)]">
              {group.parentLabel}
            </span>
            <span className="text-muted-foreground ml-2 text-xs">
              {group.children.length} territories · {total} questions
              {group.broadCategory ? ` · ${group.broadCategory}` : ''}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void accept()}
          disabled={pending || selectedCount < 1}
          className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-40"
          style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
        >
          {pending ? 'Accepting…' : 'Accept'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={pending}
          className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-40"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          Dismiss
        </button>
      </div>

      {!open ? null : (
        <div className="border-t px-3 pb-3 pt-2" style={{ borderColor: 'var(--border)' }}>
          <label className="mb-2 flex items-center gap-1.5 text-xs text-[var(--brand-ink-700)]">
            Mastery bar
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-20 rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1 text-sm focus:border-[var(--brand-navy)]"
              inputMode="numeric"
              aria-label={`Mastery threshold for ${group.parentLabel}`}
            />
            pts
          </label>
          <ul className="space-y-1">
            {group.children.map((child) => (
          <li key={child.label} className="flex items-center gap-2 text-quiet">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={checked[child.label] ?? false}
                onChange={(e) => setChecked((prev) => ({ ...prev, [child.label]: e.target.checked }))}
              />
              <span className="text-[var(--brand-ink)]">{child.label}</span>
            </label>
            <span className="text-muted-foreground text-xs">
              {child.machineDepth + child.humanAuthored} questions
            </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-2 text-xs">
            {selectedCount} of {group.children.length} selected · accepting creates the parent, its
            leaves, and substantive edges.
          </p>
          {error ? (
            <p className="mt-1.5 text-quiet" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ADMIN P2 — the orphan check: structural gaps an author should see before
// they matter. A leaf with no substantive parent earns no roll-up anywhere; a
// parent with an empty roster has nothing to serve or gate on.
function OrphanCheck({
  nodes,
  edges,
}: {
  nodes: KnowledgeNodeRow[];
  edges: KnowledgeEdgeRow[];
}) {
  const childrenOfParent = new Map<string, number>();
  const substantiveParentsOfChild = new Map<string, number>();
  for (const edge of edges) {
    childrenOfParent.set(edge.parentDomainKey, (childrenOfParent.get(edge.parentDomainKey) ?? 0) + 1);
    substantiveParentsOfChild.set(
      edge.childDomainKey,
      (substantiveParentsOfChild.get(edge.childDomainKey) ?? 0) + 1,
    );
  }
  const orphanLeaves = nodes.filter(
    (n) => n.nodeKind !== 'parent' && !substantiveParentsOfChild.has(n.domainKey),
  );
  const emptyParents = nodes.filter(
    (n) => n.nodeKind !== 'leaf' && !childrenOfParent.has(n.domainKey),
  );

  if (orphanLeaves.length === 0 && emptyParents.length === 0) return null;

  return (
    <section className="mt-4 rounded-md border p-3 text-sm" style={{ borderColor: 'var(--border)' }}>
      <h2 className="mb-1 font-serif text-base font-semibold text-[var(--brand-ink)]">Orphans</h2>
      {orphanLeaves.length > 0 ? (
        <p className="text-muted-foreground text-quiet leading-relaxed">
          <span style={{ color: 'var(--warning)' }}>
            {orphanLeaves.length} leaf{orphanLeaves.length === 1 ? '' : 'ves'} with no substantive
            parent
          </span>{' '}
          (candidates needing an edge): {orphanLeaves.map((n) => n.label).join(' · ')}
        </p>
      ) : null}
      {emptyParents.length > 0 ? (
        <p className="text-muted-foreground mt-1 text-quiet leading-relaxed">
          <span style={{ color: 'var(--warning)' }}>
            {emptyParents.length} parent{emptyParents.length === 1 ? '' : 's'} with an empty roster
          </span>{' '}
          (nothing to serve): {emptyParents.map((n) => n.label).join(' · ')}
        </p>
      ) : null}
    </section>
  );
}

function EdgeComposer({ nodes, onDone }: { nodes: KnowledgeNodeRow[]; onDone: () => void }) {
  const [childKey, setChildKey] = useState('');
  const [parentKey, setParentKey] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const parents = nodes.filter((n) => n.nodeKind !== 'leaf');

  async function submit() {
    if (pending || !childKey || !parentKey) return;
    setPending(true);
    setNotice(null);
    const res = await post({ action: 'create_edge', childDomainKey: childKey, parentDomainKey: parentKey });
    setPending(false);
    if (!res.ok) {
      setNotice(
        res.body?.error === 'self_edge'
          ? 'A node cannot parent itself.'
          : res.body?.error === 'duplicate'
            ? 'That edge already exists.'
            : `Edge failed (${res.status}).`,
      );
      return;
    }
    setChildKey('');
    onDone();
  }

  const fieldClass =
    'rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1.5 text-sm focus:border-[var(--brand-navy)]';

  return (
    <section className="mt-6 rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
      <h2 className="mb-2 font-serif text-lg font-semibold text-[var(--brand-ink)]">Draw an edge</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Child</span>
          <select value={childKey} onChange={(e) => setChildKey(e.target.value)} className={fieldClass}>
            <option value="">Pick a child…</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.domainKey}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Parent</span>
          <select value={parentKey} onChange={(e) => setParentKey(e.target.value)} className={fieldClass}>
            <option value="">Pick a parent…</option>
            {(parents.length > 0 ? parents : nodes).map((n) => (
              <option key={n.id} value={n.domainKey}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || !childKey || !parentKey}
          className="inline-flex min-h-11 items-center rounded-md border px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          {pending ? 'Drawing…' : 'Draw edge'}
        </button>
      </div>
      {/* ADMIN P2 — the impact preview: the §B guarantee stated to the author
          before the commit, with the actual names in it. */}
      {childKey && parentKey && childKey !== parentKey ? (
        <p
          className="mt-2 rounded-md px-3 py-2 text-quiet leading-relaxed"
          style={{ background: 'var(--surface-2)', color: 'var(--brand-ink-700)' }}
        >
          Adding <strong>{nodes.find((n) => n.domainKey === childKey)?.label ?? childKey}</strong> to{' '}
          <strong>{nodes.find((n) => n.domainKey === parentKey)?.label ?? parentKey}</strong> adds an
          unlit corner — it will NOT change any player&apos;s existing mastery. Non-masters see the
          field grow honestly; masters stay masters.
        </p>
      ) : null}
      {notice ? (
        <p className="mt-2 text-quiet" style={{ color: 'var(--danger)' }}>
          {notice}
        </p>
      ) : null}
    </section>
  );
}

