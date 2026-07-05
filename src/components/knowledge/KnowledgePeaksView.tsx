'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronRight, Plus, X } from 'lucide-react';

import type { KnowledgeTreeNode } from '@/server/knowledge/knowledge-tree';
import { adoptDomain } from '@/components/knowledge/adopt';

// D-KNOWLEDGE-MAP-USABILITY-01 (leaf-first follow-up) — the "New" knowledge
// view. Where the bubble map leads with rolled-up parent clusters, this leads
// with the specific things you're smart at (Hamlet, the WTC, Wagner's Ring
// Cycle) as trophies. Tapping a peak shows where it rolls UP to (its parent
// area) and the sibling areas you could ADD next. Same tree data as the map,
// same confirmed-add path — nothing here is a new endpoint or new mastery math.

const TOP_PEAKS = 10;

function fieldColor(field: string | null | undefined): string {
  return field ? `var(--cat-${field}, var(--brand-ink-400))` : 'var(--brand-ink-400)';
}

function formatPts(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function quizHref(name: string): string {
  return `/daily/setup?domainMode=custom&domain=${encodeURIComponent(name)}`;
}

function isOwnedLeaf(node: KnowledgeTreeNode): boolean {
  return (
    !node.ghost && (node.value ?? 0) > 0 && (!node.children || node.children.length === 0)
  );
}

type LeafInfo = {
  node: KnowledgeTreeNode;
  /** Non-root ancestors, top area → leaf's immediate parent (excludes the leaf). */
  path: KnowledgeTreeNode[];
  parent: KnowledgeTreeNode | null;
  topParent: KnowledgeTreeNode | null;
};

// One walk of the tree: every owned terminal leaf with its lineage. Parents
// carry their child roster inline, so siblings (owned + addable ghosts) come
// straight off `parent.children` at render time.
function indexLeaves(tree: KnowledgeTreeNode): LeafInfo[] {
  const out: LeafInfo[] = [];
  const walk = (node: KnowledgeTreeNode, ancestors: KnowledgeTreeNode[]) => {
    if (isOwnedLeaf(node)) {
      const path = ancestors.slice(1); // drop synthetic root
      out.push({
        node,
        path,
        parent: ancestors.at(-1) ?? null,
        topParent: path[0] ?? null,
      });
    }
    for (const child of node.children ?? []) walk(child, [...ancestors, node]);
  };
  walk(tree, []);
  return out;
}

export function KnowledgePeaksView({
  data,
  variant = 'own',
}: {
  data: KnowledgeTreeNode;
  variant?: 'own' | 'friend';
}) {
  const [tree, setTree] = useState<KnowledgeTreeNode>(data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const leaves = useMemo(() => indexLeaves(tree), [tree]);
  const sorted = useMemo(
    () => [...leaves].sort((a, b) => (b.node.value ?? 0) - (a.node.value ?? 0)),
    [leaves],
  );
  const top = sorted.slice(0, TOP_PEAKS);
  const selected = selectedId ? leaves.find((l) => l.node.id === selectedId) ?? null : null;

  // Full picture, grouped by top area — the "see everything" expansion.
  const groups = useMemo(() => {
    const byTop = new Map<string, { title: string; field: string | null; leaves: LeafInfo[] }>();
    const standalone: LeafInfo[] = [];
    for (const leaf of sorted) {
      if (leaf.topParent) {
        const key = leaf.topParent.id;
        const g = byTop.get(key);
        if (g) g.leaves.push(leaf);
        else byTop.set(key, { title: leaf.topParent.name, field: leaf.topParent.field, leaves: [leaf] });
      } else {
        standalone.push(leaf);
      }
    }
    const list = [...byTop.values()].sort(
      (a, b) =>
        b.leaves.reduce((s, l) => s + (l.node.value ?? 0), 0) -
        a.leaves.reduce((s, l) => s + (l.node.value ?? 0), 0),
    );
    if (standalone.length > 0) list.push({ title: 'More', field: null, leaves: standalone });
    return list;
  }, [sorted]);

  // Optimistic confirmed add: flip the ghost sibling into a real leaf so it
  // jumps from "add next" to owned; revert on failure. Mirrors the bubble map.
  const adoptNode = useCallback(async (id: string, name: string): Promise<boolean> => {
    const flip = (node: KnowledgeTreeNode, ghost: boolean, value: number): KnowledgeTreeNode =>
      node.id === id
        ? { ...node, ghost: ghost || undefined, value }
        : { ...node, children: node.children?.map((c) => flip(c, ghost, value)) };
    setTree((prev) => flip(prev, false, 1));
    const ok = await adoptDomain(name);
    if (!ok) setTree((prev) => flip(prev, true, 40));
    return ok;
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-40">
        <p className="pb-3 pt-1 text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">
          What you’re smart at
        </p>

        {top.length === 0 ? (
          <p className="py-10 text-center font-serif text-[var(--text-muted)]">
            Answer and write questions and your peaks will show up here.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {top.map((leaf) => {
              const mastered = Boolean(leaf.node.mastered);
              const active = leaf.node.id === selectedId;
              return (
                <button
                  key={leaf.node.id}
                  type="button"
                  onClick={() => setSelectedId(active ? null : leaf.node.id)}
                  aria-pressed={active}
                  className="group flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  style={{
                    borderColor: active ? 'var(--brand-navy)' : 'var(--border)',
                    background: 'var(--brand-card)',
                    borderLeftWidth: 4,
                    borderLeftColor: mastered ? 'var(--accent-gold)' : fieldColor(leaf.node.field),
                  }}
                >
                  <span className="font-serif text-[15px] leading-tight text-[var(--brand-ink)]">
                    {leaf.node.name}
                  </span>
                  <span className="mt-auto text-[11px] text-[var(--text-muted)]">
                    {mastered ? 'Mastery · ' : ''}
                    {formatPts(leaf.node.value ?? 0)} pts
                  </span>
                  {leaf.topParent ? (
                    <span className="truncate text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                      {leaf.topParent.name}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        {sorted.length > top.length ? (
          <div className="pt-4">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-sm text-[var(--brand-navy)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showAll ? 'Show fewer' : `See all ${sorted.length} things you know`}
            </button>
          </div>
        ) : null}

        {showAll ? (
          <div className="pt-2" aria-label="Everything you know, by area">
            {groups.map((group) => (
              <section key={group.title} className="pb-1">
                <h3 className="flex items-center gap-2 pb-1 pt-3 text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full"
                    style={{ background: fieldColor(group.field) }}
                  />
                  {group.title}
                </h3>
                <div role="list">
                  {group.leaves.map((leaf) => (
                    <button
                      key={leaf.node.id}
                      type="button"
                      role="listitem"
                      onClick={() => setSelectedId(leaf.node.id)}
                      className="flex w-full items-center gap-2.5 border-b py-2.5 text-left text-sm hover:bg-[var(--brand-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <span
                        aria-hidden
                        className="size-3 flex-none rounded-full"
                        style={{
                          background: leaf.node.mastered
                            ? 'var(--accent-gold)'
                            : fieldColor(leaf.node.field),
                        }}
                      />
                      <span className="font-serif text-base text-[var(--brand-ink)]">{leaf.node.name}</span>
                      <span className="ml-auto text-xs text-[var(--text-muted)]">
                        {leaf.node.mastered ? 'Mastery · ' : ''}
                        {formatPts(leaf.node.value ?? 0)} pts
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>

      {selected ? (
        <div className="absolute inset-x-0 bottom-0 z-10 px-1 pb-1">
          <PeakDetailCard
            key={selected.node.id}
            leaf={selected}
            variant={variant}
            onClose={() => setSelectedId(null)}
            onSelectSibling={(id) => setSelectedId(id)}
            onAdd={variant === 'own' ? adoptNode : async () => false}
          />
        </div>
      ) : null}
    </div>
  );
}

type AddPhase =
  | { step: 'idle' }
  | { step: 'confirm'; id: string; name: string }
  | { step: 'adding'; id: string; name: string }
  | { step: 'added'; id: string; name: string }
  | { step: 'failed'; id: string; name: string };

// The leaf-first detail: identity, the rollup PATH, and the sibling roster —
// owned siblings you can jump to, plus addable ghosts (the "grow it next" move).
function PeakDetailCard({
  leaf,
  variant,
  onClose,
  onSelectSibling,
  onAdd,
}: {
  leaf: LeafInfo;
  variant: 'own' | 'friend';
  onClose: () => void;
  onSelectSibling: (id: string) => void;
  onAdd: (id: string, name: string) => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<AddPhase>({ step: 'idle' });
  const node = leaf.node;
  const parent = leaf.parent;
  const siblings = (parent?.children ?? []).filter((c) => c.id !== node.id);
  const ownedSiblings = siblings.filter((c) => !c.ghost && (c.value ?? 0) > 0);
  const ghostSiblings = siblings.filter((c) => c.ghost);

  const actionButton =
    'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  const confirmAdd = async (id: string, name: string) => {
    setPhase({ step: 'adding', id, name });
    const ok = await onAdd(id, name);
    setPhase({ step: ok ? 'added' : 'failed', id, name });
  };

  const card = (children: ReactNode) => (
    <section
      aria-label={`${node.name} details`}
      className="rounded-xl border p-4 shadow-lg"
      style={{ borderColor: 'var(--border)', background: 'var(--brand-card)' }}
    >
      {children}
    </section>
  );

  // ── Add confirm / added / failed take over the card body (C1) ──────────────
  if (phase.step !== 'idle') {
    const { name } = phase;
    return card(
      phase.step === 'confirm' ? (
        <>
          <p className="font-serif text-base text-[var(--brand-ink)]">
            Add <strong>{name}</strong> to your map?
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Questions will start appearing in your Daily Five.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void confirmAdd(phase.id, name)}
              className={actionButton}
              style={{ borderColor: 'var(--brand-navy)', background: 'var(--brand-navy)', color: 'var(--brand-card)' }}
            >
              <Plus className="size-4" aria-hidden /> Add it
            </button>
            <button
              type="button"
              onClick={() => setPhase({ step: 'idle' })}
              className={actionButton}
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            >
              Not now
            </button>
          </div>
        </>
      ) : phase.step === 'adding' ? (
        <p className="font-serif text-base text-[var(--brand-ink)]" aria-live="polite">
          Adding {name}…
        </p>
      ) : phase.step === 'added' ? (
        <>
          <p className="font-serif text-base text-[var(--brand-ink)]" aria-live="polite">
            <strong>{name}</strong> is on your map.
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Questions will start appearing in your Daily Five — or dive in right now.
          </p>
          <div className="mt-3 flex gap-2">
            <Link
              href={quizHref(name)}
              className={actionButton}
              style={{ borderColor: 'var(--brand-navy)', background: 'var(--brand-navy)', color: 'var(--brand-card)' }}
            >
              Quiz me now <ArrowUpRight className="size-4" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={() => setPhase({ step: 'idle' })}
              className={actionButton}
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            >
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="font-serif text-base text-[var(--brand-ink)]" aria-live="polite">
            Couldn’t add {name} just now.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void confirmAdd(phase.id, name)}
              className={actionButton}
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => setPhase({ step: 'idle' })}
              className={actionButton}
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            >
              Back
            </button>
          </div>
        </>
      ),
    );
  }

  return card(
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Where this rolls up to (leaf-first: the path is the point). */}
          {leaf.path.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              {leaf.path.map((ancestor, i) => (
                <span key={ancestor.id} className="flex items-center gap-1">
                  {i > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
                  {ancestor.name}
                </span>
              ))}
            </p>
          ) : null}
          <p className="mt-1 flex items-center gap-2 font-serif text-lg text-[var(--brand-ink)]">
            <span
              aria-hidden
              className="size-3.5 flex-none rounded-full"
              style={{ background: node.mastered ? 'var(--accent-gold)' : fieldColor(node.field) }}
            />
            <strong className="truncate">{node.name}</strong>
          </p>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            {formatPts(node.value ?? 0)} pts{node.mastered ? ' · Mastery' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-8 flex-none place-items-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {variant === 'own' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/knowledge/${encodeURIComponent(node.name)}`}
            className={actionButton}
            style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
          >
            View details
          </Link>
          <Link
            href={quizHref(node.name)}
            className={actionButton}
            style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
          >
            Quiz me here
          </Link>
        </div>
      ) : null}

      {/* Siblings — where it sits, and what's next to add inside the same area. */}
      {parent && (ownedSiblings.length > 0 || ghostSiblings.length > 0) ? (
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">
            More in {parent.name}
          </p>
          {ownedSiblings.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ownedSiblings.map((sib) => (
                <button
                  key={sib.id}
                  type="button"
                  onClick={() => onSelectSibling(sib.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ borderColor: 'var(--border)', background: 'var(--brand-card)' }}
                >
                  <span
                    aria-hidden
                    className="size-3 rounded-full"
                    style={{ background: sib.mastered ? 'var(--accent-gold)' : fieldColor(sib.field) }}
                  />
                  <span className="font-serif text-[var(--brand-ink)]">{sib.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          {variant === 'own' && ghostSiblings.length > 0 ? (
            <ul className="mt-2 grid gap-1.5">
              {ghostSiblings.map((ghost) => (
                <li key={ghost.id} className="flex items-center justify-between gap-2">
                  <span className="truncate font-serif text-sm text-[var(--brand-ink)]">
                    {ghost.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPhase({ step: 'confirm', id: ghost.id, name: ghost.name })}
                    className="inline-flex min-h-8 flex-none items-center gap-1 rounded-full border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                  >
                    <Plus className="size-3.5" aria-hidden /> Add
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>,
  );
}
