'use client';

import { useState } from 'react';

import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import type { DraftCandidate, DraftTier } from '@/server/crafter/draft-candidates';

// B-CRAFTER-LIFECYCLE-01 — the creation surface, shared by BOTH audiences:
// crafters (Phase 2, /admin/crafter → /api/admin/craft) and invited players
// (Phase 3, /craft/[domain] → /api/craft). One surface, one contract: the
// machine drafts, the human keeps/kills/edits inline; nothing unkept is ever
// served; every kept question is fact-checked before reaching players. The
// player just became a contributor — same tool, honest about it.
// Public bylines a crafter can keep under. 'machine' and 'house' set
// creatorId NULL server-side — the keeper still signs the decision ledger,
// and (a real consequence) CAN then be served the question themselves,
// since author-exclusion keys on creatorId.
export type KeepAttribution = 'self' | 'machine' | 'house';

const ATTRIBUTION_LABEL: Record<KeepAttribution, string> = {
  self: 'me',
  machine: 'Maid Acasa (the machine)',
  house: 'Joshing (the house)',
};

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
  // Crafter-only byline choice, applied to every keep on this surface. The
  // player surface always keeps as themselves — that's its whole premise.
  const [attribution, setAttribution] = useState<KeepAttribution>('self');
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
      {variant === 'crafter' ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="text-muted-foreground text-sm" htmlFor="attribution-select">
            Questions by
          </label>
          <select
            id="attribution-select"
            value={attribution}
            onChange={(e) => setAttribution(e.target.value as KeepAttribution)}
            className="min-h-11 rounded-md border bg-[var(--brand-field)] px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="self">{ATTRIBUTION_LABEL.self}</option>
            <option value="machine">{ATTRIBUTION_LABEL.machine}</option>
            <option value="house">{ATTRIBUTION_LABEL.house}</option>
          </select>
          {attribution !== 'self' ? (
            <span className="text-muted-foreground text-xs">
              byline: {ATTRIBUTION_LABEL[attribution]} — and you can be served these yourself
            </span>
          ) : null}
        </div>
      ) : null}
      {draftError ? (
        <p className="mb-3 text-sm" style={{ color: 'var(--danger)' }}>
          {draftError}
        </p>
      ) : null}

      {/* Write your own — same rail as a kept draft: inline vet now, batch
          fact-check before it's vouched for. Nothing enters unverified. */}
      {variant === 'crafter' ? (
        <OwnQuestionCard domain={domain} tier={tier} endpoint={endpoint} attribution={attribution} />
      ) : null}

      <div className="space-y-3">
        {cards.map((card, i) => (
          <CandidateCard
            key={i}
            state={card}
            domain={domain}
            tier={tier}
            endpoint={endpoint}
            attribution={variant === 'crafter' ? attribution : 'self'}
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

// "I also want the ability to add my own ones here — but still verified by
// the LLM" (2026-07-03). A blank card on the SAME keep rail as machine
// drafts: inline vet decides servability now, verifiedAt stays NULL so the
// batch sweep fact-checks it before it's vouched for. origin='own' records
// answerSource creator_written (no machine draft behind it).
function OwnQuestionCard({
  domain,
  tier,
  endpoint,
  attribution,
}: {
  domain: string;
  tier: DraftTier;
  endpoint: string;
  attribution: KeepAttribution;
}) {
  const [open, setOpen] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [answer, setAnswer] = useState('');
  const [explainer, setExplainer] = useState('');
  const [difficulty, setDifficulty] = useState<'accessible' | 'moderate' | 'specialist'>(
    tier === 'deep' ? 'specialist' : 'accessible',
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keptCount, setKeptCount] = useState(0);

  const fieldClass =
    'w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1 text-sm focus:border-[var(--brand-navy)]';

  async function keepOwn() {
    if (pending || !questionText.trim() || !answer.trim()) return;
    setPending(true);
    setError(null);
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
          difficultyEstimate: difficulty,
          broadCategory: 'General Knowledge',
          attribution,
          origin: 'own',
        }),
      });
      if (res.status === 422) {
        setError('Failed the content check — not kept.');
        return;
      }
      if (!res.ok) {
        setError(`Keep failed (${res.status}).`);
        return;
      }
      // Clear for the next one; the count is the receipt.
      setQuestionText('');
      setAnswer('');
      setExplainer('');
      setKeptCount((n) => n + 1);
    } catch {
      setError('Keep failed.');
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-dashed px-3 text-sm font-medium"
        style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
      >
        + Write your own question{keptCount > 0 ? ` (${keptCount} added)` : ''}
      </button>
    );
  }

  return (
    <article className="mb-3 rounded-md border p-4 text-sm" style={{ borderColor: 'var(--brand-navy)' }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">
          your own question · still machine fact-checked before serving
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground text-xs underline-offset-2 hover:underline"
        >
          close
        </button>
      </div>
      <AutoGrowTextarea
        value={questionText}
        onChange={(e) => setQuestionText(e.target.value)}
        placeholder={`Ask something about ${domain}…`}
        className={fieldClass}
        aria-label="Your question"
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
      <AutoGrowTextarea
        value={explainer}
        onChange={(e) => setExplainer(e.target.value)}
        placeholder="Explainer (optional) — a sentence or two of context"
        className={`${fieldClass} mt-2`}
        aria-label="Explainer"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
          className="min-h-11 rounded-md border bg-[var(--brand-field)] px-2 py-1.5 text-sm"
          style={{ borderColor: 'var(--border)' }}
          aria-label="Difficulty"
        >
          <option value="accessible">accessible (anyone could know)</option>
          <option value="moderate">moderate (needs real interest)</option>
          <option value="specialist">specialist (only a fan knows)</option>
        </select>
        <button
          type="button"
          onClick={() => void keepOwn()}
          disabled={pending || !questionText.trim() || !answer.trim()}
          className="inline-flex min-h-11 items-center rounded-md border px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
        >
          {pending ? 'Adding…' : 'Add — fact-check queued'}
        </button>
        {keptCount > 0 ? (
          <span className="text-xs" style={{ color: 'var(--success)' }}>
            {keptCount} added this session
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
    </article>
  );
}

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
  attribution,
  onChange,
}: {
  state: CandidateState;
  domain: string;
  tier: DraftTier;
  endpoint: string;
  attribution: KeepAttribution;
  onChange: (next: CandidateState) => void;
}) {
  const { candidate, status } = state;
  const [questionText, setQuestionText] = useState(candidate.questionText);
  const [answer, setAnswer] = useState(candidate.answer);
  const [explainer, setExplainer] = useState(candidate.explainer);

  // The kill is instant client-side (the card collapses immediately) and the
  // verdict is reported to the decision ledger fire-and-forget — teaching data
  // only (B-CRAFTER-DECISION-LEDGER-01), so a failed report never resurrects
  // the card. The current field values ride along: killing an edited draft
  // records what the human actually saw and rejected.
  function kill() {
    onChange({ ...state, status: 'killed', error: undefined });
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'kill',
        domain,
        tier,
        questionText: questionText.trim() || candidate.questionText,
        answer: answer.trim() || candidate.answer,
        flags: candidate.flags,
      }),
    }).catch(() => {});
  }

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
          flags: candidate.flags,
          attribution,
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

      <AutoGrowTextarea
        value={questionText}
        onChange={(e) => setQuestionText(e.target.value)}
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
      <AutoGrowTextarea
        value={explainer}
        onChange={(e) => setExplainer(e.target.value)}
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
          onClick={kill}
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
