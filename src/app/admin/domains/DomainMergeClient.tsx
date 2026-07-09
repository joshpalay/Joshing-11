'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { FragmentationPair } from '@/server/db/queries/domain-fragmentation';
import type {
  DomainMergeSpec,
  MergeApplyResult,
  MergePreview,
} from '@/server/db/queries/domain-merges';

// Deliberately minimal — an internal ops tool. Per candidate pair the admin picks
// the surviving label (or leaves the pair); a batch is previewed (read-only census
// of the exact rows that would move) before it can be applied. Apply stays disabled
// until a preview of the CURRENT selection came back clean, so nothing mutates prod
// on a stale or unhandled-table selection.

type Choice = 'leave' | 'A' | 'B';

// A stable key per pair — the label strings are unique enough for a keyed map.
function pairKey(p: FragmentationPair): string {
  return `${p.domainA} ${p.domainB}`;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * The side that should survive a merge, by question count: folding the smaller
 * side into the larger moves the fewest rows and keeps the label most questions
 * already file under. A tie (or near-tie) is a real judgment call — return null
 * so the UI recommends nothing rather than a coin-flip. "Near" = within 15%.
 */
function recommendedSurvivor(p: FragmentationPair): 'A' | 'B' | null {
  const a = p.depthA;
  const b = p.depthB;
  const max = Math.max(a, b);
  if (max === 0) return null;
  if (Math.abs(a - b) / max < 0.15) return null;
  return a > b ? 'A' : 'B';
}

type PeekItem = { text: string; answer: string; source: 'canonical' | 'bank'; suppressed: boolean };

/** Turn the per-pair choices into merge specs (target survives, other folds in). */
function selectionsToMerges(pairs: FragmentationPair[], choices: Map<string, Choice>): DomainMergeSpec[] {
  const merges: DomainMergeSpec[] = [];
  for (const p of pairs) {
    const choice = choices.get(pairKey(p));
    if (choice === 'A') merges.push({ target: p.domainA, sources: [p.domainB] });
    else if (choice === 'B') merges.push({ target: p.domainB, sources: [p.domainA] });
  }
  return merges;
}

/**
 * A label that is a target in one selected merge and a source in another (or a
 * source in two) would chain ambiguously in a single batch. Detect it so the admin
 * resolves it across rounds rather than applying an order-dependent result.
 */
function conflictingLabels(merges: DomainMergeSpec[]): string[] {
  const targets = new Set(merges.map((m) => m.target));
  const sourceCounts = new Map<string, number>();
  for (const m of merges) {
    for (const s of m.sources) sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
  }
  const bad = new Set<string>();
  for (const [label, count] of sourceCounts) {
    if (count > 1 || targets.has(label)) bad.add(label);
  }
  return [...bad];
}

export function DomainMergeClient({ pairs }: { pairs: FragmentationPair[] }) {
  const router = useRouter();
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [applied, setApplied] = useState<MergeApplyResult | null>(null);
  const [busy, setBusy] = useState<null | 'preview' | 'apply'>(null);
  const [error, setError] = useState<string | null>(null);

  const merges = useMemo(() => selectionsToMerges(pairs, choices), [pairs, choices]);
  const conflicts = useMemo(() => conflictingLabels(merges), [merges]);
  const selectedCount = merges.length;

  // Any change to the selection invalidates a prior preview — force a re-preview.
  const setChoice = (key: string, choice: Choice) => {
    setChoices((prev) => {
      const next = new Map(prev);
      if (choice === 'leave') next.delete(key);
      else next.set(key, choice);
      return next;
    });
    setPreview(null);
    setApplied(null);
    setError(null);
  };

  const previewClean = preview?.ok === true && preview.census.length > 0;

  async function post(action: 'preview' | 'apply') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/admin/domain-merges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, merges }),
      });
      const data = await res.json().catch(() => null);
      if (action === 'preview') {
        if (!res.ok || !data) {
          setError('Preview failed — see server logs.');
          return;
        }
        setPreview(data as MergePreview);
        setApplied(null);
      } else {
        if (!res.ok || !data) {
          const result = data as MergeApplyResult | null;
          if (result && !result.ok && result.reason === 'unhandled_tables') {
            setPreview({ census: [], unhandled: result.unhandled, ok: false, reason: 'unhandled_tables' });
            setError('Apply aborted — a source label lives in a table this tool cannot consolidate.');
          } else {
            setError('Apply failed — see server logs.');
          }
          return;
        }
        setApplied(data as MergeApplyResult);
        setPreview(null);
        setChoices(new Map());
        // Re-pull candidates: the merged labels should drop off the list.
        router.refresh();
      }
    } catch {
      setError('Network error — nothing was changed.');
    } finally {
      setBusy(null);
    }
  }

  if (pairs.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        No near-duplicate clusters above threshold. Nothing to review.
      </p>
    );
  }

  const btn = 'rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-40';

  return (
    <div className="flex flex-col gap-6">
      {applied && applied.ok ? (
        <div
          className="rounded-md border p-3 text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          <strong style={{ color: 'var(--brand-navy)' }}>
            Applied — {applied.retargeted} row{applied.retargeted === 1 ? '' : 's'} retargeted.
          </strong>
          <ul className="mt-2 list-disc pl-5">
            {applied.log.slice(0, 40).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <table className="w-full text-sm">
        <thead>
          <tr
            className="border-b text-left"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            <th className="py-2 pr-3 font-medium">Domain A</th>
            <th className="py-2 pr-3 font-medium">Domain B</th>
            <th className="py-2 pr-3 text-right font-medium">Similar</th>
            <th className="py-2 pr-3 font-medium">Decision</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => {
            const key = pairKey(p);
            const choice = choices.get(key) ?? 'leave';
            const isConflict =
              (choice === 'A' || choice === 'B') &&
              (conflicts.includes(p.domainA) || conflicts.includes(p.domainB));
            return (
              <PairRow
                key={key}
                pair={p}
                choice={choice}
                isConflict={isConflict}
                onChoose={(next) => setChoice(key, next)}
              />
            );
          })}
        </tbody>
      </table>

      {conflicts.length > 0 ? (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>
          A label is both a survivor and a fold-in target in your selection (
          {conflicts.join(', ')}). Resolve these across separate rounds — apply one, then the next.
        </p>
      ) : null}

      {preview && !applied ? (
        <div
          className="rounded-md border p-3 text-sm"
          style={{ borderColor: 'var(--border)' }}
        >
          {preview.reason === 'no_source_rows' ? (
            <p style={{ color: 'var(--text-muted)' }}>
              Nothing to merge — no rows hold the fold-in labels (already merged?).
            </p>
          ) : (
            <>
              <p className="mb-2">
                <strong style={{ color: preview.ok ? 'var(--brand-navy)' : 'var(--danger)' }}>
                  {preview.ok
                    ? `${preview.census.length} label/table locations would move`
                    : 'Cannot apply — unhandled tables'}
                </strong>
              </p>
              {preview.unhandled.length > 0 ? (
                <p className="mb-2" style={{ color: 'var(--danger)' }}>
                  These tables hold a fold-in label but the merge path cannot consolidate them —
                  extend <code>domain-merges.ts</code> first:{' '}
                  {preview.unhandled.map((r) => `${r.table}.${r.column} (${r.rows})`).join(', ')}
                </p>
              ) : null}
              <ul className="list-disc pl-5" style={{ color: 'var(--text-muted)' }}>
                {preview.census.slice(0, 40).map((r, i) => (
                  <li key={i}>
                    {r.table}.{r.column}: “{r.label}” × {r.rows}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {selectedCount} pair{selectedCount === 1 ? '' : 's'} selected to merge
        </span>
        <button
          type="button"
          className={btn}
          style={{ borderColor: 'var(--border)', color: 'var(--brand-navy)' }}
          disabled={selectedCount === 0 || conflicts.length > 0 || busy !== null}
          onClick={() => post('preview')}
        >
          {busy === 'preview' ? 'Previewing…' : 'Preview'}
        </button>
        <button
          type="button"
          className={btn}
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          disabled={!previewClean || conflicts.length > 0 || busy !== null}
          onClick={() => post('apply')}
        >
          {busy === 'apply' ? 'Applying…' : 'Apply merges'}
        </button>
      </div>
    </div>
  );
}

// One candidate pair: the two labels with their question counts, an "in graph"
// chip (merge candidates are RAW corpus labels — most have no KnowledgeNode,
// which is why they don't appear on the knowledge-graph page), a per-side
// "see questions" peek, a recommended survivor (by count), and the decision.
// Three decisions, not two: same scope → Keep one (merge); CONTAINMENT (a work
// inside its series/genre) → Nest, which authors both into the graph and draws
// the edge — the pair then stops appearing here; unrelated → Leave.
// Peek/nest state is per-row, so a component (not an inline map) is needed.
function PairRow({
  pair,
  choice,
  isConflict,
  onChoose,
}: {
  pair: FragmentationPair;
  choice: Choice;
  isConflict: boolean;
  onChoose: (choice: Choice) => void;
}) {
  const router = useRouter();
  const [peek, setPeek] = useState<'A' | 'B' | null>(null);
  const [nesting, setNesting] = useState(false);
  const [nestError, setNestError] = useState<string | null>(null);
  const recommended = recommendedSurvivor(pair);

  // Containment decision: child nests under parent. Nodes are created for
  // labels not yet in the graph; on success the refresh drops the pair (the
  // candidate query filters connected pairs).
  async function nest(childLabel: string, parentLabel: string) {
    if (nesting) return;
    setNesting(true);
    setNestError(null);
    try {
      const res = await fetch('/api/admin/domain-merges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'nest', childLabel, parentLabel }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setNestError(
          body?.error === 'self_edge'
            ? 'That nesting would loop — check the direction.'
            : `Nest failed (${res.status}).`,
        );
        return;
      }
      router.refresh();
    } catch {
      setNestError('Nest failed — nothing was changed.');
    } finally {
      setNesting(false);
    }
  }

  const side = (which: 'A' | 'B', label: string, depth: number, hasNode: boolean) => (
    <td className="py-2 pr-3 align-top">
      <div className="flex flex-col gap-0.5">
        <span>
          {label}
          {recommended === which ? (
            <span
              className="ml-1.5 whitespace-nowrap rounded-sm border px-1 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.06em]"
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
              title="Recommended survivor — it holds more questions, so folding the other side in moves the fewest rows"
            >
              ★ keep
            </span>
          ) : null}
          {hasNode ? (
            <span
              className="ml-1.5 whitespace-nowrap rounded-sm border px-1 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.06em]"
              style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
              title="This label has an authored territory on the Knowledge graph page"
            >
              in graph
            </span>
          ) : (
            <span
              className="ml-1.5 whitespace-nowrap rounded-sm border px-1 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.06em]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              title="A raw question label — not in the knowledge graph. Nest or merge adds it."
            >
              label only
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setPeek((cur) => (cur === which ? null : which))}
          className="self-start text-xs underline-offset-2 hover:underline"
          style={{ color: 'var(--text-muted)' }}
          aria-expanded={peek === which}
        >
          {depth} question{depth === 1 ? '' : 's'} · {peek === which ? 'hide' : 'see'}
        </button>
      </div>
    </td>
  );

  return (
    <>
      <tr
        className="border-b align-top"
        style={{ borderColor: 'var(--border)', background: isConflict ? 'rgba(220,50,50,0.06)' : undefined }}
      >
        {side('A', pair.domainA, pair.depthA, pair.hasNodeA)}
        {side('B', pair.domainB, pair.depthB, pair.hasNodeB)}
        <td className="py-2 pr-3 text-right align-top" style={{ color: 'var(--text-muted)' }}>
          {pct(pair.similarity)}
        </td>
        <td className="py-2 pr-3 align-top">
          <div className="flex flex-wrap gap-2">
            <ChoiceButton active={choice === 'A'} onClick={() => onChoose('A')}>
              Keep A
            </ChoiceButton>
            <ChoiceButton active={choice === 'B'} onClick={() => onChoose('B')}>
              Keep B
            </ChoiceButton>
            <ChoiceButton active={choice === 'leave'} onClick={() => onChoose('leave')}>
              Leave
            </ChoiceButton>
          </div>
          {/* Containment path — immediate (not part of the merge batch). */}
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void nest(pair.domainA, pair.domainB)}
              disabled={nesting}
              className="rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-40"
              style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
              title={`Parent/child, not duplicates: put “${pair.domainA}” INSIDE “${pair.domainB}” on the knowledge graph (both get territories; the pair leaves this list)`}
            >
              {nesting ? 'Nesting…' : 'A under B'}
            </button>
            <button
              type="button"
              onClick={() => void nest(pair.domainB, pair.domainA)}
              disabled={nesting}
              className="rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-40"
              style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
              title={`Parent/child, not duplicates: put “${pair.domainB}” INSIDE “${pair.domainA}” on the knowledge graph (both get territories; the pair leaves this list)`}
            >
              B under A
            </button>
          </div>
          {nestError ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
              {nestError}
            </p>
          ) : null}
        </td>
      </tr>
      {peek ? (
        <tr style={{ background: 'var(--brand-field)' }}>
          <td colSpan={4} className="px-3 pb-3">
            {/* key by label so switching sides remounts fresh (no reset-in-effect). */}
            <LabelPeek key={peek} label={peek === 'A' ? pair.domainA : pair.domainB} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

// Read-only sample of a label's questions — the "see what's actually in here"
// check before calling a pair the same scope. Loads once per open via the
// merges route's `peek` action (keyed on the raw label, no KnowledgeNode needed).
function LabelPeek({ label }: { label: string }) {
  const [items, setItems] = useState<PeekItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/admin/domain-merges', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'peek', label }),
        });
        const data = (await res.json().catch(() => null)) as { questions?: PeekItem[] } | null;
        if (!live) return;
        if (!res.ok || !data) {
          setError('Could not load questions.');
          return;
        }
        setItems(data.questions ?? []);
      } catch {
        if (live) setError('Could not load questions.');
      }
    })();
    return () => {
      live = false;
    };
  }, [label]);

  return (
    <div className="text-[13px]">
      <p className="mb-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        Questions filed under “{label}”:
      </p>
      {error ? (
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      ) : items === null ? (
        <p className="animate-pulse text-xs" style={{ color: 'var(--text-muted)' }}>
          Loading questions…
        </p>
      ) : items.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No questions under this label.
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((q, i) => (
            <li key={i} className="leading-snug">
              <span style={{ color: 'var(--brand-ink)' }}>{q.text}</span>{' '}
              <span style={{ color: 'var(--text-muted)' }}>
                — {q.answer}
                {q.source === 'bank' ? ' · bank' : ''}
                {q.suppressed ? ' · out of circulation' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border px-2.5 py-1 text-xs font-medium"
      style={
        active
          ? { borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)', background: 'rgba(30,58,95,0.06)' }
          : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
      }
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
