'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

import type { KnowledgeEdgeRow, KnowledgeNodeRow } from '@/server/db/queries/knowledge-graph';
import { AdminTabs } from '@/app/admin/AdminTabs';

// B-KNOWLEDGE-ADMIN-01 P1 — nodes, edges, thresholds, edge types. Internal ops
// idiom (AdminReportsClient precedent). Every commit here is a deliberate
// human act (D-doc §4); the collision path surfaces the existing node instead
// of minting a sibling — the whole model exists to kill that failure mode.

const FIELD_HUES = [
  'literature',
  'music',
  'film-tv',
  'history',
  'science',
  'sports',
  'technology',
  'philosophy',
  'pop-culture',
  'food',
  'architecture',
  'language',
] as const;

const NODE_KINDS = ['leaf', 'parent', 'both'] as const;
const EDGE_TYPES = ['substantive', 'collection'] as const;

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

function hueSwatch(hue: string | null) {
  if (!hue) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
      <span
        className="inline-block size-3 rounded-full border"
        style={{ background: `var(--cat-${hue}, var(--border))`, borderColor: 'var(--border)' }}
        aria-hidden
      />
      {hue}
    </span>
  );
}

export function KnowledgeAdminClient({
  nodes,
  edges,
  depthByKey,
}: {
  nodes: KnowledgeNodeRow[];
  edges: KnowledgeEdgeRow[];
  depthByKey: Record<string, number>;
}) {
  const router = useRouter();
  const nodeByKey = useMemo(() => new Map(nodes.map((n) => [n.domainKey, n])), [nodes]);
  const edgesByParent = useMemo(() => {
    const map = new Map<string, KnowledgeEdgeRow[]>();
    for (const edge of edges) {
      const list = map.get(edge.parentDomainKey);
      if (list) list.push(edge);
      else map.set(edge.parentDomainKey, [edge]);
    }
    return map;
  }, [edges]);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="mb-3 font-serif text-2xl font-semibold text-[var(--brand-ink)]">
          Knowledge graph
        </h1>
        <AdminTabs active="knowledge" />
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          The territory structure — human-authored, always. Nodes are leaves/parents; a parent&apos;s
          <strong> mastery threshold</strong> is its absolute points bar (Medici ~100, Italian
          Renaissance ~2000). Edges are typed: <em>substantive</em> (depth counts toward
          understanding) vs <em>collection</em> (coverage only). Nothing here touches questions or
          any player&apos;s mastery.
        </p>
      </header>

      <StructureSuggester graphIsEmpty={nodes.length === 0} onDone={() => router.refresh()} />

      <KnowledgeTreeEditor
        nodes={nodes}
        edges={edges}
        depthByKey={depthByKey}
        onDone={() => router.refresh()}
      />

      {/* The form-based tools remain for edge-type work (collection edges),
          per-node LLM parent proposals, and bulk inspection — tucked away so
          the tree is the primary surface. */}
      <details className="mt-6">
        <summary className="text-muted-foreground cursor-pointer text-sm font-medium">
          Advanced tools (forms, collection edges, proposals, orphan check)
        </summary>
        <div className="mt-3 space-y-4">
          <NodeForm onDone={() => router.refresh()} />
          <OrphanCheck nodes={nodes} edges={edges} />
          <div className="space-y-2">
            {nodes.map((node) => (
              <NodeRow key={node.id} node={node} onDone={() => router.refresh()} />
            ))}
          </div>
          <EdgeComposer nodes={nodes} onDone={() => router.refresh()} />
          <section>
            <h2 className="mb-2 font-serif text-lg font-semibold text-[var(--brand-ink)]">
              Rosters ({edges.length} edge{edges.length === 1 ? '' : 's'})
            </h2>
            {edgesByParent.size === 0 ? (
              <p className="text-muted-foreground text-sm">No edges yet.</p>
            ) : (
              <div className="space-y-3">
                {[...edgesByParent.entries()].map(([parentKey, rows]) => (
                  <div key={parentKey} className="rounded-md border p-3 text-sm" style={{ borderColor: 'var(--border)' }}>
                    <p className="font-medium text-[var(--brand-ink)]">
                      {nodeByKey.get(parentKey)?.label ?? parentKey}
                      <span className="text-muted-foreground font-normal">
                        {' '}
                        · {rows.length} child{rows.length === 1 ? '' : 'ren'}
                        {nodeByKey.get(parentKey)?.masteryThreshold
                          ? ` · bar ${nodeByKey.get(parentKey)!.masteryThreshold} pts`
                          : ' · bar unset (code default)'}
                      </span>
                    </p>
                    <ul className="mt-2 space-y-1">
                      {rows.map((edge) => (
                        <EdgeRow
                          key={edge.id}
                          edge={edge}
                          childLabel={nodeByKey.get(edge.childDomainKey)?.label ?? edge.childDomainKey}
                          onDone={() => router.refresh()}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
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

type PickState = {
  mode: 'move' | 'copy';
  childKey: string;
  childLabel: string;
  fromParentKey: string | null;
} | null;

// A leaf under this many questions is "too small to stand alone" — the signal
// to condense it upward (Move it under a parent). Matches the exhaustion
// story: a thin leaf gets played out fast.
const THIN_LEAF_THRESHOLD = 6;

function KnowledgeTreeEditor({
  nodes,
  edges,
  depthByKey,
  onDone,
}: {
  nodes: KnowledgeNodeRow[];
  edges: KnowledgeEdgeRow[];
  depthByKey: Record<string, number>;
  onDone: () => void;
}) {
  const nodeByKey = useMemo(() => new Map(nodes.map((n) => [n.domainKey, n])), [nodes]);

  const { childrenByParent, parentCountByChild, roots, descendantsOf } = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    const parentCountByChild = new Map<string, number>();
    for (const edge of edges) {
      if (edge.edgeType !== 'substantive') continue;
      if (!nodeByKey.has(edge.childDomainKey) || !nodeByKey.has(edge.parentDomainKey)) continue;
      const list = childrenByParent.get(edge.parentDomainKey);
      if (list) list.push(edge.childDomainKey);
      else childrenByParent.set(edge.parentDomainKey, [edge.childDomainKey]);
      parentCountByChild.set(
        edge.childDomainKey,
        (parentCountByChild.get(edge.childDomainKey) ?? 0) + 1,
      );
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

    return { childrenByParent, parentCountByChild, roots, descendantsOf };
  }, [nodes, edges, nodeByKey]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(roots.filter((key) => childrenByParent.has(key))),
  );
  const [picking, setPicking] = useState<PickState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTopLabel, setNewTopLabel] = useState('');

  // Drag-and-drop state: the label of the row being dragged (for the overlay),
  // and the pending drop awaiting the human's Move-vs-Also-list choice.
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{
    childKey: string;
    childLabel: string;
    fromParentKey: string | null;
    toParentKey: string;
    toParentLabel: string;
  } | null>(null);

  // A tap must still expand / open the ⋯ menu — only a real drag (>8px) grabs.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const pickedSubtree = useMemo(
    () => (picking ? descendantsOf(picking.childKey) : new Set<string>()),
    [picking, descendantsOf],
  );

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { label?: string } | undefined;
    setDragLabel(data?.label ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragLabel(null);
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
      void act({
        action: 'delete_edge',
        childDomainKey: child.childKey,
        parentDomainKey: child.fromParentKey,
      });
      return;
    }

    const toParentKey = over.toParentKey;
    if (toParentKey === child.childKey) return; // onto itself
    if (child.fromParentKey === toParentKey) return; // already there
    if (descendantsOf(child.childKey).has(toParentKey)) {
      setError('Can’t place a territory inside its own subtree.');
      return;
    }
    // Offer Move vs Also-list (the multi-parent choice) at the drop.
    setError(null);
    setPendingDrop({
      childKey: child.childKey,
      childLabel: child.label,
      fromParentKey: child.fromParentKey,
      toParentKey,
      toParentLabel: over.toParentLabel,
    });
  }

  function commitDrop(mode: 'move' | 'copy') {
    if (!pendingDrop) return;
    const drop = pendingDrop;
    setPendingDrop(null);
    void act({
      action: 'attach_child',
      childDomainKey: drop.childKey,
      toParentDomainKey: drop.toParentKey,
      ...(mode === 'move' && drop.fromParentKey
        ? { moveFromParentDomainKey: drop.fromParentKey }
        : {}),
    });
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

      {/* Drop-choice — the multi-parent moment: Move re-files; Also list keeps
          the old home AND adds the new one. Fixed to the bottom so it's in
          reach no matter where in a long tree the drop happened. */}
      {pendingDrop ? (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3">
          <div
            className="flex w-full max-w-lg flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] shadow-[var(--shadow-overlay)]"
            style={{ background: 'var(--brand-card)', borderColor: 'var(--brand-navy)', color: 'var(--brand-ink-700)' }}
            aria-live="polite"
          >
            <span className="w-full sm:w-auto">
              Put <strong>{pendingDrop.childLabel}</strong> under{' '}
              <strong>{pendingDrop.toParentLabel}</strong>?
            </span>
            <button
              type="button"
              onClick={() => commitDrop('move')}
              disabled={busy}
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
            >
              Move here
            </button>
            <button
              type="button"
              onClick={() => commitDrop('copy')}
              disabled={busy}
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
              title="Keep it where it is and also list it here (lives under both)"
            >
              Also list here
            </button>
            <button
              type="button"
              onClick={() => setPendingDrop(null)}
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium"
              style={{ borderColor: 'var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {picking ? (
        <div
          className="mb-2 flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-[13px]"
          style={{ background: 'var(--warning-surface)', color: 'var(--brand-ink-700)' }}
          aria-live="polite"
        >
          <span>
            {picking.mode === 'move' ? 'Moving' : 'Copying'} <strong>{picking.childLabel}</strong> —
            tap “Place here” on the destination.
            {picking.mode === 'copy' ? ' It will live under both parents.' : ''}
          </span>
          {picking.mode === 'move' && picking.fromParentKey ? (
            <button
              type="button"
              onClick={makeTopLevel}
              disabled={busy}
              className="rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
            >
              Make top-level
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setPicking(null)}
            className="rounded-md border px-2 py-0.5 text-xs font-medium"
            style={{ borderColor: 'var(--border)' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <p className="text-muted-foreground mb-2 text-xs">
          Drag a row by its ⠿ handle onto another to nest it (or onto “top level” to un-nest).
          Dropping asks Move vs. Also-list (for territories that belong under two parents). Tap ⋯
          for the same actions plus edit.
        </p>
      )}
      {error ? (
        <p className="mb-2 text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <RootDropZone />
        <div className="rounded-md border py-1" style={{ borderColor: 'var(--border)' }}>
          {roots.length === 0 ? (
            <p className="text-muted-foreground px-3 py-2 text-sm">
              Nothing in the tree yet — accept a suggested group above or add a territory.
            </p>
          ) : (
            roots.map((key) => (
              <TreeRow
                key={key}
                nodeKey={key}
                parentKey={null}
                depth={0}
                ancestors={new Set()}
                nodeByKey={nodeByKey}
                depthByKey={depthByKey}
                childrenByParent={childrenByParent}
                parentCountByChild={parentCountByChild}
                expanded={expanded}
                setExpanded={setExpanded}
                picking={picking}
                pickedSubtree={pickedSubtree}
                busy={busy}
                onPick={setPicking}
                onPlace={placeInto}
                onAct={act}
                onDone={onDone}
              />
            ))
          )}
        </div>
        <DragOverlay>
          {dragLabel ? (
            <div
              className="rounded-md border px-3 py-1.5 text-sm font-medium shadow-[var(--shadow-card)]"
              style={{ background: 'var(--brand-card)', borderColor: 'var(--brand-navy)', color: 'var(--brand-ink)' }}
            >
              {dragLabel}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

// The drop target for un-nesting: drag a nested row here to make it top-level.
function RootDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: 'root-zone', data: { toParentKey: null } });
  return (
    <div
      ref={setNodeRef}
      className="mb-1 rounded-md border border-dashed px-3 py-2 text-center text-xs transition-colors"
      style={{
        borderColor: isOver ? 'var(--brand-navy)' : 'var(--border)',
        background: isOver ? 'var(--surface-2)' : 'transparent',
        color: 'var(--text-muted)',
      }}
    >
      top level — drop here to un-nest
    </div>
  );
}

function TreeRow({
  nodeKey,
  parentKey,
  depth,
  ancestors,
  nodeByKey,
  depthByKey,
  childrenByParent,
  parentCountByChild,
  expanded,
  setExpanded,
  picking,
  pickedSubtree,
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
  childrenByParent: Map<string, string[]>;
  parentCountByChild: Map<string, number>;
  expanded: Set<string>;
  setExpanded: (updater: (prev: Set<string>) => Set<string>) => void;
  picking: PickState;
  pickedSubtree: Set<string>;
  busy: boolean;
  onPick: (pick: PickState) => void;
  onPlace: (toParentKey: string) => void;
  onAct: (body: Record<string, unknown>) => Promise<void> | void;
  onDone: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childLabel, setChildLabel] = useState('');
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editBar, setEditBar] = useState('');
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

  const children = childrenByParent.get(nodeKey) ?? [];
  const isOpen = expanded.has(nodeKey);
  const parentCount = parentCountByChild.get(nodeKey) ?? 0;
  const isParentish = node.nodeKind !== 'leaf' || children.length > 0;

  const placeDisabled =
    !picking ||
    busy ||
    nodeKey === picking.childKey ||
    pickedSubtree.has(nodeKey) ||
    (picking.mode === 'move' && nodeKey === picking.fromParentKey);

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
      masteryThreshold: editBar.trim() ? Number(editBar) : null,
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

  return (
    <div>
      <div
        ref={setDropRef}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1.5 text-sm last:border-b-0"
        style={{
          borderColor: 'var(--border)',
          paddingLeft: `${8 + depth * 18}px`,
          opacity: isDragging ? 0.4 : 1,
          // Highlight a valid drop target as a drag hovers over it.
          background: isOver ? 'var(--surface-2)' : undefined,
          boxShadow: isOver ? 'inset 3px 0 0 var(--brand-navy)' : undefined,
        }}
      >
        {/* Drag handle — grab here to re-file the row. Its own control so a tap
            elsewhere on the row still expands / opens ⋯. */}
        <button
          type="button"
          ref={setDragRef}
          {...listeners}
          {...attributes}
          aria-label={`Drag ${node.label}`}
          className="cursor-grab touch-none text-[var(--text-muted)] active:cursor-grabbing"
          style={{ touchAction: 'none' }}
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
              value={editBar}
              onChange={(e) => setEditBar(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="bar"
              inputMode="numeric"
              className="w-16 rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-0.5 text-sm"
              aria-label="Mastery bar"
            />
            <button type="button" onClick={() => void saveEdit()} className={smallBtn} style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={smallBtn} style={{ borderColor: 'var(--border)' }}>
              Cancel
            </button>
          </span>
        ) : (
          <>
            <span className={isParentish ? 'font-medium text-[var(--brand-ink)]' : 'text-[var(--brand-ink)]'}>
              {node.label}
            </span>
            <span className="text-muted-foreground text-xs">
              {node.nodeKind !== 'leaf'
                ? node.masteryThreshold
                  ? `bar ${node.masteryThreshold}`
                  : 'bar unset'
                : `${depthByKey[nodeKey] ?? 0} Qs`}
              {parentCount > 1 ? ` · in ${parentCount} trees` : ''}
            </span>
            {/* "This is too small" — a thin leaf that isn't already nested is a
                condense-me candidate (Move it under a parent). */}
            {!isParentish && (depthByKey[nodeKey] ?? 0) < THIN_LEAF_THRESHOLD && parentCount === 0 ? (
              <span
                className="rounded-sm px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.06em]"
                style={{ color: 'var(--warning)', background: 'var(--warning-surface)' }}
                title="Too few questions to stand alone — Move it under a broader parent"
              >
                thin
              </span>
            ) : null}
          </>
        )}

        <span className="ml-auto flex items-center gap-1">
          {picking ? (
            <button
              type="button"
              onClick={() => onPlace(nodeKey)}
              disabled={placeDisabled}
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-40"
              style={
                placeDisabled
                  ? { borderColor: 'var(--border)', color: 'var(--text-muted)' }
                  : { borderColor: 'var(--success)', color: 'var(--success)' }
              }
            >
              Place here
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
                setEditBar(node.masteryThreshold?.toString() ?? '');
              }}
              className={menuBtn}
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Edit
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
              childrenByParent={childrenByParent}
              parentCountByChild={parentCountByChild}
              expanded={expanded}
              setExpanded={setExpanded}
              picking={picking}
              pickedSubtree={pickedSubtree}
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
          <p className="text-muted-foreground mt-0.5 text-[13px] leading-relaxed">
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
        <p className="mt-2 text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      {groups !== null && !loading ? (
        groups.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-[13px]">
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
        <p className="text-[13px]" style={{ color: 'var(--danger)' }}>
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
          <li key={child.label} className="flex items-center gap-2 text-[13px]">
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
            <p className="mt-1.5 text-[13px]" style={{ color: 'var(--danger)' }}>
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
    if (edge.edgeType === 'substantive') {
      substantiveParentsOfChild.set(
        edge.childDomainKey,
        (substantiveParentsOfChild.get(edge.childDomainKey) ?? 0) + 1,
      );
    }
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
        <p className="text-muted-foreground text-[13px] leading-relaxed">
          <span style={{ color: 'var(--warning)' }}>
            {orphanLeaves.length} leaf{orphanLeaves.length === 1 ? '' : 'ves'} with no substantive
            parent
          </span>{' '}
          (candidates needing an edge): {orphanLeaves.map((n) => n.label).join(' · ')}
        </p>
      ) : null}
      {emptyParents.length > 0 ? (
        <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
          <span style={{ color: 'var(--warning)' }}>
            {emptyParents.length} parent{emptyParents.length === 1 ? '' : 's'} with an empty roster
          </span>{' '}
          (nothing to serve): {emptyParents.map((n) => n.label).join(' · ')}
        </p>
      ) : null}
    </section>
  );
}

function NodeForm({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState('');
  const [nodeKind, setNodeKind] = useState<(typeof NODE_KINDS)[number]>('leaf');
  const [threshold, setThreshold] = useState('');
  const [fieldHue, setFieldHue] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    if (pending || !label.trim()) return;
    setPending(true);
    setNotice(null);
    const res = await post({
      action: 'create_node',
      label: label.trim(),
      nodeKind,
      masteryThreshold: threshold.trim() ? Number(threshold) : null,
      fieldHue: fieldHue || null,
    });
    setPending(false);
    if (res.status === 409) {
      // The fragmentation tripwire — surface the existing node, offer edit.
      setNotice(
        `"${label.trim()}" folds onto the existing node "${res.body?.existing?.label ?? 'unknown'}" — edit that one below instead of minting a duplicate.`,
      );
      return;
    }
    if (!res.ok) {
      setNotice(`Create failed (${res.status}).`);
      return;
    }
    setLabel('');
    setThreshold('');
    onDone();
  }

  const fieldClass =
    'rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1.5 text-sm focus:border-[var(--brand-navy)]';

  return (
    <section className="rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
      <h2 className="mb-2 font-serif text-lg font-semibold text-[var(--brand-ink)]">Add a node</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={fieldClass} placeholder="Renaissance Italy" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Kind</span>
          <select value={nodeKind} onChange={(e) => setNodeKind(e.target.value as (typeof NODE_KINDS)[number])} className={fieldClass}>
            {NODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-32 flex-col gap-1">
          <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Mastery bar (pts)</span>
          <input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, ''))}
            className={fieldClass}
            placeholder="2000"
            inputMode="numeric"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Field hue</span>
          <select value={fieldHue} onChange={(e) => setFieldHue(e.target.value)} className={fieldClass}>
            <option value="">(none)</option>
            {FIELD_HUES.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || !label.trim()}
          className="inline-flex min-h-11 items-center rounded-md border px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          {pending ? 'Adding…' : 'Add node'}
        </button>
      </div>
      {notice ? (
        <p className="mt-2 rounded-md px-3 py-2 text-[13px]" style={{ background: 'var(--warning-surface)', color: 'var(--brand-ink-700)' }}>
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function NodeRow({ node, onDone }: { node: KnowledgeNodeRow; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const [label, setLabel] = useState(node.label);
  const [nodeKind, setNodeKind] = useState(node.nodeKind);
  const [threshold, setThreshold] = useState(node.masteryThreshold?.toString() ?? '');
  const [fieldHue, setFieldHue] = useState(node.fieldHue ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await post({
      action: 'edit_node',
      id: node.id,
      label: label.trim() || undefined,
      nodeKind,
      masteryThreshold: threshold.trim() ? Number(threshold) : null,
      fieldHue: fieldHue || null,
    });
    setPending(false);
    if (res.status === 409) {
      setError(`That label folds onto "${res.body?.existing?.label ?? 'another node'}" — pick a distinct one.`);
      return;
    }
    if (!res.ok) {
      setError(`Save failed (${res.status}).`);
      return;
    }
    setEditing(false);
    onDone();
  }

  const fieldClass =
    'rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1 text-sm focus:border-[var(--brand-navy)]';

  if (!editing) {
    return (
      <div className="rounded-md border p-3 text-sm" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <span className="font-medium text-[var(--brand-ink)]">{node.label}</span>
            <span className="text-muted-foreground">
              {' '}
              · {node.nodeKind} ·{' '}
              {node.masteryThreshold ? `bar ${node.masteryThreshold} pts` : 'bar unset'}
            </span>{' '}
            {hueSwatch(node.fieldHue)}
          </div>
          {node.nodeKind !== 'parent' ? (
            <button
              type="button"
              onClick={() => setProposalsOpen((v) => !v)}
              className="rounded-md border px-3 py-1.5 text-sm font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            >
              Propose parents
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          >
            Edit
          </button>
        </div>
        {proposalsOpen ? <ProposalQueue node={node} onDone={onDone} /> : null}
      </div>
    );
  }

  return (
    <div className="rounded-md border p-3 text-sm" style={{ borderColor: 'var(--brand-navy)' }}>
      <div className="flex flex-wrap items-end gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={`${fieldClass} min-w-40 flex-1`} aria-label="Label" />
        <select value={nodeKind} onChange={(e) => setNodeKind(e.target.value as typeof node.nodeKind)} className={fieldClass} aria-label="Kind">
          {NODE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          value={threshold}
          onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, ''))}
          className={`${fieldClass} w-28`}
          placeholder="bar (pts)"
          inputMode="numeric"
          aria-label="Mastery threshold"
        />
        <select value={fieldHue} onChange={(e) => setFieldHue(e.target.value)} className={fieldClass} aria-label="Field hue">
          <option value="">(none)</option>
          {FIELD_HUES.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void save()}
          disabled={pending}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--border)' }}
        >
          Cancel
        </button>
      </div>
      <p className="text-muted-foreground mt-1.5 text-[0.7rem]">
        Renaming keeps the node&apos;s edges (they follow the new key).
      </p>
      {/* ADMIN P2 — threshold-edit warning: lowering can only let players
          cross sooner; it never revokes (§5 — the P4 freeze is terminal). */}
      {node.masteryThreshold !== null &&
      threshold.trim() &&
      Number(threshold) < node.masteryThreshold ? (
        <p
          className="mt-1.5 rounded-md px-3 py-2 text-[13px] leading-relaxed"
          style={{ background: 'var(--warning-surface)', color: 'var(--brand-ink-700)' }}
        >
          Lowering the bar from {node.masteryThreshold} to {Number(threshold)}: players past the
          new bar may cross on their next play; nobody&apos;s earned mastery is ever revoked.
        </p>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ADMIN P3 — the LLM proposal queue: the near-ness tree PROPOSES parent edges
// for a leaf; a human ratifies (picking the edge type — the machine never
// decides how credit accrues) or rejects (writes nothing, client-side
// discard). Empty when nothing is cached — manual authoring is always enough.
type Proposal = {
  label: string;
  broadCategory: string | null;
  rung: string;
  parentDomainKey: string;
};

function ProposalQueue({ node, onDone }: { node: KnowledgeNodeRow; onDone: () => void }) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [typeByKey, setTypeByKey] = useState<Record<string, 'substantive' | 'collection'>>({});
  const [error, setError] = useState<string | null>(null);

  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      setLoading(true);
      const res = await post({ action: 'propose', childLabel: node.label });
      setLoading(false);
      if (!res.ok) {
        setError(`Proposals failed (${res.status}).`);
        return;
      }
      setProposals(((res.body as { proposals?: Proposal[] } | null)?.proposals ?? []) as Proposal[]);
    })();
  }, [node.label]);

  async function ratify(proposal: Proposal) {
    const res = await post({
      action: 'ratify',
      childDomainKey: node.domainKey,
      parentLabel: proposal.label,
      parentBroadCategory: proposal.broadCategory,
      edgeType: typeByKey[proposal.parentDomainKey] ?? 'substantive',
    });
    if (!res.ok && res.status !== 409) {
      setError(`Ratify failed (${res.status}).`);
      return;
    }
    setProposals((prev) => prev?.filter((p) => p.parentDomainKey !== proposal.parentDomainKey) ?? null);
    onDone();
  }

  function reject(proposal: Proposal) {
    // Reject writes nothing — the proposal simply leaves the queue.
    setProposals((prev) => prev?.filter((p) => p.parentDomainKey !== proposal.parentDomainKey) ?? null);
  }

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
      <p className="text-muted-foreground mb-2 text-xs">
        Machine-proposed parents for <strong>{node.label}</strong> — suggestions only; nothing is
        committed until you ratify, and you pick how credit accrues.
      </p>
      {loading || proposals === null ? (
        <p className="text-muted-foreground text-xs">Asking the near-ness tree…</p>
      ) : proposals.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Nothing proposed (no cached near-ness for this domain) — draw an edge manually above.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {proposals.map((proposal) => (
            <li key={proposal.parentDomainKey} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--brand-ink)]">{proposal.label}</span>
              <span className="text-muted-foreground">({proposal.rung})</span>
              <select
                value={typeByKey[proposal.parentDomainKey] ?? 'substantive'}
                onChange={(e) =>
                  setTypeByKey((prev) => ({
                    ...prev,
                    [proposal.parentDomainKey]: e.target.value as 'substantive' | 'collection',
                  }))
                }
                className="rounded-md border bg-[var(--brand-field)] px-1.5 py-1 text-xs"
                style={{ borderColor: 'var(--border)' }}
                aria-label={`Edge type for ${proposal.label}`}
              >
                <option value="substantive">substantive</option>
                <option value="collection">collection</option>
              </select>
              <button
                type="button"
                onClick={() => void ratify(proposal)}
                className="rounded-md border px-2.5 py-1 text-xs font-medium"
                style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
              >
                Ratify
              </button>
              <button
                type="button"
                onClick={() => reject(proposal)}
                className="rounded-md border px-2.5 py-1 text-xs font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                Reject
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function EdgeComposer({ nodes, onDone }: { nodes: KnowledgeNodeRow[]; onDone: () => void }) {
  const [childKey, setChildKey] = useState('');
  const [parentKey, setParentKey] = useState('');
  const [edgeType, setEdgeType] = useState<(typeof EDGE_TYPES)[number]>('substantive');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const parents = nodes.filter((n) => n.nodeKind !== 'leaf');

  async function submit() {
    if (pending || !childKey || !parentKey) return;
    setPending(true);
    setNotice(null);
    const res = await post({ action: 'create_edge', childDomainKey: childKey, parentDomainKey: parentKey, edgeType });
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
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Type</span>
          <select value={edgeType} onChange={(e) => setEdgeType(e.target.value as (typeof EDGE_TYPES)[number])} className={fieldClass}>
            {EDGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
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
      <p className="text-muted-foreground mt-1.5 text-[0.7rem]">
        substantive = depth counts toward understanding the parent · collection = each member covered
        lights one slot.
      </p>
      {/* ADMIN P2 — the impact preview: the §B guarantee stated to the author
          before the commit, with the actual names in it. */}
      {childKey && parentKey && childKey !== parentKey ? (
        <p
          className="mt-2 rounded-md px-3 py-2 text-[13px] leading-relaxed"
          style={{ background: 'var(--surface-2)', color: 'var(--brand-ink-700)' }}
        >
          Adding <strong>{nodes.find((n) => n.domainKey === childKey)?.label ?? childKey}</strong> to{' '}
          <strong>{nodes.find((n) => n.domainKey === parentKey)?.label ?? parentKey}</strong> adds an
          unlit corner — it will NOT change any player&apos;s existing mastery. Non-masters see the
          field grow honestly; masters stay masters.
        </p>
      ) : null}
      {notice ? (
        <p className="mt-2 text-[13px]" style={{ color: 'var(--danger)' }}>
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function EdgeRow({
  edge,
  childLabel,
  onDone,
}: {
  edge: KnowledgeEdgeRow;
  childLabel: string;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);

  async function remove() {
    if (pending) return;
    setPending(true);
    const res = await post({
      action: 'delete_edge',
      childDomainKey: edge.childDomainKey,
      parentDomainKey: edge.parentDomainKey,
    });
    setPending(false);
    if (res.ok) onDone();
  }

  return (
    <li className="flex items-center gap-2">
      <span className="text-[var(--brand-ink)]">{childLabel}</span>
      <span
        className="rounded-full px-2 py-0.5 text-[0.65rem]"
        style={
          edge.edgeType === 'substantive'
            ? { color: 'var(--brand-navy)', background: 'var(--surface-2)' }
            : { color: 'var(--warning)', background: 'var(--warning-surface)' }
        }
      >
        {edge.edgeType}
      </span>
      <button
        type="button"
        onClick={() => void remove()}
        disabled={pending}
        className="text-muted-foreground ml-auto text-xs underline-offset-2 hover:underline disabled:opacity-50"
        aria-label={`Remove ${childLabel} from this roster`}
      >
        {pending ? 'removing…' : 'remove'}
      </button>
    </li>
  );
}
