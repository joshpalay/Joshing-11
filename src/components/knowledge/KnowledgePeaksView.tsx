'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, ChevronRight, Plus, X } from 'lucide-react';

import { sumRealPoints, type KnowledgeTreeNode } from '@/server/knowledge/knowledge-tree';
import { adoptDomain } from '@/components/knowledge/adopt';
import {
  MIN_SIZE,
  MAX_SIZE,
  getCircleSize,
  getCircleOpacity,
} from '@/components/knowledge/CategoryCircles';
import {
  TERRITORY_FREQUENCIES,
  TERRITORY_FREQUENCY_COPY,
  TERRITORY_FREQUENCY_LABEL,
  type DomainPreferenceFrequency,
  type TerritoryFrequency,
} from '@/lib/daily/territory-model';

// D-KNOWLEDGE-CIRCLE-GRID-01 (P1) — the knowledge "peaks" view rendered as a
// circle grid: each top-level area a planet sized by points, containers wearing
// a dotted Saturn ring of moons (filled = a child area you hold, hollow = one
// you could add), the Daily Five frequency spelled out beneath, and unstarted
// areas as dashed "+" ghosts. Same tree payload, same mastery math — this phase
// is display only (the detail sheet is untouched; editing lands in P2).

// Saturn geometry (matches the ratified mock): the dotted ring sits a fixed gap
// outside the core, with evenly-spaced moon dots on it, capped so a big roster
// stays a ring and not a crowd.
const RING_GAP = 13;
const MOON_RADIUS = 5;
const MOON_CAP = 10;
// Every cell reserves the same square so circles align on a grid baseline
// regardless of their own diameter; the ring + moons extend into the padding.
const CELL_SLOT = MAX_SIZE + 2 * (RING_GAP + MOON_RADIUS) + 4;
const GHOST_DIAMETER = MIN_SIZE + 6;

function fieldColor(field: string | null | undefined): string {
  return field ? `var(--cat-${field}, var(--brand-ink-400))` : 'var(--brand-ink-400)';
}

