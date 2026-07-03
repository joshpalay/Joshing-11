'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowUp } from 'lucide-react';
import { hierarchy, pack, type HierarchyCircularNode } from 'd3-hierarchy';

import type { CollectionSummary, KnowledgeTreeNode } from '@/server/knowledge/knowledge-tree';
import { KnowledgeNodeCard, type SelectedNodeInfo } from '@/components/knowledge/KnowledgeNodeCard';

// B-KNOWLEDGE-TAXONOMY-01 P5 — the nested circle-pack knowledge map, ported
// from the ratified knowledge-bubbles prototype onto the repo's design
// language: brand tokens (--brand-*, --cat-*, --accent-gold), serif labels,
// focus rings, reduced-motion respected. Leaves are the bright foreground;
// parents are faint containment; ghosts are dashed invitations. Mastery is
// gold fill PLUS the "Mastery" label — never color alone.
//
// D-KNOWLEDGE-MAP-USABILITY-01 (B1/C1): a tap SELECTS a node and raises the
// action card; diving, viewing details, and adding are explicit actions there.
// No navigation tap mutates state, and adding is always confirmed.

type PackedNode = HierarchyCircularNode<KnowledgeTreeNode>;

function fieldColor(field: string | null | undefined): string {
  return field ? `var(--cat-${field}, var(--brand-ink-400))` : 'var(--brand-ink-400)';
}

