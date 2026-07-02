'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hierarchy, pack, type HierarchyCircularNode } from 'd3-hierarchy';

import type { KnowledgeTreeNode } from '@/server/knowledge/knowledge-tree';

// B-KNOWLEDGE-TAXONOMY-01 P5 — the nested circle-pack knowledge map, ported
// from the ratified knowledge-bubbles prototype onto the repo's design
// language: brand tokens (--brand-*, --cat-*, --accent-gold), serif labels,
// focus rings, reduced-motion respected. Leaves are the bright foreground;
// parents are faint containment; ghosts are dashed invitations. Mastery is
// gold fill PLUS the "Mastery" label — never color alone.

type PackedNode = HierarchyCircularNode<KnowledgeTreeNode>;

function fieldColor(field: string | null | undefined): string {
  return field ? `var(--cat-${field}, var(--brand-ink-400))` : 'var(--brand-ink-400)';
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

export function KnowledgeBubbleMap({ data }: { data: KnowledgeTreeNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: 520 });
  const [tree, setTree] = useState<KnowledgeTreeNode>(data);
  const [focusId, setFocusId] = useState<string>('root');
  const [flashId, setFlashId] = useState<string | null>(null);
  const [listMode, setListMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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

  const focusLeaf = useCallback((leaf: PackedNode) => {
    setFocusId(leaf.children ? leaf.data.id : (leaf.parent?.data.id ?? 'root'));
    setFlashId(leaf.data.id);
  }, []);

  useEffect(() => {
    if (!flashId) return;
    const timer = window.setTimeout(() => setFlashId(null), reducedMotion ? 2200 : 1400);
    return () => window.clearTimeout(timer);
  }, [flashId, reducedMotion]);

  // Ghost add — optimistic: the bubble becomes a small real one immediately;
  // on failure it reverts and a quiet inline notice appears (interface voice).
  const addGhost = useCallback(
    async (node: PackedNode) => {
      const name = node.data.name;
      const flip = (treeNode: KnowledgeTreeNode, ghost: boolean, value: number): KnowledgeTreeNode =>
        treeNode.id === node.data.id
          ? { ...treeNode, ghost: ghost || undefined, value }
          : { ...treeNode, children: treeNode.children?.map((c) => flip(c, ghost, value)) };
      setTree((prev) => flip(prev, false, 1));
      setNotice(`Added “${name}” — questions will start flowing here.`);
      const ok = await adoptDomain(name);
      if (!ok) {
        setTree((prev) => flip(prev, true, 40));
        setNotice(`Couldn't add “${name}” just now — it stays on the map to try again.`);
      }
    },
    [],
  );

  const crumb = focus.ancestors().reverse(); // root..focus

  const hasGhost = visible.some((d) => d.data.ghost);
  const hint =
    focus.data.id === 'root'
      ? 'Tap a bubble to dive in · background to come out'
      : hasGhost
        ? 'Dashed bubbles are nearby areas you haven’t started — tap to add one'
        : `Inside ${focus.data.name} · tap background to zoom out`;

  const leavesForList = useMemo(
    () =>
      root
        .leaves()
        .filter((l) => !l.data.ghost && (l.value ?? 0) > 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [root],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <nav aria-label="Knowledge map path" className="flex min-h-6 flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
          {!listMode &&
            crumb.map((node, i) => (
              <span key={node.data.id} className="flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden style={{ color: 'var(--border)' }}>›</span> : null}
                {i === crumb.length - 1 ? (
                  <span className="font-medium text-[var(--brand-ink)]">
                    {node.data.id === 'root' ? 'Your peaks' : node.data.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setFocusId(node.data.id)}
                    className="font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ color: 'var(--brand-ink-700)' }}
                  >
                    {node.data.id === 'root' ? 'Your peaks' : node.data.name}
                  </button>
                )}
              </span>
            ))}
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
            onClick={() => setFocusId(focus.parent?.data.id ?? 'root')}
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
                    aria-label={`${d.data.name}${d.data.mastered ? ' — Mastery' : ''}${d.data.ghost ? ' — not started, tap to add' : ''}`}
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
                      if (d.data.ghost) void addGhost(d);
                      else zoomTo(d);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (d.data.ghost) void addGhost(d);
                        else zoomTo(d);
                      }
                    }}
                  />
                );
              })}

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
                .filter((d) => d.r * k > 18)
                .map((d) => {
                  const fontPx = Math.max(8, Math.min(d.r * k * 0.32, 26)) / k;
                  const words = d.data.name.split(' ');
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
                      opacity={d.data.ghost ? 0.6 : 1}
                      style={{ fontSize: `${fontPx}px`, fontWeight: d.data.mastered ? 600 : 500 }}
                    >
                      {twoLine ? (
                        <>
                          <tspan x={d.x}>{words.slice(0, mid).join(' ')}</tspan>
                          <tspan x={d.x} dy="1em">
                            {words.slice(mid).join(' ')}
                          </tspan>
                        </>
                      ) : (
                        d.data.name
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
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto" role="list" aria-label="Knowledge areas by points">
          {leavesForList.map((leaf) => (
            <div
              key={leaf.data.id}
              role="listitem"
              className="flex items-center gap-2.5 border-b py-2.5 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <span
                aria-hidden
                className="size-3 flex-none rounded-full"
                style={{
                  background: leaf.data.mastered ? 'var(--accent-gold)' : fieldColor(leaf.data.field),
                }}
              />
              <span className="font-serif text-base text-[var(--brand-ink)]">{leaf.data.name}</span>
              <span className="ml-auto text-xs text-[var(--text-muted)]">
                {leaf.data.mastered ? 'Mastery · ' : ''}
                {leaf.value} pts
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="min-h-5 pt-1.5 text-center font-serif text-[11px] italic text-[var(--text-muted)]" aria-live="polite">
        {notice ?? (!listMode ? hint : '')}
      </p>
    </div>
  );
}
