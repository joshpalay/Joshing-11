'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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
}: {
  nodes: KnowledgeNodeRow[];
  edges: KnowledgeEdgeRow[];
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

      <NodeForm onDone={() => router.refresh()} />

      <section className="mt-6">
        <h2 className="mb-2 font-serif text-lg font-semibold text-[var(--brand-ink)]">
          Nodes ({nodes.length})
        </h2>
        {nodes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing authored yet — the graph is empty until you add the first node.
          </p>
        ) : (
          <div className="space-y-2">
            {nodes.map((node) => (
              <NodeRow key={node.id} node={node} onDone={() => router.refresh()} />
            ))}
          </div>
        )}
      </section>

      <EdgeComposer nodes={nodes} onDone={() => router.refresh()} />

      <section className="mt-6">
        <h2 className="mb-2 font-serif text-lg font-semibold text-[var(--brand-ink)]">
          Rosters ({edges.length} edge{edges.length === 1 ? '' : 's'})
        </h2>
        {edgesByParent.size === 0 ? (
          <p className="text-muted-foreground text-sm">No edges yet — draw the first one above.</p>
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
    </main>
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
      <div className="flex items-center gap-3 rounded-md border p-3 text-sm" style={{ borderColor: 'var(--border)' }}>
        <div className="min-w-0 flex-1">
          <span className="font-medium text-[var(--brand-ink)]">{node.label}</span>
          <span className="text-muted-foreground">
            {' '}
            · {node.nodeKind} ·{' '}
            {node.masteryThreshold ? `bar ${node.masteryThreshold} pts` : 'bar unset'}
          </span>{' '}
          {hueSwatch(node.fieldHue)}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border px-3 py-1.5 text-sm font-medium"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          Edit
        </button>
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
        Renaming keeps the node&apos;s edges (they follow the new key). Lowering a bar never revokes
        anyone&apos;s earned mastery.
      </p>
      {error ? (
        <p className="mt-1.5 text-[13px]" style={{ color: 'var(--danger)' }}>
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
        lights one slot. Adding a child only adds an unlit corner — it never recomputes anyone&apos;s
        mastery.
      </p>
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
