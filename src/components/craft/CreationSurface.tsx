'use client';

import { useState } from 'react';

import type { DraftCandidate, DraftTier } from '@/server/crafter/draft-candidates';

// B-CRAFTER-LIFECYCLE-01 — the creation surface, shared by BOTH audiences:
// crafters (Phase 2, /admin/crafter → /api/admin/craft) and invited players
// (Phase 3, /craft/[domain] → /api/craft). One surface, one contract: the
// machine drafts, the human keeps/kills/edits inline; nothing unkept is ever
// served; every kept question is fact-checked before reaching players. The
// player just became a contributor — same tool, honest about it.
export function CreationSurface({
  domain,
  statsLine,
  endpoint,
  variant,
  onBack,
}: {
  domain: string;
  statsLine?: string | null;
  endpoint: string;
  variant: 'crafter' | 'player';
  onBack: () => void;
}) {
  const [tier, setTier] = useState<DraftTier>('deep');
  const [cards, setCards] = useState<CandidateState[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const keptCount = cards.filter((c) => c.status === 'kept').length;

  // The deferred LLM doubt pass: candidates render the moment generation
  // returns; the factual/quality gates run behind and their flags merge into
  // still-open cards a beat later. Best-effort — a gate outage just means
  // fewer machine doubts shown.
  async function streamFlags(drafted: DraftCandidate[], baseIndex: number) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'flags',
          domain,
          candidates: drafted.map((c) => ({
            questionText: c.questionText,
            answer: c.answer,
            difficultyEstimate: c.difficultyEstimate,
          })),
        }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        flagged: Array<{ index: number; flags: DraftCandidate['flags'] }>;
      };
      if (!Array.isArray(body.flagged) || body.flagged.length === 0) return;
      setCards((prev) =>
        prev.map((card, i) => {
          const hit = body.flagged.find((f) => f.index === i - baseIndex);
          if (!hit || card.status === 'killed' || card.status === 'kept') return card;
          return {
            ...card,
            candidate: { ...card.candidate, flags: [...card.candidate.flags, ...hit.flags] },
          };
        }),
      );
    } catch {
      // Best-effort — cards stay flagless.
    }
  }

  async function draftMore() {
    if (drafting) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'draft', domain, tier, count: 4 }),
      });
      if (!res.ok) {
        setDraftError(
          res.status === 503
            ? 'The machine is unavailable right now — try again shortly.'
            : `Draft failed (${res.status}).`,
        );
        return;
      }
      const body = (await res.json()) as { candidates: DraftCandidate[] };
      // Card count only grows here, and `drafting` serializes drafts — so the
      // closure value is the correct base index for the flag merge.
      const baseIndex = cards.length;
      setCards((prev) => [
        ...prev,
        ...body.candidates.map((candidate) => ({ candidate, status: 'open' as const })),
      ]);
      void streamFlags(body.candidates, baseIndex);
    } catch {
      setDraftError('Draft failed.');
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="text-muted-foreground mb-3 inline-flex min-h-9 items-center rounded-md text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        ← back
      </button>

      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold text-[var(--brand-ink)]">{domain}</h2>
        {statsLine ? <span className="text-muted-foreground text-xs">{statsLine}</span> : null}
      </div>
      <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
        {variant === 'player' ? (
          <>
            You clearly know this world — the machine offers starting points, you decide
            what&apos;s worth asking. Kept questions become <em>yours</em>: fact-checked, then
            played by others who love this. (You&apos;ll never be served your own.)
          </>
        ) : (
          <>
            The machine drafts; you decide what&apos;s worth asking. Kept questions enter{' '}
            <em>your</em> set — machine fact-checked before they reach players. Nothing you
            don&apos;t keep is ever served.
          </>
        )}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-muted-foreground text-sm" htmlFor="tier-select">
          Drafting
        </label>
        <select
          id="tier-select"
          value={tier}
          onChange={(e) => setTier(e.target.value as DraftTier)}
          className="min-h-11 rounded-md border bg-[var(--brand-field)] px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <option value="deep">deep cuts (only a real fan knows)</option>
          <option value="shallow">accessible (everyone who plays knows)</option>
        </select>
        <button
          type="button"
          onClick={() => void draftMore()}
          disabled={drafting}
          className="inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          {drafting ? 'Drafting…' : cards.length === 0 ? 'Draft candidates' : 'Draft more'}
        </button>
        <span className="ml-auto text-sm" style={{ color: 'var(--success)' }}>
          {keptCount} kept
        </span>
      </div>
      {draftError ? (
        <p className="mb-3 text-sm" style={{ color: 'var(--danger)' }}>
          {draftError}
        </p>
      ) : null}

      <div className="space-y-3">
        {cards.map((card, i) => (
          <CandidateCard
            key={i}
            state={card}
            domain={domain}
            tier={tier}
            endpoint={endpoint}
            onChange={(next) => setCards((prev) => prev.map((c, j) => (j === i ? next : c)))}
          />
        ))}
        {/* Skeletons while the machine writes — the wait reads as deliberate
            craft, not a stall (same posture as the daily's generating state). */}
        {drafting
          ? Array.from({ length: 3 }, (_, i) => (
              <div
                key={`skeleton-${i}`}
                className="animate-pulse rounded-md border p-4"
                style={{ borderColor: 'var(--border)' }}
                aria-hidden
              >
                <div className="h-3 w-24 rounded" style={{ background: 'var(--surface-2)' }} />
                <div className="mt-3 h-4 w-full rounded" style={{ background: 'var(--surface-2)' }} />
                <div className="mt-2 h-4 w-3/4 rounded" style={{ background: 'var(--surface-2)' }} />
                <div className="mt-3 h-3 w-1/3 rounded" style={{ background: 'var(--surface-2)' }} />
              </div>
            ))
          : null}
      </div>

      {cards.length === 0 && !drafting ? (
        <p className="text-muted-foreground mt-6 text-center text-sm">
          Pick a tier and draft — the machine offers, you judge.
        </p>
      ) : null}
    </div>
  );
}

