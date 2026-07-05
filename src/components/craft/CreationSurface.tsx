'use client';

import { useRef, useState } from 'react';

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
  // Joshing's suggested answer flow — same model as the regular composer: the
  // machine suggests a fact-checked answer, you adopt it (verified) or say it's
  // wrong and supply your own (which you can then check). Crafter-only bits
  // (difficulty, byline, feeding the pool) stay. There is no sharing here, so the
  // "verified" badge is informational — every kept question is fact-checked
  // server-side before it's served regardless.
  const [suggestedAnswer, setSuggestedAnswer] = useState<string | null>(null);
  const [answerSource, setAnswerSource] = useState<'author' | 'suggestion' | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const suggestedForRef = useRef<string>('');
  // Inline LLM answer check for an author override. A verdict is pinned to the
  // exact (question, answer) pair; editing either makes it stale.
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });

  const hasAnswer = answer.trim().length > 0;
  const usingSuggestion =
    !!suggestedAnswer && (answerSource === 'suggestion' || answersMatch(answer, suggestedAnswer));
  const currentKey = answerPairKey(questionText, answer);

  const fieldClass =
    'w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1 text-sm focus:border-[var(--brand-navy)]';

  // Ask Joshing for a fact-checked answer to the question. Adopts it into an empty
  // answer field (never clobbers one you've started typing); deduped per question.
  async function requestSuggestion() {
    const q = questionText.trim();
    if (!q || suggesting || suggestedForRef.current === q) return;
    suggestedForRef.current = q;
    setSuggesting(true);
    try {
      const res = await fetch('/api/questions/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionText: q }),
      });
      const body = (await res.json().catch(() => null)) as { correctAnswer?: string; explanation?: string } | null;
      if (!res.ok || !body?.correctAnswer) return;
      setSuggestedAnswer(body.correctAnswer);
      if (!answer.trim()) {
        setAnswer(body.correctAnswer);
        setAnswerSource('suggestion');
        if (!explainer.trim() && body.explanation) setExplainer(body.explanation);
      }
    } catch {
      // Best-effort — no suggestion just means you type the answer yourself.
    } finally {
      setSuggesting(false);
    }
  }

  function onAnswerChange(value: string) {
    setAnswer(value);
    setAnswerSource('author');
    setVerify({ status: 'idle' });
  }

  function useSuggestion() {
    if (!suggestedAnswer) return;
    setAnswer(suggestedAnswer);
    setAnswerSource('suggestion');
    setVerify({ status: 'idle' });
  }

  // Fail-open: a checker outage resolves to 'error' and never blocks the add.
  async function checkAnswer() {
    if (!questionText.trim() || !answer.trim()) return;
    const key = answerPairKey(questionText, answer);
    setVerify({ status: 'checking' });
    try {
      const res = await fetch('/api/questions/verify-answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionText: questionText.trim(), answer: answer.trim() }),
      });
      if (!res.ok) {
        setVerify({ status: 'error' });
        return;
      }
      const body = (await res.json()) as { verdict: 'OK' | 'WRONG' | 'UNVERIFIABLE'; correctedAnswer: string | null };
      setVerify(
        body.verdict === 'OK'
          ? { status: 'ok', for: key }
          : body.verdict === 'WRONG'
            ? { status: 'wrong', for: key, corrected: body.correctedAnswer }
            : { status: 'unverifiable', for: key },
      );
    } catch {
      setVerify({ status: 'error' });
    }
  }

  // Shared verdict display for the on-demand check (used by both the override and
  // the no-suggestion paths). Stale verdicts (answer edited since) are hidden.
  function renderCheckVerdict() {
    if (verify.status === 'checking') {
      return <p className="text-muted-foreground mt-2 text-xs">Checking the answer with the LLM…</p>;
    }
    if (verify.status === 'error') {
      return <p className="text-muted-foreground mt-2 text-xs">Couldn&apos;t reach the answer checker — try again.</p>;
    }
    if (verify.status === 'idle' || verify.for !== currentKey) return null;
    if (verify.status === 'ok') {
      return <p className="mt-2 text-xs" style={{ color: 'var(--success)' }}>✓ LLM check: this answer looks correct.</p>;
    }
    if (verify.status === 'unverifiable') {
      return <p className="text-muted-foreground mt-2 text-xs">LLM check: couldn&apos;t verify this one — use your judgement.</p>;
    }
    return (
      <div className="mt-2 rounded-md px-3 py-2 text-xs leading-relaxed" style={{ background: 'var(--warning-surface)', color: 'var(--warning)' }}>
        <p>⚠ LLM check: this answer looks incorrect for the question.</p>
        {verify.corrected ? (
          <>
            <p className="mt-1">Suggested correct answer: <strong>{verify.corrected}</strong></p>
            <button
              type="button"
              onClick={() => { setAnswer(verify.status === 'wrong' ? (verify.corrected ?? answer) : answer); setVerify({ status: 'idle' }); }}
              className="mt-2 rounded-md border px-3 py-1 text-xs font-medium"
              style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
            >
              Apply suggested answer
            </button>
          </>
        ) : null}
      </div>
    );
  }

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
      setSuggestedAnswer(null);
      setAnswerSource(null);
      setVerify({ status: 'idle' });
      suggestedForRef.current = '';
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
      <label className="mb-1 block text-[0.7rem] uppercase tracking-[0.06em] text-muted-foreground">Question</label>
      <AutoGrowTextarea
        value={questionText}
        onChange={(e) => setQuestionText(e.target.value)}
        onBlur={() => void requestSuggestion()}
        placeholder={`Ask something about ${domain}…`}
        className={fieldClass}
        aria-label="Your question"
      />

      <label className="mb-1 mt-3 block text-[0.7rem] uppercase tracking-[0.06em] text-muted-foreground">Correct answer</label>
      <input
        type="text"
        value={answer}
        onChange={(e) => onAnswerChange(e.target.value)}
        className={fieldClass}
        aria-label="Answer"
        placeholder="The answer"
      />

      {/* Answer suggestion + verification — mirrors the regular composer. Joshing
          suggests a fact-checked answer; adopt it (verified) or override & check. */}
      {suggesting ? (
        <p className="text-muted-foreground mt-2 text-xs">Suggesting answer…</p>
      ) : suggestedAnswer ? (
        !hasAnswer ? (
          <div className="mt-2 rounded-md border p-3 text-xs" style={{ borderColor: 'var(--border)' }}>
            <p className="text-muted-foreground uppercase tracking-[0.06em]">Joshing&apos;s answer</p>
            <p className="mt-1 font-medium text-[var(--brand-ink)]">{suggestedAnswer}</p>
            <button
              type="button"
              onClick={useSuggestion}
              className="mt-2 rounded-md border px-3 py-1 text-xs font-medium"
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
            >
              Use Joshing&apos;s answer
            </button>
          </div>
        ) : usingSuggestion ? (
          <div className="mt-2 text-xs">
            <p style={{ color: 'var(--success)' }}>✓ Verified — Joshing checked this answer.</p>
            <p className="text-muted-foreground mt-0.5">Not right? Edit the answer above and check yours.</p>
          </div>
        ) : (
          <div className="mt-2 rounded-md border p-3 text-xs" style={{ borderColor: 'var(--border)' }}>
            <p className="text-muted-foreground">
              Your answer differs from Joshing&apos;s (<span className="font-medium text-[var(--brand-ink)]">{suggestedAnswer}</span>). It&apos;s still machine fact-checked before serving — check yours, or use Joshing&apos;s.
            </p>
            {renderCheckVerdict()}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void checkAnswer()}
                disabled={verify.status === 'checking'}
                className="rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50"
                style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
              >
                Check my answer
              </button>
              <button
                type="button"
                onClick={useSuggestion}
                className="rounded-md border px-3 py-1 text-xs font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                Use Joshing&apos;s answer
              </button>
            </div>
          </div>
        )
      ) : hasAnswer ? (
        // No suggestion (failed or not yet fetched) — still offer an on-demand check.
        <div className="mt-2">
          {renderCheckVerdict()}
          {verify.status !== 'checking' ? (
            <button
              type="button"
              onClick={() => void checkAnswer()}
              className="mt-2 rounded-md border px-3 py-1 text-xs font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Check answer
            </button>
          ) : null}
        </div>
      ) : null}

      <label className="mb-1 mt-3 block text-[0.7rem] uppercase tracking-[0.06em] text-muted-foreground">Explainer (optional)</label>
      <AutoGrowTextarea
        value={explainer}
        onChange={(e) => setExplainer(e.target.value)}
        placeholder="A sentence or two of context"
        className={fieldClass}
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

