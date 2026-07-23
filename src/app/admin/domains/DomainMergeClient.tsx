'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { FragmentationPair } from '@/server/db/queries/domain-fragmentation';
import type { MergePreview } from '@/server/db/queries/domain-merges';
import type { DomainQuestionPeek } from '@/server/db/queries/knowledge-graph';
import { InfoTerm } from '@/app/admin/InfoTerm';

// D-DOMAIN-MERGE-REVIEW-REDESIGN-01 — the consolidated near-duplicate review
// surface. It fuses the two earlier takes: the progressive-disclosure UX (the
// real decision is two-level — is this pair related? → if so, how? — so a
// collapsed row shows just Merge/Nest + a quiet Dismiss, and expanding reveals
// the four specific choices grouped by scope) with the raw-corpus-label backend
// (/api/admin/domain-merges) that can merge labels with no graph node and NEST
// by authoring both sides into the graph on the fly. Merge folds raw labels via
// the shared applier (census-guarded, same transaction the CLI runs); Nest draws
// a containment edge, creating nodes as needed. Dismiss writes a permanent
// reviewed-pair record so a genuinely-different pair never resurfaces.

type ActionKind = 'keepA' | 'keepB' | 'aUnderB' | 'bUnderA';

// The optimistic-apply window. Undo within it means the API call never fires —
// the only honest undo for a merge (irreversible once the applier runs) and a
// uniform, atomic restore for nest too. A new action auto-commits the prior one.
const UNDO_MS = 6000;

// Combined depth above which the destructive-ish Dismiss asks for a confirm tap.
const BIG_PAIR_DEPTH = 20;

const pairId = (p: FragmentationPair) => `${p.domainA} ${p.domainB}`;
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

/**
 * The side that should survive a merge, by question count: folding the smaller
 * side into the larger moves the fewest rows. A tie (within 15%) is a real
 * judgment call — return null so the ★ marks nothing rather than a coin-flip.
 */
function recommendedSurvivor(p: FragmentationPair): 'A' | 'B' | null {
  const max = Math.max(p.depthA, p.depthB);
  if (max === 0) return null;
  if (Math.abs(p.depthA - p.depthB) / max < 0.15) return null;
  return p.depthA > p.depthB ? 'A' : 'B';
}

type PostResult = { ok: boolean; status: number; body: unknown };

