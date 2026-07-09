'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AdminTabs } from '@/app/admin/AdminTabs';

// D-DOMAIN-MERGE-REVIEW-REDESIGN-01 — the redesigned near-duplicate review list.
// The old design (never shipped past the weekly email) would have been five flat
// pills per row: Keep A, Keep B, Leave, A under B, B under A. This replaces that
// with PROGRESSIVE DISCLOSURE — the real decision is two-level (is this pair
// related? → if so, how?), so a collapsed row shows just Merge/Nest + Dismiss,
// and expanding reveals the four specific choices grouped by scope.
//
// Styling matches the sibling /admin/knowledge tree editor (rounded-md, brand
// tokens, --brand-navy primary, --success/--danger reserved) so the two rooms of
// the knowledge tool read as one surface, per AdminTabs' whole reason to exist.

export type MergeReviewPair = {
  domainA: string;
  domainB: string;
  depthA: number;
  depthB: number;
  /** pg_trgm similarity, 0..1. */
  similarity: number;
  keyA: string;
  keyB: string;
  /** Whether each side exists as a KnowledgeNode — merge/nest need both. */
  inGraphA: boolean;
  inGraphB: boolean;
};

type ActionKind = 'keepA' | 'keepB' | 'aUnderB' | 'bUnderA';

// How long the optimistic toast stays before the action actually commits. Undo
// within the window means we never call the API at all — the cleanest possible
// "commit nothing", and the only honest undo for a merge (which is irreversible
// once the server runs it). Nest could be un-done by deleting the edge, but the
// same deferred-commit path gives one uniform, atomic restore for all four.
const UNDO_MS = 6000;

const pairId = (p: MergeReviewPair) => `${p.keyA}__${p.keyB}`;
// A pair only counts as "big" (worth a confirm tap on the destructive Dismiss)
// when its combined question depth is substantial — a mis-tap there costs real
// re-surfacing work. Small pairs dismiss immediately.
const BIG_PAIR_DEPTH = 20;

type QuestionPeek = { text: string; answer: string; suppressed: boolean };