// On-demand LLM answer check for a card. `for` pins a verdict to the exact
// (question, answer) pair it was computed for, so any later inline edit makes the
// verdict stale and it stops showing (the human must re-check). 'checking'/'error'
// are transient and carry no pair.
type VerifyState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'error' }
  | { status: 'ok'; for: string }
  | { status: 'unverifiable'; for: string }
  | { status: 'wrong'; for: string; corrected: string | null };

function answerPairKey(questionText: string, answer: string): string {
  return `${questionText.trim()} ${answer.trim()}`;
}

function answersMatch(a: string, b: string | null): boolean {
  if (!b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

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
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });

  const currentKey = answerPairKey(questionText, answer);
  // A verdict only counts for the answer it was computed against — an edit since
  // then makes it stale. Transient states (checking/error) always show.
  const verdictForCurrent =
    (verify.status === 'ok' || verify.status === 'unverifiable' || verify.status === 'wrong')
    && verify.for === currentKey;
  // Did the human change the machine's draft answer/question? Only edited cards
  // need re-verification before keep — an untouched draft was already gated.
  const dirty =
    answer.trim() !== candidate.answer.trim()
    || questionText.trim() !== candidate.questionText.trim();

  // Ask the LLM whether the current answer is correct for the current question.
  // Fail-open: a checker outage resolves to 'error' and never blocks keep.
  async function checkAnswer(): Promise<VerifyState> {
    const key = answerPairKey(questionText, answer);
    if (!questionText.trim() || !answer.trim()) return { status: 'idle' };
    setVerify({ status: 'checking' });
    try {
      const res = await fetch('/api/questions/verify-answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionText: questionText.trim(), answer: answer.trim() }),
      });
      if (!res.ok) {
        const next: VerifyState = { status: 'error' };
        setVerify(next);
        return next;
      }
      const body = (await res.json()) as {
        verdict: 'OK' | 'WRONG' | 'UNVERIFIABLE';
        correctedAnswer: string | null;
      };
      const next: VerifyState =
        body.verdict === 'OK'
          ? { status: 'ok', for: key }
          : body.verdict === 'WRONG'
            ? { status: 'wrong', for: key, corrected: body.correctedAnswer }
            : { status: 'unverifiable', for: key };
      setVerify(next);
      return next;
    } catch {
      const next: VerifyState = { status: 'error' };
      setVerify(next);
      return next;
    }
  }

  function applyCorrection(corrected: string) {
    setAnswer(corrected);
    // The pair just changed — clear the stale WRONG verdict so the human can
    // re-check the corrected answer.
    setVerify({ status: 'idle' });
  }

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

  async function keep(opts?: { force?: boolean }) {
    if (status !== 'open') return;
    // If the human edited the draft and this exact answer hasn't been confirmed,
    // run the LLM check before committing. A WRONG verdict halts the keep and
    // surfaces the correction; the human can fix it, re-check, or "Keep anyway"
    // (opts.force). OK/UNVERIFIABLE/checker-error fall through (fail-open — the
    // server keep path still vets, and an outage must not block honest keeps).
    if (!opts?.force && dirty && !(verify.status === 'ok' && verify.for === currentKey)) {
      const result = await checkAnswer();
      if (result.status === 'wrong') return;
    }
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

      {/* LLM answer check. Shows the verdict for the CURRENT (question, answer)
          pair; an inline edit makes a prior verdict stale and it disappears until
          re-checked. A WRONG verdict offers the corrected answer to apply. */}
      {verify.status === 'checking' ? (
        <p className="text-muted-foreground mt-2 text-xs">Checking the answer with the LLM…</p>
      ) : verify.status === 'error' ? (
        <p className="text-muted-foreground mt-2 text-xs">Couldn&apos;t reach the answer checker — try again.</p>
      ) : verdictForCurrent && verify.status === 'ok' ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--success)' }}>✓ LLM check: this answer looks correct.</p>
      ) : verdictForCurrent && verify.status === 'unverifiable' ? (
        <p className="text-muted-foreground mt-2 text-xs">LLM check: couldn&apos;t verify this one — use your judgement.</p>
      ) : verdictForCurrent && verify.status === 'wrong' ? (
        <div
          className="mt-2 rounded-md px-3 py-2 text-xs leading-relaxed"
          style={{ background: 'var(--warning-surface)', color: 'var(--warning)' }}
        >
          <p>⚠ LLM check: this answer looks incorrect for the question.</p>
          {verify.corrected ? (
            <p className="mt-1">
              Suggested correct answer: <strong>{verify.corrected}</strong>
            </p>
          ) : null}
          {verify.corrected ? (
            <button
              type="button"
              onClick={() => applyCorrection(verify.corrected!)}
              className="mt-2 rounded-md border px-3 py-1 text-xs font-medium"
              style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
            >
              Apply suggested answer
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void keep()}
          disabled={status === 'keeping' || verify.status === 'checking' || !questionText.trim() || !answer.trim()}
          className="inline-flex min-h-11 items-center rounded-md border px-4 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
        >
          {status === 'keeping' ? 'Keeping…' : verify.status === 'checking' ? 'Checking…' : 'Keep'}
        </button>
        {verdictForCurrent && verify.status === 'wrong' ? (
          <button
            type="button"
            onClick={() => void keep({ force: true })}
            disabled={status === 'keeping'}
            className="inline-flex min-h-11 items-center rounded-md border px-4 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
          >
            Keep anyway
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void checkAnswer()}
            disabled={status === 'keeping' || verify.status === 'checking' || !questionText.trim() || !answer.trim()}
            className="inline-flex min-h-11 items-center rounded-md border px-4 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            Check answer
          </button>
        )}
        <button
          type="button"
          onClick={kill}
          disabled={status === 'keeping'}
          className="inline-flex min-h-11 items-center rounded-md border px-4 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          Kill
        </button>
        <span className="text-muted-foreground text-xs">edit inline · check · keep</span>
      </div>
      {state.error && status === 'open' ? (
        <p className="mt-2 text-[13px]" style={{ color: 'var(--danger)' }}>
          {state.error}
        </p>
      ) : null}
    </article>
  );
}