// The category axis is the node's `field` hue key ('literature', 'film-tv', …).
// Title-case it for the filter chips, with a couple of nicer overrides. The hue
// is always paired with the readable label — it never carries meaning alone.
const CATEGORY_LABEL_OVERRIDES: Record<string, string> = {
  'film-tv': 'Film & TV',
  'pop-culture': 'Pop Culture',
};
function categoryLabel(field: string): string {
  return (
    CATEGORY_LABEL_OVERRIDES[field] ??
    field
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

function formatPts(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function quizHref(name: string): string {
  return `/daily/setup?domainMode=custom&domain=${encodeURIComponent(name)}`;
}

// A peaks leaf's `node.name` === its `canonicalSubcategory`, which is exactly the
// key `domainPreferenceFrequency` stores — matched case-insensitively, just like
// the domain-frequency route. Normalize both sides the same way to resolve it.
function freqKey(name: string): string {
  return name.trim().toLowerCase();
}

// Decision A: a leaf with no explicit preference shows its actual effective
// default. For an owned peak that's `'sometimes'` ("Sometimes") — the rotation
// it's already in — so the face is truthful, not blank.
const DEFAULT_FREQUENCY: TerritoryFrequency = 'sometimes';

// Mirror of Territory Setup's `ZONES`, assembled from the SAME shared source of
// truth those zones are built from (territory-model's label + copy maps) — so
// the four rows here read identically to the setup surface and can never drift.
// Not re-authored: the strings live in TERRITORY_FREQUENCY_COPY, not here.
const ZONES: Array<{ value: TerritoryFrequency; title: string; copy: string }> =
  TERRITORY_FREQUENCIES.map((value) => ({
    value,
    title: TERRITORY_FREQUENCY_LABEL[value],
    copy: TERRITORY_FREQUENCY_COPY[value],
  }));

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
  frequencyByDomain = {},
}: {
  data: KnowledgeTreeNode;
  variant?: 'own' | 'friend';
  /**
   * Per-leaf Daily Five rotation, keyed by domain string (case-insensitive).
   * Threaded from the page's daily preferences — additive read, no schema
   * change. Self-only: never passed for the friend variant.
   */
  frequencyByDomain?: DomainPreferenceFrequency;
}) {
  const [tree, setTree] = useState<KnowledgeTreeNode>(data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Optimistic frequency map, keyed by normalized domain. Seeded from the
  // server preference and updated in place on write (like `adoptNode`), so the
  // face pill and detail sheet reflect the change before the round rebuilds.
  const [freqMap, setFreqMap] = useState<Record<string, TerritoryFrequency>>(() => {
    const seeded: Record<string, TerritoryFrequency> = {};
    for (const [domain, frequency] of Object.entries(frequencyByDomain)) {
      seeded[freqKey(domain)] = frequency;
    }
    return seeded;
  });

  const resolveFrequency = useCallback(
    (name: string): TerritoryFrequency => freqMap[freqKey(name)] ?? DEFAULT_FREQUENCY,
    [freqMap],
  );

  // Optimistic write: flip local state, POST the single-domain change, revert on
  // failure. The route merges server-side and drops untouched Daily Five queues.
  const setFrequency = useCallback(
    async (name: string, frequency: TerritoryFrequency): Promise<boolean> => {
      const key = freqKey(name);
      const previous = freqMap[key];
      setFreqMap((prev) => ({ ...prev, [key]: frequency }));
      try {
        const res = await fetch('/api/daily/preferences/domain-frequency', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ domain: name, frequency }),
        });
        if (!res.ok) throw new Error('frequency update failed');
        return true;
      } catch {
        setFreqMap((prev) => {
          const next = { ...prev };
          if (previous === undefined) delete next[key];
          else next[key] = previous;
          return next;
        });
        return false;
      }
    },
    [freqMap],
  );

  const leaves = useMemo(() => indexLeaves(tree), [tree]);
  const sorted = useMemo(
    () => [...leaves].sort((a, b) => (b.node.value ?? 0) - (a.node.value ?? 0)),
    [leaves],
  );

  // Grid cells = the top-level areas of the tree. A node with children reads as a
  // container (Saturn ring of moons); a bare node reads as a leaf; a ghost reads
  // as an unstarted, addable area. Held areas sort by rolled-up points; ghosts
  // trail at the end. LeafInfo-shaped so the existing detail sheet takes them
  // unchanged (path/parent stay empty — top-level areas roll up to nothing).
  const areas = useMemo<LeafInfo[]>(
    () => (tree.children ?? []).map((node) => ({ node, path: [], parent: null, topParent: null })),
    [tree],
  );
  const areaCells = useMemo(() => {
    return [...areas].sort((a, b) => {
      const ag = a.node.ghost ? 1 : 0;
      const bg = b.node.ghost ? 1 : 0;
      if (ag !== bg) return ag - bg;
      return sumRealPoints(b.node) - sumRealPoints(a.node);
    });
  }, [areas]);
  const maxAreaPoints = useMemo(
    () =>
      Math.max(
        1,
        ...areaCells.filter((c) => !c.node.ghost).map((c) => sumRealPoints(c.node)),
      ),
    [areaCells],
  );

  // ── Controls bar (P3) — search / filter / sort, all client-side over the
  // already-loaded areas. No new query. ────────────────────────────────────
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set());
  const [freqFilter, setFreqFilter] = useState<Set<TerritoryFrequency>>(new Set());
  const [sortMode, setSortMode] = useState<'mastery' | 'category'>('mastery');

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const cell of areaCells) if (cell.node.field) set.add(cell.node.field);
    return [...set].sort();
  }, [areaCells]);

  const visibleCells = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = areaCells.filter(({ node }) => {
      if (q && !node.name.toLowerCase().includes(q)) return false;
      // Filters compose with AND across axes; "no chips" = no filter on that axis.
      if (catFilter.size > 0 && !(node.field && catFilter.has(node.field))) return false;
      if (freqFilter.size > 0) {
        // Ghosts are unstarted — no rotation — so a frequency filter drops them.
        if (node.ghost || !freqFilter.has(resolveFrequency(node.name))) return false;
      }
      return true;
    });
    const ghostRank = (c: LeafInfo) => (c.node.ghost ? 1 : 0);
    return [...filtered].sort((a, b) => {
      if (ghostRank(a) !== ghostRank(b)) return ghostRank(a) - ghostRank(b);
      if (sortMode === 'category') {
        const fa = a.node.field ?? '~';
        const fb = b.node.field ?? '~';
        if (fa !== fb) return fa < fb ? -1 : 1;
        return a.node.name.localeCompare(b.node.name);
      }
      // Mastery: mastered areas first, then points desc as the mastery proxy.
      const ma = a.node.mastered ? 0 : 1;
      const mb = b.node.mastered ? 0 : 1;
      if (ma !== mb) return ma - mb;
      return sumRealPoints(b.node) - sumRealPoints(a.node);
    });
  }, [areaCells, search, catFilter, freqFilter, sortMode, resolveFrequency]);

  const toggleCat = (field: string) =>
    setCatFilter((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  const toggleFreq = (freq: TerritoryFrequency) =>
    setFreqFilter((prev) => {
      const next = new Set(prev);
      if (next.has(freq)) next.delete(freq);
      else next.add(freq);
      return next;
    });

  // Selection resolves from the area cells first, then the flat leaf list (the
  // "see all" expansion), so either surface opens the same sheet.
  const selected = selectedId
    ? areas.find((a) => a.node.id === selectedId) ??
      leaves.find((l) => l.node.id === selectedId) ??
      null
    : null;

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

        {areaCells.length > 0 ? (
          <ControlsBar
            search={search}
            onSearch={setSearch}
            sortMode={sortMode}
            onSort={setSortMode}
            categories={categories}
            catFilter={catFilter}
            onToggleCat={toggleCat}
            showFrequencyFilter={variant === 'own'}
            freqFilter={freqFilter}
            onToggleFreq={toggleFreq}
          />
        ) : null}

        {areaCells.length === 0 ? (
          <p className="py-10 text-center font-serif text-[var(--text-muted)]">
            Answer and write questions and your peaks will show up here.
          </p>
        ) : visibleCells.length === 0 ? (
          <p className="py-10 text-center font-serif text-[var(--text-muted)]">
            No areas match — try clearing a filter.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-x-1 gap-y-6">
            {visibleCells.map((area) => (
              <KnowledgeCircleCell
                key={area.node.id}
                node={area.node}
                maxPoints={maxAreaPoints}
                frequency={resolveFrequency(area.node.name)}
                showFrequency={variant === 'own'}
                active={area.node.id === selectedId}
                onSelect={() =>
                  setSelectedId(area.node.id === selectedId ? null : area.node.id)
                }
              />
            ))}
          </div>
        )}

        {sorted.length > 0 ? (
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
            frequency={resolveFrequency(selected.node.name)}
            onClose={() => setSelectedId(null)}
            onSelectSibling={(id) => setSelectedId(id)}
            onAdd={variant === 'own' ? adoptNode : async () => false}
            onSetFrequency={setFrequency}
          />
        </div>
      ) : null}
    </div>
  );
}