type CandidateState = {
  candidate: DraftCandidate;
  status: 'open' | 'kept' | 'killed' | 'keeping';
  vetReason?: string;
  error?: string;
};

const FLAG_LABEL: Record<DraftCandidate['flags'][number]['kind'], string> = {
  factual_suspect: 'machine may be fabricating — verify',
  quality: 'quality gate flagged this',
  answer_leak: 'answer appears in the question',
  tier_mismatch: 'tier mismatch',
};

function CandidateCard({
  state,
  domain,
  tier,
  endpoint,
  onChange,
}: {
  state: CandidateState;
  domain: string;
  tier: DraftTier;
  endpoint: string;
  onChange: (next: CandidateState) => void;
}) {
  const { candidate, status } = state;
  const [questionText, setQuestionText] = useState(candidate.questionText);
  const [answer, setAnswer] = useState(candidate.answer);
  const [explainer, setExplainer] = useState(candidate.explainer);

  async function keep() {
    if (status !== 'open') return;
    onChange({ ...state, status: 'keeping', error: undefined });
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'keep',
          domain,
          tier,
          questionText: questionText.trim(),
          answer: answer.trim(),
          explainer: explainer.trim() || undefined,
          machineDraftAnswer: candidate.answer,
          difficultyEstimate: candidate.difficultyEstimate,
          broadCategory: candidate.broadCategory,
        }),
      });
      if (res.status === 422) {
        onChange({ ...state, status: 'killed', error: 'Failed the content check — not kept.' });
        return;
      }
      if (!res.ok) {
        onChange({ ...state, status: 'open', error: `Keep failed (${res.status}).` });
        return;
      }
      const body = (await res.json()) as { vetReason?: string };
      onChange({ ...state, status: 'kept', vetReason: body.vetReason });
    } catch {
      onChange({ ...state, status: 'open', error: 'Keep failed.' });
    }
  }

  if (status === 'kept') {
    return (
      <article
        className="rounded-md border p-4 text-sm"
        style={{ borderColor: 'var(--success)', opacity: 0.85 }}
      >
        <p style={{ color: 'var(--success)' }}>
          ✓ Kept — queued for machine fact-check, then it&apos;s in your set.{' '}
          <span className="text-muted-foreground">
            (Others will play it; you never will — you wrote it.)
          </span>
        </p>
        <p className="text-muted-foreground mt-1 text-xs">{questionText}</p>
      </article>
    );
  }

  if (status === 'killed') {
    // Collapsed to one quiet line — a stack of kills shouldn't read as a
    // graveyard the crafter scrolls past.
    return (
      <article
        className="truncate rounded-md border px-4 py-2 text-xs opacity-50"
        style={{ borderColor: 'var(--border)' }}
        title={candidate.questionText}
      >
        <span className="text-muted-foreground">
          {state.error ?? 'Killed'} · {candidate.questionText}
        </span>
      </article>
    );
  }

  const fieldClass =
    'w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1 text-sm focus:border-[var(--brand-navy)]';

  return (
    <article className="rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">
          machine draft · {candidate.difficultyEstimate}
        </span>
        {candidate.flags.map((flag, i) => (
          <span
            key={i}
            className="rounded-full px-2 py-0.5 text-[0.65rem] font-medium"
            style={
              flag.kind === 'factual_suspect'
                ? { color: 'var(--danger)', background: 'var(--destructive-surface)' }
                : { color: 'var(--warning)', background: 'var(--warning-surface)' }
            }
            title={flag.note}
          >
            {FLAG_LABEL[flag.kind]}
          </span>
        ))}
      </div>

      <textarea
        value={questionText}
        onChange={(e) => setQuestionText(e.target.value)}
        rows={2}
        className={fieldClass}
        aria-label="Question"
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-muted-foreground whitespace-nowrap text-xs">Answer</span>
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className={fieldClass}
          aria-label="Answer"
        />
      </div>
      <textarea
        value={explainer}
        onChange={(e) => setExplainer(e.target.value)}
        rows={2}
        className={`${fieldClass} mt-2`}
        aria-label="Explainer"
      />
      {candidate.flags.length > 0 ? (
        <div
          className="mt-2 rounded-md px-3 py-2 text-xs leading-relaxed"
          style={{ background: 'var(--surface-2)', color: 'var(--brand-ink-700)' }}
        >
          {candidate.flags.map((flag, i) => (
            <p key={i}>{flag.note}</p>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void keep()}
          disabled={status === 'keeping' || !questionText.trim() || !answer.trim()}
          className="inline-flex min-h-11 items-center rounded-md border px-4 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
        >
          {status === 'keeping' ? 'Keeping…' : 'Keep'}
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...state, status: 'killed', error: undefined })}
          disabled={status === 'keeping'}
          className="inline-flex min-h-11 items-center rounded-md border px-4 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          Kill
        </button>
        <span className="text-muted-foreground text-xs">edit inline, then keep</span>
      </div>
      {state.error && status === 'open' ? (
        <p className="mt-2 text-[13px]" style={{ color: 'var(--danger)' }}>
          {state.error}
        </p>
      ) : null}
    </article>
  );
}