async function post(body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
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

// The four concrete choices, resolved against a pair. Keep-X folds the OTHER
// side into X (merge_node source=other, target=kept). X-under-Y draws a
// containment edge (attach_child child=X, parent=Y). The human-readable label
// is what the undo toast announces.
function actionSpec(
  pair: MergeReviewPair,
  action: ActionKind,
): { label: string; body: Record<string, unknown> } {
  switch (action) {
    case 'keepA':
      return {
        label: `Merged into “${pair.domainA}”`,
        body: { action: 'merge_node', sourceDomainKey: pair.keyB, targetDomainKey: pair.keyA },
      };
    case 'keepB':
      return {
        label: `Merged into “${pair.domainB}”`,
        body: { action: 'merge_node', sourceDomainKey: pair.keyA, targetDomainKey: pair.keyB },
      };
    case 'aUnderB':
      return {
        label: `Nested “${pair.domainA}” under “${pair.domainB}”`,
        body: { action: 'attach_child', childDomainKey: pair.keyA, toParentDomainKey: pair.keyB },
      };
    case 'bUnderA':
      return {
        label: `Nested “${pair.domainB}” under “${pair.domainA}”`,
        body: { action: 'attach_child', childDomainKey: pair.keyB, toParentDomainKey: pair.keyA },
      };
  }
}

type Pending = { id: string; label: string; pair: MergeReviewPair; body: Record<string, unknown> };

export function MergeReviewClient({ pairs }: { pairs: MergeReviewPair[] }) {
  // Server truth stays in props; the client only tracks what to HIDE (rows a
  // dismiss/apply optimistically removed) so a router refresh or reload — which
  // re-excludes committed/dismissed pairs server-side — reconciles cleanly.
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

  // Commit the pending action for real: run the merge/nest, then record the pair
  // as reviewed so it never resurfaces (a nest leaves both labels intact, so
  // without this the near-duplicate would recompute right back onto the list).
  const commitPending = useCallback(async () => {
    const pend = pendingRef.current;
    if (!pend) return;
    pendingRef.current = null;
    setPending(null);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const res = await post(pend.body);
    if (!res.ok) {
      unhide(pend.id); // put the row back and surface the failure
      setError(`Couldn’t apply — ${pend.label} failed (${res.status}). The pair is back in the list.`);
      return;
    }
    await post({ action: 'dismiss_pair', domainA: pend.pair.domainA, domainB: pend.pair.domainB });
  }, [unhide]);

  // A new action auto-commits whatever was still pending (one toast at a time).
  const flushPending = useCallback(() => {
    if (pendingRef.current) void commitPending();
  }, [commitPending]);

  useEffect(() => {
    // Leaving the page mid-window commits the in-flight action rather than
    // silently dropping it (the curator already made the call).
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void commitPending();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(pair: MergeReviewPair, action: ActionKind) {
    flushPending();
    const spec = actionSpec(pair, action);
    const id = pairId(pair);
    setError(null);
    setExpandedId(null);
    hide(id);
    const pend: Pending = { id, label: spec.label, pair, body: spec.body };
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
    unhide(pend.id); // restores row position AND edge/label state — nothing committed
  }

  async function dismiss(pair: MergeReviewPair) {
    flushPending();
    const id = pairId(pair);
    setError(null);
    setExpandedId(null);
    hide(id);
    const res = await post({ action: 'dismiss_pair', domainA: pair.domainA, domainB: pair.domainB });
    if (!res.ok) {
      unhide(id);
      setError(`Couldn’t dismiss that pair (${res.status}).`);
    }
  }

  const visible = pairs.filter((p) => !removed.has(pairId(p)));

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 pt-6 pb-24">
      <header className="mb-5">
        <h1 className="mb-3 font-serif text-2xl font-semibold text-[var(--brand-ink)]">
          Merge review
        </h1>
        <AdminTabs active="knowledge" />
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Near-duplicate territory pairs the automated reconcile deliberately left for a human call.
          For each, decide: <strong>same scope</strong> (merge them into one) or{' '}
          <strong>different scope</strong> (nest one under the other) — or{' '}
          <strong>Dismiss</strong> if they’re genuinely two things (a work vs its genre). Dismiss is
          permanent; merge/nest give you a few seconds to undo.{' '}
          <Link href="/admin/knowledge" className="underline">
            Back to the tree
          </Link>
          .
        </p>
      </header>

      {error ? (
        <p className="mb-3 text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-muted-foreground rounded-md border px-3 py-6 text-center text-sm" style={{ borderColor: 'var(--border)' }}>
          Nothing to review — no near-duplicate pairs above the similarity threshold.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((pair) => (
            <MergeReviewRow
              key={pairId(pair)}
              pair={pair}
              expanded={expandedId === pairId(pair)}
              onToggle={() =>
                setExpandedId((cur) => (cur === pairId(pair) ? null : pairId(pair)))
              }
              onApply={(action) => apply(pair, action)}
              onDismiss={() => void dismiss(pair)}
            />
          ))}
        </div>
      )}

      {/* Persist-with-undo toast (Part 2) — one at a time, fixed in reach. */}
      {pending ? (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3">
          <div
            className="flex w-full max-w-lg items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-[var(--shadow-overlay)]"
            style={{ background: 'var(--brand-card)', borderColor: 'var(--brand-navy)', color: 'var(--brand-ink-700)' }}
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
    </main>
  );
}

function badge(inGraph: boolean) {
  return inGraph ? (
    <span
      className="ml-1 shrink-0 rounded-sm px-1 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.06em]"
      style={{ color: 'var(--brand-navy)', background: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }}
      title="This territory exists as a node in the knowledge graph"
    >
      in graph
    </span>
  ) : (
    <span
      className="ml-1 shrink-0 rounded-sm px-1 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.06em]"
      style={{ color: 'var(--warning)', background: 'var(--warning-surface)' }}
      title="Not yet a node in the graph — add it in the tree before you can merge or nest it"
    >
      not in graph
    </span>
  );
}

function MergeReviewRow({
  pair,
  expanded,
  onToggle,
  onApply,
  onDismiss,
}: {
  pair: MergeReviewPair;
  expanded: boolean;
  onToggle: () => void;
  onApply: (action: ActionKind) => void;
  onDismiss: () => void;
}) {
  const [choice, setChoice] = useState<ActionKind | null>(null);
  const [preview, setPreview] = useState<{ a: QuestionPeek[]; b: QuestionPeek[] } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);

  const bothInGraph = pair.inGraphA && pair.inGraphB;
  // The ★ keep marker annotates the side holding MORE questions (existing logic).
  const starSide: 'A' | 'B' | null =
    pair.depthA === pair.depthB ? null : pair.depthA > pair.depthB ? 'A' : 'B';
  const pct = Math.round(pair.similarity * 100);
  const bigPair = pair.depthA + pair.depthB >= BIG_PAIR_DEPTH;

  async function loadPreview() {
    if (previewBusy) return;
    if (preview) {
      setPreview(null); // toggle closed
      return;
    }
    setPreviewBusy(true);
    const [a, b] = await Promise.all([
      post({ action: 'list_questions', domainKey: pair.keyA }),
      post({ action: 'list_questions', domainKey: pair.keyB }),
    ]);
    const rows = (r: { ok: boolean; body: unknown }): QuestionPeek[] =>
      r.ok && r.body && typeof r.body === 'object' && 'questions' in r.body
        ? ((r.body as { questions: QuestionPeek[] }).questions ?? [])
        : [];
    setPreview({ a: rows(a), b: rows(b) });
    setPreviewBusy(false);
  }

  const menuBtn =
    'inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:opacity-40';

  return (
    <div
      className="rounded-md border transition-colors"
      style={{ borderColor: expanded ? 'var(--brand-navy)' : 'var(--border)' }}
    >
      {/* ── Collapsed row header ── */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex min-w-0 items-center text-sm font-medium text-[var(--brand-ink)]">
              <span className="truncate">{pair.domainA}</span>
              {badge(pair.inGraphA)}
            </span>
            <span className="text-muted-foreground text-xs" aria-hidden>
              ≈
            </span>
            <span className="flex min-w-0 items-center text-sm font-medium text-[var(--brand-ink)]">
              <span className="truncate">{pair.domainB}</span>
              {badge(pair.inGraphB)}
            </span>
            <span
              className="ml-auto shrink-0 text-xs font-semibold"
              style={{ color: 'var(--brand-ink-700)' }}
              title="Trigram similarity"
            >
              {pct}%
            </span>
          </div>
          <div className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
            <span>
              {pair.depthA} question{pair.depthA === 1 ? '' : 's'}
              {starSide === 'A' ? ' · ★ more' : ''}
            </span>
            <span>
              {pair.depthB} question{pair.depthB === 1 ? '' : 's'}
              {starSide === 'B' ? ' · ★ more' : ''}
            </span>
          </div>
        </div>

        {/* Exactly two controls when collapsed — primary Merge/Nest + quiet Dismiss. */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className={menuBtn}
            style={
              expanded
                ? { borderColor: 'var(--brand-navy)', background: 'var(--brand-navy)', color: 'var(--brand-cream-page)' }
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
              className="text-muted-foreground inline-flex min-h-11 items-center px-2 text-sm font-medium underline underline-offset-4 hover:text-[var(--brand-ink)]"
              title="These are genuinely two different territories — never show this pair again"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>

      {/* ── Expanded drawer ── */}
      {expanded ? (
        <div className="border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
          {!bothInGraph ? (
            <p className="text-muted-foreground text-sm leading-relaxed">
              Merge and nest both act on graph nodes, but{' '}
              {!pair.inGraphA && !pair.inGraphB
                ? 'neither territory is'
                : `“${pair.inGraphA ? pair.domainB : pair.domainA}” is not`}{' '}
              in the graph yet. Add it in the{' '}
              <Link href="/admin/knowledge" className="underline">
                tree
              </Link>{' '}
              first, then come back — or Dismiss if they’re different scopes.
            </p>
          ) : (
            <fieldset className="space-y-4">
              <legend className="sr-only">Choose how to resolve this pair</legend>

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-ink-700)]">
                  Same scope — merge into one domain
                </p>
                <div className="space-y-1">
                  <ChoiceRadio
                    name={`${pairId(pair)}-choice`}
                    checked={choice === 'keepA'}
                    onSelect={() => setChoice('keepA')}
                    label={`Keep “${pair.domainA}”`}
                    hint={`${pair.depthA} q${starSide === 'A' ? '  ★ more questions' : ''}`}
                  />
                  <ChoiceRadio
                    name={`${pairId(pair)}-choice`}
                    checked={choice === 'keepB'}
                    onSelect={() => setChoice('keepB')}
                    label={`Keep “${pair.domainB}”`}
                    hint={`${pair.depthB} q${starSide === 'B' ? '  ★ more questions' : ''}`}
                  />
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-ink-700)]">
                  Different scope — nest one under the other
                </p>
                <div className="space-y-1">
                  <ChoiceRadio
                    name={`${pairId(pair)}-choice`}
                    checked={choice === 'aUnderB'}
                    onSelect={() => setChoice('aUnderB')}
                    label={`“${pair.domainA}” under “${pair.domainB}”`}
                  />
                  <ChoiceRadio
                    name={`${pairId(pair)}-choice`}
                    checked={choice === 'bUnderA'}
                    onSelect={() => setChoice('bUnderA')}
                    label={`“${pair.domainB}” under “${pair.domainA}”`}
                  />
                </div>
              </div>

              {preview ? (
                <div className="grid gap-3 rounded-md border p-2 sm:grid-cols-2" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                  <PreviewColumn title={pair.domainA} rows={preview.a} />
                  <PreviewColumn title={pair.domainB} rows={preview.b} />
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadPreview()}
                  disabled={previewBusy}
                  className={menuBtn}
                  style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
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
          )}
        </div>
      ) : null}
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
          ? { borderColor: 'var(--brand-navy)', background: 'color-mix(in srgb, var(--brand-navy) 6%, transparent)' }
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
      <span className="text-[var(--brand-ink)]">{label}</span>
      {hint ? <span className="text-muted-foreground ml-auto text-xs">{hint}</span> : null}
    </label>
  );
}

function PreviewColumn({ title, rows }: { title: string; rows: QuestionPeek[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 truncate text-xs font-semibold text-[var(--brand-ink-700)]" title={title}>
        {title} · {rows.length} shown
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">No questions found.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((q, i) => (
            <li
              key={i}
              className="text-muted-foreground truncate text-xs"
              style={q.suppressed ? { opacity: 0.5 } : undefined}
              title={`${q.text} — ${q.answer}`}
            >
              {q.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