async function postMerges(body: Record<string, unknown>): Promise<PostResult> {
  try {
    const res = await fetch('/api/admin/domain-merges', {
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

async function postKnowledge(body: Record<string, unknown>): Promise<PostResult> {
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

// The commit body + human label for each of the four choices, resolved against a
// pair. Keep-X folds the OTHER label into X via the corpus applier; X-under-Y
// authors the containment edge (both sides become graph territories).
function actionSpec(
  pair: FragmentationPair,
  action: ActionKind,
): { label: string; body: Record<string, unknown> } {
  switch (action) {
    case 'keepA':
      return {
        label: `Merged into “${pair.domainA}”`,
        body: { action: 'apply', merges: [{ target: pair.domainA, sources: [pair.domainB] }] },
      };
    case 'keepB':
      return {
        label: `Merged into “${pair.domainB}”`,
        body: { action: 'apply', merges: [{ target: pair.domainB, sources: [pair.domainA] }] },
      };
    case 'aUnderB':
      return {
        label: `Nested “${pair.domainA}” under “${pair.domainB}”`,
        body: { action: 'nest', childLabel: pair.domainA, parentLabel: pair.domainB },
      };
    case 'bUnderA':
      return {
        label: `Nested “${pair.domainB}” under “${pair.domainA}”`,
        body: { action: 'nest', childLabel: pair.domainB, parentLabel: pair.domainA },
      };
  }
}

// Translate a merge/nest failure body into one admin-readable line.
function failureMessage(label: string, res: PostResult): string {
  const body = res.body as { reason?: string; error?: string } | null;
  const reason = body?.reason ?? body?.error;
  if (reason === 'no_source_rows') return `Nothing to merge — “${label}” looks already merged.`;
  if (reason === 'unhandled_tables')
    return `Aborted — a label lives in a table the merge path can’t consolidate. Extend domain-merges.ts first.`;
  if (reason === 'self_edge') return 'That nesting would loop — check the direction.';
  return `That didn’t apply (${res.status}). The pair is back in the list.`;
}

type Pending = { id: string; label: string; body: Record<string, unknown> };

export function DomainMergeClient({ pairs }: { pairs: FragmentationPair[] }) {
  // Server truth stays in props; the client only tracks which rows to HIDE
  // (an optimistic apply/dismiss), so a reload — which re-excludes merged,
  // nested, and dismissed pairs server-side — reconciles cleanly.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const timerRef = useRef<number | null>(null);

  const hide = useCallback((id: string) => setRemoved((prev) => new Set(prev).add(id)), []);
  const unhide = useCallback(
    (id: string) =>
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    [],
  );

  const commitPending = useCallback(async () => {
    const pend = pendingRef.current;
    if (!pend) return;
    pendingRef.current = null;
    setPending(null);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const res = await postMerges(pend.body);
    // Nest returns { ok:true }; merge apply returns { ok:true, retargeted }.
    const applied = res.ok && (res.body as { ok?: boolean } | null)?.ok !== false;
    if (!applied) {
      unhide(pend.id);
      setError(failureMessage(pend.label, res));
    }
  }, [unhide]);

  const flushPending = useCallback(() => {
    if (pendingRef.current) void commitPending();
  }, [commitPending]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void commitPending();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(pair: FragmentationPair, action: ActionKind) {
    flushPending();
    const spec = actionSpec(pair, action);
    const id = pairId(pair);
    setError(null);
    setExpandedId(null);
    hide(id);
    const pend: Pending = { id, label: spec.label, body: spec.body };
    pendingRef.current = pend;
    setPending(pend);
    timerRef.current = window.setTimeout(() => void commitPending(), UNDO_MS);
  }

  function undo() {
    const pend = pendingRef.current;
    if (!pend) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    setPending(null);
    unhide(pend.id); // restores row + edge/label state — nothing was committed
  }

  async function dismiss(pair: FragmentationPair) {
    flushPending();
    const id = pairId(pair);
    setError(null);
    setExpandedId(null);
    hide(id);
    const res = await postKnowledge({
      action: 'dismiss_pair',
      domainA: pair.domainA,
      domainB: pair.domainB,
    });
    if (!res.ok) {
      unhide(id);
      setError(`Couldn’t dismiss that pair (${res.status}).`);
    }
  }

  const visible = pairs.filter((p) => !removed.has(pairId(p)));

  if (pairs.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        No near-duplicate clusters above threshold. Nothing to review.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p
          className="rounded-md border px-3 py-6 text-center text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          All caught up — every pair here has been merged, nested, or dismissed.
        </p>
      ) : (
        visible.map((pair) => (
          <MergeRow
            key={pairId(pair)}
            pair={pair}
            expanded={expandedId === pairId(pair)}
            onToggle={() => setExpandedId((cur) => (cur === pairId(pair) ? null : pairId(pair)))}
            onApply={(action) => apply(pair, action)}
            onDismiss={() => void dismiss(pair)}
          />
        ))
      )}

      {/* Persist-with-undo toast — one at a time, fixed in reach. */}
      {pending ? (
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-toast)] flex justify-center p-3">
          <div
            className="flex w-full max-w-lg items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-[var(--shadow-overlay)]"
            style={{
              background: 'var(--brand-card)',
              borderColor: 'var(--brand-navy)',
              color: 'var(--brand-ink-700)',
            }}
            aria-live="polite"
          >
            <span className="min-w-0 flex-1 truncate">
              <span aria-hidden className="mr-1">
                ✓
              </span>
              {pending.label}
            </span>
            <button
              type="button"
              onClick={undo}
              className="inline-flex min-h-11 shrink-0 items-center rounded-md border px-4 text-sm font-semibold"
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
            >
              Undo
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function graphBadge(hasNode: boolean) {
  return hasNode ? (
    <InfoTerm
      term="in_graph"
      className="ml-1 shrink-0 rounded-sm border px-1 py-0.5 type-eyebrow font-semibold uppercase tracking-eyebrow"
      style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
    >
      in tree
    </InfoTerm>
  ) : (
    <InfoTerm
      term="label_only"
      className="ml-1 shrink-0 rounded-sm border px-1 py-0.5 type-eyebrow font-semibold uppercase tracking-eyebrow"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      label only
    </InfoTerm>
  );
}

function MergeRow({
  pair,
  expanded,
  onToggle,
  onApply,
  onDismiss,
}: {
  pair: FragmentationPair;
  expanded: boolean;
  onToggle: () => void;
  onApply: (action: ActionKind) => void;
  onDismiss: () => void;
}) {
  const [choice, setChoice] = useState<ActionKind | null>(null);
  const [peekSide, setPeekSide] = useState<'A' | 'B' | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);

  const star = recommendedSurvivor(pair);
  const bigPair = pair.depthA + pair.depthB >= BIG_PAIR_DEPTH;
  const isMerge = choice === 'keepA' || choice === 'keepB';

  // Preview the exact rows a merge would move (census). Only meaningful for the
  // merge choices — nesting moves no question rows, it just draws an edge.
  async function loadPreview() {
    if (previewBusy || !isMerge) return;
    if (preview) {
      setPreview(null);
      return;
    }
    setPreviewBusy(true);
    const spec =
      choice === 'keepA'
        ? { target: pair.domainA, sources: [pair.domainB] }
        : { target: pair.domainB, sources: [pair.domainA] };
    const res = await postMerges({ action: 'preview', merges: [spec] });
    setPreview(res.ok ? (res.body as MergePreview) : null);
    setPreviewBusy(false);
  }

  const menuBtn =
    'inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:opacity-40';

  return (
    <div
      className="rounded-md border transition-colors"
      style={{ borderColor: expanded ? 'var(--brand-navy)' : 'var(--border)' }}
    >
      {/* ── Collapsed header ── */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex min-w-0 items-center text-sm font-medium text-[var(--brand-ink)]">
              <span className="truncate">{pair.domainA}</span>
              {star === 'A' ? <StarKeep /> : null}
              {graphBadge(pair.hasNodeA)}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }} aria-hidden>
              ≈
            </span>
            <span className="flex min-w-0 items-center text-sm font-medium text-[var(--brand-ink)]">
              <span className="truncate">{pair.domainB}</span>
              {star === 'B' ? <StarKeep /> : null}
              {graphBadge(pair.hasNodeB)}
            </span>
            <span className="ml-auto shrink-0 text-xs font-semibold">
              <InfoTerm
                def="How alike the two spellings are (trigram similarity) — the reason this pair was suggested."
                style={{ color: 'var(--brand-ink-700)' }}
              >
                {pct(pair.similarity)} alike
              </InfoTerm>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 text-xs" style={{ color: 'var(--text-muted)' }}>
            <PeekToggle
              side="A"
              depth={pair.depthA}
              open={peekSide === 'A'}
              onToggle={() => setPeekSide((cur) => (cur === 'A' ? null : 'A'))}
            />
            <PeekToggle
              side="B"
              depth={pair.depthB}
              open={peekSide === 'B'}
              onToggle={() => setPeekSide((cur) => (cur === 'B' ? null : 'B'))}
            />
          </div>
        </div>

        {/* Two controls when collapsed — primary Merge/Nest + quiet Dismiss. */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className={menuBtn}
            style={
              expanded
                ? {
                    borderColor: 'var(--brand-navy)',
                    background: 'var(--brand-navy)',
                    color: 'var(--brand-cream-page)',
                  }
                : { borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }
            }
          >
            Merge / Nest
          </button>
          {confirmingDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold"
              style={{ color: 'var(--danger)' }}
            >
              Dismiss — sure?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => (bigPair ? setConfirmingDismiss(true) : onDismiss())}
              className="inline-flex min-h-11 items-center px-2 text-sm font-medium underline underline-offset-4"
              style={{ color: 'var(--text-muted)' }}
              title="Genuinely two different territories — never show this pair again"
            >
              Dismiss
            </button>
          )}
        </div>

        {/* Per-side question peek spans the row when open. */}
        {peekSide ? (
          <div className="w-full">
            <LabelPeek
              key={peekSide}
              label={peekSide === 'A' ? pair.domainA : pair.domainB}
            />
          </div>
        ) : null}
      </div>

      {/* ── Expanded drawer ── */}
      {expanded ? (
        <div className="border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
          <fieldset className="space-y-4">
            <legend className="sr-only">Choose how to resolve this pair</legend>

            <div>
              <p
                className="mb-1.5 text-xs font-semibold uppercase tracking-eyebrow"
                style={{ color: 'var(--brand-ink-700)' }}
              >
                Same scope — merge into one domain
              </p>
              <div className="space-y-1">
                <ChoiceRadio
                  name={`${pairId(pair)}-choice`}
                  checked={choice === 'keepA'}
                  onSelect={() => {
                    setChoice('keepA');
                    setPreview(null);
                  }}
                  label={`Keep “${pair.domainA}”`}
                  hint={`${pair.depthA} q${star === 'A' ? '  ★ more questions' : ''}`}
                />
                <ChoiceRadio
                  name={`${pairId(pair)}-choice`}
                  checked={choice === 'keepB'}
                  onSelect={() => {
                    setChoice('keepB');
                    setPreview(null);
                  }}
                  label={`Keep “${pair.domainB}”`}
                  hint={`${pair.depthB} q${star === 'B' ? '  ★ more questions' : ''}`}
                />
              </div>
            </div>

            <div>
              <p
                className="mb-1.5 text-xs font-semibold uppercase tracking-eyebrow"
                style={{ color: 'var(--brand-ink-700)' }}
              >
                Different scope — nest one under the other
              </p>
              <div className="space-y-1">
                <ChoiceRadio
                  name={`${pairId(pair)}-choice`}
                  checked={choice === 'aUnderB'}
                  onSelect={() => {
                    setChoice('aUnderB');
                    setPreview(null);
                  }}
                  label={`“${pair.domainA}” under “${pair.domainB}”`}
                />
                <ChoiceRadio
                  name={`${pairId(pair)}-choice`}
                  checked={choice === 'bUnderA'}
                  onSelect={() => {
                    setChoice('bUnderA');
                    setPreview(null);
                  }}
                  label={`“${pair.domainB}” under “${pair.domainA}”`}
                />
              </div>
            </div>

            {preview ? <PreviewCensus preview={preview} /> : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadPreview()}
                disabled={!isMerge || previewBusy}
                className={menuBtn}
                style={
                  isMerge
                    ? { borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }
                    : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
                }
                title={
                  isMerge
                    ? 'Show the exact rows this merge would move'
                    : 'Nesting moves no question rows — it only draws the graph edge'
                }
              >
                {previewBusy ? 'Loading…' : preview ? 'Hide preview' : 'Preview'}
              </button>
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={onToggle}
                  className={menuBtn}
                  style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!choice}
                  onClick={() => choice && onApply(choice)}
                  className={menuBtn}
                  style={
                    choice
                      ? { borderColor: 'var(--success)', color: 'var(--success)' }
                      : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
                  }
                >
                  Apply
                </button>
              </span>
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}

function StarKeep() {
  return (
    <span
      className="ml-1.5 shrink-0 whitespace-nowrap rounded-sm border px-1 py-0.5 type-eyebrow font-semibold uppercase tracking-eyebrow"
      style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
      title="Recommended survivor — it holds more questions, so folding the other side in moves the fewest rows"
    >
      ★ keep
    </span>
  );
}

function PeekToggle({
  side,
  depth,
  open,
  onToggle,
}: {
  side: 'A' | 'B';
  depth: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="inline-flex min-h-9 items-center underline-offset-2 hover:underline"
      style={{ color: 'var(--text-muted)' }}
    >
      {side}: {depth} question{depth === 1 ? '' : 's'} · {open ? 'hide' : 'see'}
    </button>
  );
}

function PreviewCensus({ preview }: { preview: MergePreview }) {
  if (preview.reason === 'no_source_rows') {
    return (
      <p
        className="rounded-md border p-2 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
      >
        Nothing to merge — no rows hold the fold-in label (already merged?).
      </p>
    );
  }
  return (
    <div
      className="rounded-md border p-2 text-xs"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      <p className="mb-1 font-semibold" style={{ color: preview.ok ? 'var(--brand-navy)' : 'var(--danger)' }}>
        {preview.ok
          ? `${preview.census.length} label/table location${preview.census.length === 1 ? '' : 's'} would move`
          : 'Cannot apply — unhandled tables'}
      </p>
      {preview.unhandled.length > 0 ? (
        <p className="mb-1" style={{ color: 'var(--danger)' }}>
          These tables hold a fold-in label but the merge path can’t consolidate them — extend{' '}
          <code>domain-merges.ts</code> first:{' '}
          {preview.unhandled.map((r) => `${r.table}.${r.column} (${r.rows})`).join(', ')}
        </p>
      ) : null}
      <ul className="list-disc space-y-0.5 pl-5" style={{ color: 'var(--text-muted)' }}>
        {preview.census.slice(0, 40).map((r, i) => (
          <li key={i}>
            {r.table}.{r.column}: “{r.label}” × {r.rows}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Read-only sample of a label's questions — the "see what's actually in here"
// check before calling a pair the same scope. Loads once per open via the
// merges route's `peek` action (keyed on the raw label, no KnowledgeNode needed).
function LabelPeek({ label }: { label: string }) {
  const [items, setItems] = useState<DomainQuestionPeek[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await postMerges({ action: 'peek', label });
      if (!live) return;
      const data = res.body as { questions?: DomainQuestionPeek[] } | null;
      if (!res.ok || !data) {
        setError('Could not load questions.');
        return;
      }
      setItems(data.questions ?? []);
    })();
    return () => {
      live = false;
    };
  }, [label]);

  return (
    <div
      className="mt-1 rounded-md border p-2 text-quiet"
      style={{ borderColor: 'var(--border)', background: 'var(--brand-field)' }}
    >
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
                {q.source === 'bank' ? ' · machine bank' : ''}
                {q.suppressed ? ' · out of circulation' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChoiceRadio({
  name,
  checked,
  onSelect,
  label,
  hint,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <label
      className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-3 text-sm transition-colors"
      style={
        checked
          ? {
              borderColor: 'var(--brand-navy)',
              background: 'color-mix(in srgb, var(--brand-navy) 6%, transparent)',
            }
          : { borderColor: 'var(--border)' }
      }
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="size-4 accent-[var(--brand-navy)]"
      />
      <span style={{ color: 'var(--brand-ink)' }}>{label}</span>
      {hint ? (
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