// The controls bar (P3): search + filter (category, rotation) + sort (mastery,
// category). Everything is client-side over the already-loaded areas — no query,
// no round-trip. Chips match the knowledge chrome; selected = navy fill.
function ControlsBar({
  search,
  onSearch,
  sortMode,
  onSort,
  categories,
  catFilter,
  onToggleCat,
  showFrequencyFilter,
  freqFilter,
  onToggleFreq,
}: {
  search: string;
  onSearch: (value: string) => void;
  sortMode: 'mastery' | 'category';
  onSort: (mode: 'mastery' | 'category') => void;
  categories: string[];
  catFilter: Set<string>;
  onToggleCat: (field: string) => void;
  showFrequencyFilter: boolean;
  freqFilter: Set<TerritoryFrequency>;
  onToggleFreq: (freq: TerritoryFrequency) => void;
}) {
  const pill =
    'inline-flex min-h-8 items-center rounded-full border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  const pillStyle = (on: boolean) =>
    on
      ? { borderColor: 'var(--brand-navy)', color: 'var(--brand-card)', background: 'var(--brand-navy)' }
      : { borderColor: 'var(--border)', color: 'var(--brand-ink-700)', background: 'var(--brand-card)' };
  const groupLabel = 'text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-muted)]';

  return (
    <div className="mb-4 grid gap-2.5">
      <input
        type="search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search your areas…"
        aria-label="Search areas"
        className="min-h-9 w-full rounded-full border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ borderColor: 'var(--border)', background: 'var(--brand-card)', color: 'var(--brand-ink)' }}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={groupLabel}>Sort</span>
        {(['mastery', 'category'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onSort(mode)}
            aria-pressed={sortMode === mode}
            className={pill}
            style={pillStyle(sortMode === mode)}
          >
            {mode === 'mastery' ? 'Mastery' : 'Category'}
          </button>
        ))}
      </div>

      {categories.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={groupLabel}>Category</span>
          {categories.map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => onToggleCat(field)}
              aria-pressed={catFilter.has(field)}
              className={pill}
              style={pillStyle(catFilter.has(field))}
            >
              {categoryLabel(field)}
            </button>
          ))}
        </div>
      ) : null}

      {showFrequencyFilter ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={groupLabel}>Rotation</span>
          {TERRITORY_FREQUENCIES.map((freq) => (
            <button
              key={freq}
              type="button"
              onClick={() => onToggleFreq(freq)}
              aria-pressed={freqFilter.has(freq)}
              className={pill}
              style={pillStyle(freqFilter.has(freq))}
            >
              {TERRITORY_FREQUENCY_LABEL[freq]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// One grid cell — the "planet." Core diameter/opacity ride the shared
// CategoryCircles scale (points → size); a container additionally wears a dotted
// Saturn ring with a moon per child (filled = a child area held, hollow = an
// addable/ghost one), capped so a big roster stays a ring. "Never" fades the
// core (word + opacity carry the state, never color). Ghosts are a dashed "+".
function KnowledgeCircleCell({
  node,
  maxPoints,
  frequency,
  showFrequency,
  active,
  onSelect,
}: {
  node: KnowledgeTreeNode;
  maxPoints: number;
  frequency: TerritoryFrequency;
  showFrequency: boolean;
  active: boolean;
  /** Whole cell is the tap target; a ghost opens the sheet's adopt confirm (P2). */
  onSelect?: () => void;
}) {
  const ghost = Boolean(node.ghost);
  const mastered = Boolean(node.mastered);
  const color = mastered ? 'var(--accent-gold)' : fieldColor(node.field);
  const points = ghost ? 0 : sumRealPoints(node);
  const diameter = ghost ? GHOST_DIAMETER : getCircleSize(points, maxPoints);
  const coreR = diameter / 2;
  const children = node.children ?? [];
  const moons = children.slice(0, MOON_CAP);
  const hasRing = !ghost && moons.length > 0;
  const ringR = coreR + RING_GAP;
  const never = !ghost && frequency === 'resting';
  const coreOpacity = never ? 0.28 : getCircleOpacity(points, maxPoints);

  const svg = (
    <svg
      width={CELL_SLOT}
      height={CELL_SLOT}
      viewBox={`${-CELL_SLOT / 2} ${-CELL_SLOT / 2} ${CELL_SLOT} ${CELL_SLOT}`}
      aria-hidden
      style={{ overflow: 'visible' }}
    >
      {ghost ? (
        <>
          <circle
            r={coreR}
            fill="none"
            stroke="var(--brand-ink-400)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--brand-ink-400)"
            fontSize={coreR}
          >
            +
          </text>
        </>
      ) : (
        <>
          {hasRing ? (
            <circle
              r={ringR}
              fill="none"
              stroke={color}
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          ) : null}
          <circle r={coreR} fill={color} fillOpacity={coreOpacity} />
          {points > 0 && diameter >= 34 ? (
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--brand-ink)"
              fontFamily="var(--font-serif)"
              fontSize={Math.max(9, Math.round(coreR * 0.6))}
            >
              {formatPts(points)}
            </text>
          ) : null}
          {moons.map((child, i) => {
            const angle = ((-90 + i * (360 / moons.length)) * Math.PI) / 180;
            const held = !child.ghost && (child.value ?? 0) > 0;
            return (
              <circle
                key={child.id}
                cx={Math.cos(angle) * ringR}
                cy={Math.sin(angle) * ringR}
                r={MOON_RADIUS}
                fill={held ? color : 'var(--brand-card)'}
                fillOpacity={held ? 0.9 : 1}
                stroke={color}
                strokeWidth={1.5}
              />
            );
          })}
        </>
      )}
    </svg>
  );

  const caption = (
    <>
      <span
        className={`font-serif text-[12.5px] leading-tight ${
          ghost ? 'text-[var(--text-muted)]' : 'text-[var(--brand-ink)]'
        }`}
      >
        {node.name}
      </span>
      {!ghost && showFrequency ? (
        <span className="text-[10px] tracking-[0.02em] text-[var(--brand-ink-400)]">
          {TERRITORY_FREQUENCY_LABEL[frequency]}
        </span>
      ) : null}
    </>
  );

  // Ghosts are inert this phase; owned/leaf cells are the tap target for the sheet.
  if (!onSelect) {
    return (
      <div className="flex flex-col items-center gap-1 text-center">
        {svg}
        {caption}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex flex-col items-center gap-1 rounded-xl p-1 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        active ? 'bg-[var(--brand-card)]' : 'hover:opacity-90'
      }`}
    >
      {svg}
      {caption}
    </button>
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
  frequency,
  onClose,
  onSelectSibling,
  onAdd,
  onSetFrequency,
}: {
  leaf: LeafInfo;
  variant: 'own' | 'friend';
  frequency: TerritoryFrequency;
  onClose: () => void;
  onSelectSibling: (id: string) => void;
  onAdd: (id: string, name: string) => Promise<boolean>;
  onSetFrequency: (name: string, frequency: TerritoryFrequency) => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<AddPhase>({ step: 'idle' });
  // Frequency edit is self-only; the sheet remounts per leaf (keyed on node.id)
  // so these reset on leaf switch — the "Updated" line persists until then (O3).
  const [freqSaving, setFreqSaving] = useState(false);
  const [freqChanged, setFreqChanged] = useState(false);
  const [freqError, setFreqError] = useState(false);
  const node = leaf.node;
  const parent = leaf.parent;
  const siblings = (parent?.children ?? []).filter((c) => c.id !== node.id);
  const ownedSiblings = siblings.filter((c) => !c.ghost && (c.value ?? 0) > 0);
  const ghostSiblings = siblings.filter((c) => c.ghost);

  // "Within this" = the child areas held inside this node (container cells).
  const ownChildren = node.children ?? [];
  const heldChildren = ownChildren.filter((c) => !c.ghost && (c.value ?? 0) > 0);
  const ghostChildren = ownChildren.filter((c) => c.ghost);

  // "More in {area}" expands sideways. With a parent (a leaf/sub-area opened from
  // the list), that's the sibling roster. For a top-level area (no parent) it's
  // the addable children of this area itself — the same "grow it next" move.
  const areaName = parent ? parent.name : node.name;
  const jumpSiblings = parent ? ownedSiblings : [];
  const addSiblings = parent ? ghostSiblings : ghostChildren;
  const showMoreIn = variant === 'own' && (jumpSiblings.length > 0 || addSiblings.length > 0);
  const sectionBorder = { borderColor: 'var(--border)' };

  const actionButton =
    'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  const confirmAdd = async (id: string, name: string) => {
    setPhase({ step: 'adding', id, name });
    const ok = await onAdd(id, name);
    setPhase({ step: ok ? 'added' : 'failed', id, name });
  };

  // Tap a frequency row to set it (Decision B: in-place, immediate). Only an
  // actual change fires the write and the confirmation (Decision C) — re-tapping
  // the current state is a no-op, so the "Updated" line never lies.
  const selectFrequency = async (next: TerritoryFrequency) => {
    if (freqSaving || next === frequency) return;
    setFreqSaving(true);
    setFreqError(false);
    const ok = await onSetFrequency(node.name, next);
    setFreqSaving(false);
    if (ok) setFreqChanged(true);
    else setFreqError(true);
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

  // A ghost cell is an unstarted area: the sheet is a single adopt confirm (D8 —
  // ghost tap → "Add to your map?" before adopting). No frequency/sections until
  // it's on the map. Uses the same optimistic add path as the ghost Add rows.
  if (node.ghost) {
    return card(
      <>
        <div className="flex items-start justify-between gap-3">
          <p className="font-serif text-base text-[var(--brand-ink)]">
            Add <strong>{node.name}</strong> to your map?
          </p>
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
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Questions will start appearing in your Daily Five.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void confirmAdd(node.id, node.name)}
            className={actionButton}
            style={{ borderColor: 'var(--brand-navy)', background: 'var(--brand-navy)', color: 'var(--brand-card)' }}
          >
            <Plus className="size-4" aria-hidden /> Add it
          </button>
          <button
            type="button"
            onClick={onClose}
            className={actionButton}
            style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
          >
            Not now
          </button>
        </div>
      </>,
    );
  }

  return card(
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-serif text-lg text-[var(--brand-ink)]">
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

      {/* Part of — where this area rolls up to (read-only). Empty for a
          top-level area, which rolls up to nothing. */}
      {leaf.path.length > 0 ? (
        <div className="mt-4 border-t pt-3" style={sectionBorder}>
          <p className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">Part of</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1 font-serif text-[var(--brand-ink)]">
            {leaf.path.map((ancestor, i) => (
              <span key={ancestor.id} className="flex items-center gap-1">
                {i > 0 ? (
                  <ChevronRight className="size-3 text-[var(--text-muted)]" aria-hidden />
                ) : (
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full"
                    style={{ background: fieldColor(ancestor.field) }}
                  />
                )}
                {ancestor.name}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {/* Within this — the child areas you already hold inside this one. */}
      {heldChildren.length > 0 ? (
        <div className="mt-4 border-t pt-3" style={sectionBorder}>
          <p className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Within this — what you hold
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {heldChildren.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => onSelectSibling(child.id)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ borderColor: 'var(--border)', background: 'var(--brand-card)' }}
              >
                <span
                  aria-hidden
                  className="size-3 rounded-full"
                  style={{ background: child.mastered ? 'var(--accent-gold)' : fieldColor(child.field) }}
                />
                <span className="font-serif text-[var(--brand-ink)]">{child.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* More in {area} — jump to owned neighbours, or add the ghosts next to it. */}
      {showMoreIn ? (
        <div className="mt-4 border-t pt-3" style={sectionBorder}>
          <p className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">
            More in {areaName}
          </p>
          {jumpSiblings.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {jumpSiblings.map((sib) => (
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
          {addSiblings.length > 0 ? (
            <ul className="mt-2 grid gap-1.5">
              {addSiblings.map((ghost) => (
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

      {/* How often it shows up (D8, last) — the loud, editable control. Rows come
          from ZONES, the mirror of Territory Setup's zones (shared copy source, no
          re-authoring). Self-only: friend cards stay read-only (DO-NOT). */}
      {variant === 'own' ? (
        <div className="mt-4 border-t pt-3" style={sectionBorder}>
          <p className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">
            How often it shows up
          </p>
          <div
            className="mt-2 grid gap-1.5"
            role="radiogroup"
            aria-label={`How often to ask about ${node.name}`}
          >
            {ZONES.map(({ value, title, copy }) => {
              const selectedFreq = value === frequency;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selectedFreq}
                  disabled={freqSaving}
                  onClick={() => void selectFrequency(value)}
                  className="flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  style={
                    selectedFreq
                      ? {
                          borderColor: 'var(--brand-navy)',
                          background: 'var(--brand-navy)',
                          color: 'var(--brand-card)',
                        }
                      : {
                          borderColor: 'var(--border)',
                          background: 'var(--brand-card)',
                          color: 'var(--brand-ink)',
                        }
                  }
                >
                  <span aria-hidden className="mt-0.5 grid size-4 flex-none place-items-center">
                    {selectedFreq ? (
                      <Check className="size-4" />
                    ) : (
                      <span
                        className="size-3.5 rounded-full border"
                        style={{ borderColor: 'var(--border)' }}
                      />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-serif text-[15px] leading-tight">{title}</span>
                    <span
                      className={selectedFreq ? 'block text-xs opacity-80' : 'block text-xs'}
                      style={selectedFreq ? undefined : { color: 'var(--text-muted)' }}
                    >
                      {copy}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {/* Queue-drop acknowledgement (Decision C) — quiet, only on real change,
              stays until the sheet closes or a different leaf is opened (O3). */}
          {freqChanged ? (
            <p className="mt-2 text-xs text-[var(--text-muted)]" aria-live="polite">
              Updated — your next round reflects this.
            </p>
          ) : freqError ? (
            <p className="mt-2 text-xs" aria-live="polite" style={{ color: 'var(--game-wrong-strong)' }}>
              Couldn’t update it. Try again.
            </p>
          ) : null}
        </div>
      ) : null}
    </>,
  );
}