function subscribeReducedMotion(callback: () => void): () => void {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

// Adopt endpoint (the territory-adopt path): sets the ghost domain's Daily
// Five frequency, which folds it into the knowledge base rotation.
async function adoptDomain(domain: string): Promise<boolean> {
  try {
    const res = await fetch('/api/daily/preferences/domain-frequency', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ domain, frequency: 'sometimes' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// One list section per top-level territory: the parent's own framing plus its
// non-ghost descendant leaves, points-desc. Standalone root leaves pool into a
// single trailing section so nothing the player holds goes missing.
type ListSection = {
  id: string;
  title: string | null;
  progress?: KnowledgeTreeNode['progress'];
  leaves: Array<{ id: string; name: string; field: string | null; points: number; mastered: boolean }>;
};

function collectListLeaves(node: KnowledgeTreeNode): ListSection['leaves'] {
  if (node.ghost) return [];
  const own =
    (node.value ?? 0) > 0
      ? [
          {
            id: node.id,
            name: node.name,
            field: node.field,
            points: node.value ?? 0,
            mastered: Boolean(node.mastered),
          },
        ]
      : [];
  return own.concat((node.children ?? []).flatMap(collectListLeaves));
}

function buildListSections(tree: KnowledgeTreeNode): ListSection[] {
  const sections: ListSection[] = [];
  const standalone: ListSection['leaves'] = [];
  for (const child of tree.children ?? []) {
    if (child.ghost) continue;
    if (child.children && child.children.length > 0) {
      const leaves = collectListLeaves(child).sort((a, b) => b.points - a.points);
      if (leaves.length > 0) {
        sections.push({ id: child.id, title: child.name, progress: child.progress, leaves });
      }
    } else if ((child.value ?? 0) > 0) {
      standalone.push({
        id: child.id,
        name: child.name,
        field: child.field,
        points: child.value ?? 0,
        mastered: Boolean(child.mastered),
      });
    }
  }
  sections.sort(
    (a, b) =>
      b.leaves.reduce((sum, l) => sum + l.points, 0) - a.leaves.reduce((sum, l) => sum + l.points, 0),
  );
  if (standalone.length > 0) {
    standalone.sort((a, b) => b.points - a.points);
    sections.push({
      id: '__standalone',
      title: sections.length > 0 ? 'More areas' : null,
      leaves: standalone,
    });
  }
  return sections;
}

export function KnowledgeBubbleMap({
  data,
  collections = [],
  // 'own' = interactive (adds allowed via the card); 'friend' = read-only
  // portrait — the tree carries no ghosts, and the card hides every mutation.
  variant = 'own',
  rootTitle = 'Your peaks',
}: {
  data: KnowledgeTreeNode;
  collections?: CollectionSummary[];
  variant?: 'own' | 'friend';
  rootTitle?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: 520 });
  const [tree, setTree] = useState<KnowledgeTreeNode>(data);
  const [focusId, setFocusId] = useState<string>('root');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [listMode, setListMode] = useState(false);
  // Media-query state via useSyncExternalStore: correct initial value on the
  // client, false during SSR, no setState-in-effect cascade.
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setSize({ w: rect.width, h: rect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const root = useMemo<PackedNode>(() => {
    const h = hierarchy<KnowledgeTreeNode>(tree)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return pack<KnowledgeTreeNode>().size([size.w, size.h]).padding(6)(h);
  }, [tree, size]);

  const nodeById = useMemo(() => {
    const map = new Map<string, PackedNode>();
    for (const node of root.descendants()) map.set(node.data.id, node);
    return map;
  }, [root]);

  const focus = nodeById.get(focusId) ?? root;
  const selected = selectedId ? nodeById.get(selectedId) : undefined;

  const visible = useMemo(
    () =>
      root
        .descendants()
        .filter(
          (d) => d.depth > 0 && d.depth <= focus.depth + 2 && d.ancestors().includes(focus),
        ),
    [root, focus],
  );

  const peaks = useMemo(
    () =>
      root
        .leaves()
        .filter((l) => !l.data.ghost && (l.value ?? 0) > 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .slice(0, 5),
    [root],
  );

  const k = Math.min(size.w, size.h) / (focus.r * 2 || 1);

  const zoomTo = useCallback(
    (node: PackedNode | null) => {
      if (!node) return;
      setSelectedId(null);
      if (node.data.id === focusId && node.parent) {
        setFocusId(node.parent.data.id); // tapping current focus pops out
      } else if (node.children) {
        setFocusId(node.data.id); // dive into a parent
      } else {
        setFocusId(node.parent?.data.id ?? 'root'); // leaf: land in its container
      }
    },
    [focusId],
  );

  const zoomOut = useCallback(() => {
    setSelectedId(null);
    setFocusId(focus.parent?.data.id ?? 'root');
  }, [focus]);

  // A peak chip recenters the leaf's container, flashes it, AND selects it —
  // the card is how the leaf's actions (details, quiz-me) are reached.
  const focusLeaf = useCallback((leaf: PackedNode) => {
    setFocusId(leaf.children ? leaf.data.id : (leaf.parent?.data.id ?? 'root'));
    setFlashId(leaf.data.id);
    setSelectedId(leaf.data.id);
  }, []);

  useEffect(() => {
    if (!flashId) return;
    const timer = window.setTimeout(() => setFlashId(null), reducedMotion ? 2200 : 1400);
    return () => window.clearTimeout(timer);
  }, [flashId, reducedMotion]);

  // Confirmed adopt (C1) — called from the action card only, never from a raw
  // bubble tap. Optimistic: the ghost becomes a small real bubble immediately
  // and reverts on failure; the card narrates both outcomes.
  const adoptNode = useCallback(async (id: string, name: string): Promise<boolean> => {
    const flip = (treeNode: KnowledgeTreeNode, ghost: boolean, value: number): KnowledgeTreeNode =>
      treeNode.id === id
        ? { ...treeNode, ghost: ghost || undefined, value }
        : { ...treeNode, children: treeNode.children?.map((c) => flip(c, ghost, value)) };
    setTree((prev) => flip(prev, false, 1));
    const ok = await adoptDomain(name);
    if (!ok) setTree((prev) => flip(prev, true, 40));
    return ok;
  }, []);

  const crumb = focus.ancestors().reverse(); // root..focus

  const hasGhost = visible.some((d) => d.data.ghost);
  const hint =
    focus.data.id === 'root'
      ? 'Tap a bubble to see what’s inside it'
      : hasGhost
        ? 'Dashed “+” bubbles are areas you haven’t started — tap one for options'
        : `Inside ${focus.data.name} · ↑ to zoom back out`;

  const listSections = useMemo(() => buildListSections(tree), [tree]);

  // The card reads everything from the tree datum; ghost children are the
  // node's "fill this out" roster (C3).
  const selectedInfo: SelectedNodeInfo | null = selected
    ? {
        id: selected.data.id,
        name: selected.data.name,
        field: selected.data.field,
        ghost: Boolean(selected.data.ghost),
        mastered: Boolean(selected.data.mastered),
        points: selected.data.ghost ? null : (selected.data.value ?? null),
        hasChildren: Boolean(selected.children && selected.children.length > 0),
        progress: selected.data.progress,
        ghostChildren: (selected.children ?? [])
          .filter((c) => c.data.ghost)
          .map((c) => ({ id: c.data.id, name: c.data.name })),
      }
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <nav aria-label="Knowledge map path" className="flex min-h-6 flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
          {!listMode && focus.data.id !== 'root' ? (
            <button
              type="button"
              onClick={zoomOut}
              aria-label="Zoom out one level"
              className="grid size-7 flex-none place-items-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
          ) : null}
          {!listMode &&
            crumb.map((node, i) => (
              <span key={node.data.id} className="flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden style={{ color: 'var(--border)' }}>›</span> : null}
                {i === crumb.length - 1 ? (
                  <span className="font-medium text-[var(--brand-ink)]">
                    {node.data.id === 'root' ? rootTitle : node.data.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(null);
                      setFocusId(node.data.id);
                    }}
                    className="font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ color: 'var(--brand-ink-700)' }}
                  >
                    {node.data.id === 'root' ? rootTitle : node.data.name}
                  </button>
                )}
              </span>
            ))}
          {/* C3 focus header, compact form: the same §9-A numbers the card
              shows, visible while traversing without a selection. */}
          {!listMode && focus.data.progress ? (
            <span className="whitespace-nowrap">
              · {focus.data.progress.rosterCovered} of {focus.data.progress.rosterSize} ·{' '}
              {new Intl.NumberFormat().format(focus.data.progress.points)} /{' '}
              {new Intl.NumberFormat().format(focus.data.progress.threshold)} pts
            </span>
          ) : null}
        </nav>
        <button
          type="button"
          onClick={() => setListMode((v) => !v)}
          className="rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
        >
          {listMode ? 'Bubble view' : 'List view'}
        </button>
      </div>

      {!listMode ? (
        <div className="flex gap-2 overflow-x-auto py-2" role="list" aria-label="Your peaks">
          {peaks.map((leaf) => (
            <button
              key={leaf.data.id}
              type="button"
              role="listitem"
              onClick={() => focusLeaf(leaf)}
              className="flex flex-none items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              style={{ borderColor: 'var(--border)', background: 'var(--brand-card)' }}
            >
              <span
                aria-hidden
                className="size-4 rounded-full"
                style={{
                  background: leaf.data.mastered ? 'var(--accent-gold)' : fieldColor(leaf.data.field),
                }}
              />
              <span className="font-serif text-[var(--brand-ink)]">{leaf.data.name}</span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {leaf.data.mastered ? 'Mastery · ' : ''}
                {leaf.value} pts
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {!listMode ? (
        <div ref={stageRef} className="relative min-h-0 flex-1" style={{ minHeight: 320 }}>
          <svg
            viewBox={`0 0 ${size.w} ${size.h}`}
            className="block h-full w-full"
            onClick={() => {
              // Background tap: dismiss the card first; only a second tap
              // zooms out — so closing a card can't also move the map.
              if (selectedId) setSelectedId(null);
              else setFocusId(focus.parent?.data.id ?? 'root');
            }}
            role="application"
            aria-label="Knowledge bubble map"
          >
            <g
              transform={`translate(${size.w / 2},${size.h / 2}) scale(${k}) translate(${-focus.x},${-focus.y})`}
              style={
                reducedMotion
                  ? undefined
                  : { transition: 'transform 320ms ease' }
              }
            >
              {visible.map((d) => {
                const base = fieldColor(d.data.field);
                const isParent = Boolean(d.children);
                return (
                  <circle
                    key={d.data.id}
                    cx={d.x}
                    cy={d.y}
                    r={d.r}
                    tabIndex={0}
                    role="button"
                    aria-label={`${d.data.name}${d.data.mastered ? ' — Mastery' : ''}${d.data.ghost ? ' — not started' : ''} — tap for options`}
                    fill={
                      d.data.ghost
                        ? 'transparent'
                        : d.data.mastered
                          ? 'var(--accent-gold)'
                          : base
                    }
                    fillOpacity={d.data.ghost ? 0 : d.data.mastered ? 0.28 : isParent ? 0.13 : 0.8}
                    stroke={d.data.mastered ? 'var(--accent-gold)' : base}
                    strokeWidth={d.data.mastered ? 1.4 : 0.9}
                    strokeOpacity={d.data.ghost ? 0.45 : isParent ? 0.5 : 0.85}
                    strokeDasharray={d.data.ghost ? '4 5' : undefined}
                    style={{ cursor: 'pointer', outlineOffset: 2 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      // First tap selects (raises the card); tapping the
                      // selected parent again dives in. Ghost taps only ever
                      // select — adding happens in the card, confirmed (C1).
                      if (d.data.id === selectedId) {
                        if (!d.data.ghost && d.children) zoomTo(d);
                      } else {
                        setSelectedId(d.data.id);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (d.data.id === selectedId) {
                          if (!d.data.ghost && d.children) zoomTo(d);
                        } else {
                          setSelectedId(d.data.id);
                        }
                      }
                    }}
                  />
                );
              })}

              {selected ? (
                <circle
                  cx={selected.x}
                  cy={selected.y}
                  r={selected.r + 3}
                  fill="none"
                  stroke="var(--brand-navy)"
                  strokeWidth={2 / k}
                  style={{ pointerEvents: 'none' }}
                />
              ) : null}

              {flashId && nodeById.get(flashId) ? (
                <circle
                  cx={nodeById.get(flashId)!.x}
                  cy={nodeById.get(flashId)!.y}
                  r={nodeById.get(flashId)!.r + 3}
                  fill="none"
                  stroke="var(--accent-gold)"
                  strokeWidth={2 / k}
                  style={{ pointerEvents: 'none' }}
                  className={reducedMotion ? undefined : 'animate-pulse'}
                />
              ) : null}

              {visible
                // One label layer (A1): only the focus's direct children carry
                // text — the next depth reads as unlabeled texture until you
                // dive in. Ghosts are always labeled inside the focus (the gap
                // IS the content); real bubbles keep the size threshold.
                .filter(
                  (d) =>
                    d.parent?.data.id === focus.data.id && (d.data.ghost || d.r * k > 18),
                )
                .map((d) => {
                  const displayName = d.data.ghost ? `+ ${d.data.name}` : d.data.name;
                  const fontPx =
                    Math.max(d.data.ghost ? 9 : 8, Math.min(d.r * k * 0.32, 26)) / k;
                  const words = displayName.split(' ');
                  const twoLine = d.r * k > 46 && words.length > 1;
                  const mid = Math.ceil(words.length / 2);
                  return (
                    <text
                      key={`label-${d.data.id}`}
                      x={d.x}
                      y={d.children ? d.y - d.r + 14 / k : d.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="pointer-events-none font-serif"
                      fill={d.data.ghost || d.children ? fieldColor(d.data.field) : 'var(--brand-ink)'}
                      opacity={d.data.ghost ? 0.7 : 1}
                      stroke="var(--background)"
                      strokeWidth={3 / k}
                      strokeLinejoin="round"
                      style={{
                        fontSize: `${fontPx}px`,
                        fontWeight: d.data.mastered ? 600 : 500,
                        paintOrder: 'stroke',
                      }}
                    >
                      {twoLine ? (
                        <>
                          <tspan x={d.x}>{words.slice(0, mid).join(' ')}</tspan>
                          <tspan x={d.x} dy="1em">
                            {words.slice(mid).join(' ')}
                          </tspan>
                        </>
                      ) : (
                        displayName
                      )}
                      {d.data.mastered && d.r * k > 60 ? (
                        <tspan x={d.x} dy="1.2em" style={{ fontSize: `${Math.max(7, fontPx * 0.6)}px` }} fill="var(--accent-gold)">
                          Mastery
                        </tspan>
                      ) : null}
                    </text>
                  );
                })}
            </g>
          </svg>

          {selectedInfo ? (
            <div className="absolute inset-x-0 bottom-0 z-10 px-1 pb-1">
              <KnowledgeNodeCard
                key={selectedInfo.id}
                node={selectedInfo}
                variant={variant}
                onClose={() => setSelectedId(null)}
                onDiveIn={() => zoomTo(selected ?? null)}
                onAdd={variant === 'own' ? adoptNode : async () => false}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto" aria-label="Knowledge areas by territory">
          {listSections.map((section) => (
            <section key={section.id} className="pb-1">
              {section.title ? (
                <h3 className="flex items-baseline justify-between gap-2 pb-1 pt-3 text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  <span>{section.title}</span>
                  {section.progress ? (
                    <span className="normal-case tracking-normal">
                      {section.progress.rosterCovered} of {section.progress.rosterSize} ·{' '}
                      {new Intl.NumberFormat().format(section.progress.points)} /{' '}
                      {new Intl.NumberFormat().format(section.progress.threshold)} pts
                    </span>
                  ) : null}
                </h3>
              ) : null}
              <div role="list">
                {section.leaves.map((leaf) => {
                  const row = (
                    <>
                      <span
                        aria-hidden
                        className="size-3 flex-none rounded-full"
                        style={{
                          background: leaf.mastered ? 'var(--accent-gold)' : fieldColor(leaf.field),
                        }}
                      />
                      <span className="font-serif text-base text-[var(--brand-ink)]">{leaf.name}</span>
                      <span className="ml-auto text-xs text-[var(--text-muted)]">
                        {leaf.mastered ? 'Mastery · ' : ''}
                        {leaf.points} pts
                      </span>
                    </>
                  );
                  return variant === 'own' ? (
                    <Link
                      key={leaf.id}
                      role="listitem"
                      href={`/knowledge/${encodeURIComponent(leaf.name)}`}
                      className="flex items-center gap-2.5 border-b py-2.5 text-sm hover:bg-[var(--brand-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {row}
                    </Link>
                  ) : (
                    <div
                      key={leaf.id}
                      role="listitem"
                      className="flex items-center gap-2.5 border-b py-2.5 text-sm"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {row}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Collection parents (§7) are coverage, not containers — they live in a
          strip, never in the pack. "You've covered N of M" is the honest voice. */}
      {collections.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto py-1.5" role="list" aria-label="Collections covered">
          {collections.map((c) => (
            <span
              key={c.label}
              role="listitem"
              className="flex-none whitespace-nowrap rounded-full border px-3 py-1 text-[11px]"
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)', background: 'var(--brand-card)' }}
            >
              {c.label} · {c.covered} of {c.rosterSize} covered
            </span>
          ))}
        </div>
      ) : null}

      <p className="min-h-5 pt-1.5 text-center font-serif text-[11px] italic text-[var(--text-muted)]" aria-live="polite">
        {!listMode ? hint : ''}
      </p>
    </div>
  );
}
