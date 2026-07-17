'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';

import type { AdminReviewReport, BlockedReviewItem } from '@/server/db/queries/content-reports';
import type { MachineDemotionReviewItem } from '@/server/db/queries/machine-demotions';
import { LLM_QUESTION_ATTRIBUTION } from '@/lib/questions-types';
import { AdminTabs } from '@/app/admin/AdminTabs';
import { InfoTerm } from '@/app/admin/InfoTerm';

// Human labels for the two question stores — the raw table names ('question' /
// 'generated') read as opaque status words, so they never render verbatim.
const TARGET_LABEL = { question: 'canonical', generated: 'machine-drafted' } as const;
const TARGET_TERM = { question: 'canonical_question', generated: 'machine_drafted' } as const;

// Deliberately minimal — an internal ops tool, not a product surface. Two views:
// the NEEDING-REVIEW queue (B-CRAFTER-LIFECYCLE-01 Phase 1: player reports and
// machine demotions merged into one list — same card shape, different provenance
// chip and different "concern" source) and the BLOCKED / actioned list
// (un-block / reverse). Both expose admin-only context.
//
// Undo (staged commit): the one-tap queue actions (uphold, dismiss, restore,
// retire, un-block) have NO server-side inverse — dismiss can't re-open,
// restore/retire can't re-demote — so a true undo can't be "act now, reverse
// later." Instead the action is STAGED: the card hides optimistically, a toast
// offers Undo, and the POST fires only when the window lapses — or immediately
// when another action is staged or the page hides (keepalive), so nothing is
// lost. Undo simply cancels the send. The modal's edit flows (re-run / approve
// / save) stay immediate: they're deliberate multi-step acts with their own
// gating, not mis-tappable one-liners.

const UNDO_WINDOW_MS = 6000;

type StagedAction = {
  /** The card this hides while pending — 'report:'/'demotion:'/'blocked:' keyed. */
  key: string;
  /** Toast copy, e.g. "Report upheld". */
  label: string;
  /** The exact /api/admin/content-reports payload to send on commit. */
  body: Record<string, unknown>;
};

export function AdminReportsClient({
  reports,
  demotions,
  blocked,
}: {
  reports: AdminReviewReport[];
  demotions: MachineDemotionReviewItem[];
  blocked: BlockedReviewItem[];
}) {
  const router = useRouter();
  const [view, setView] = useState<'open' | 'blocked'>('open');
  // Optimistic clear: an actioned card leaves immediately and the count ticks
  // down, while router.refresh() reconciles with the server in the background.
  // Keyed by the card's stable id ('report:<id>' / 'demotion:<qid>').
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const clear = (key: string) => setCleared((prev) => new Set(prev).add(key));
  const unclear = (key: string) =>
    setCleared((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  // The one undoable action; its card is hidden while the toast counts down.
  const [staged, setStaged] = useState<StagedAction | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  // Mirror for the pagehide flush — event handlers must not read stale state.
  const stagedRef = useRef<StagedAction | null>(null);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  async function commitStaged(action: StagedAction) {
    clearTimer();
    setStaged((current) => (current?.key === action.key ? null : current));
    clear(action.key); // stays hidden through the POST + background refresh
    const err = await postAdminAction(action.body);
    if (err) {
      // Nothing changed server-side — surface the failure and bring the card
      // back so the action isn't silently lost.
      unclear(action.key);
      setToastError(`${action.label} — ${err.toLowerCase().replace(/\.$/, '')} The card is back below.`);
      return;
    }
    router.refresh();
  }

  function stageAction(action: StagedAction) {
    setToastError(null);
    // One pending action at a time: acting again flushes the previous one now.
    const prior = stagedRef.current;
    clearTimer();
    if (prior) void commitStaged(prior);
    setStaged(action);
    timerRef.current = window.setTimeout(() => void commitStaged(action), UNDO_WINDOW_MS);
  }

  function undoStaged() {
    clearTimer();
    setStaged(null);
  }

  // Leaving the page must not swallow a staged action — send it keepalive.
  // The ref is nulled and the timer killed FIRST: a client-side nav unmounts
  // this component but leaves timers running, and the timer firing after the
  // keepalive send would double-post.
  useEffect(() => {
    const flushOnHide = () => {
      const pending = stagedRef.current;
      if (!pending) return;
      stagedRef.current = null;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setStaged(null);
      void fetch('/api/admin/content-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify(pending.body),
      });
    };
    window.addEventListener('pagehide', flushOnHide);
    return () => {
      window.removeEventListener('pagehide', flushOnHide);
      flushOnHide(); // unmount (client-side nav) flushes too
    };
  }, []);

  const hiddenKey = (key: string) => cleared.has(key) || staged?.key === key;

  // One queue, two labelled sections (the streams used to interleave, telling
  // the reader nothing about why the order was what it was). Player reports:
  // inappropriate pinned first (high-priority), then oldest-first. Demotions:
  // oldest-first, so the longest-suppressed content is reviewed soonest.
  const visibleReports = reports
    .filter((r) => !hiddenKey(`report:${r.id}`))
    .sort((a, b) => {
      const aPin = a.category === 'inappropriate' ? 0 : 1;
      const bPin = b.category === 'inappropriate' ? 0 : 1;
      return aPin - bPin || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  const visibleDemotions = demotions
    .filter((item) => !hiddenKey(`demotion:${item.questionId}`))
    .sort(
      (a, b) =>
        (a.verifiedAt ? new Date(a.verifiedAt).getTime() : 0) -
        (b.verifiedAt ? new Date(b.verifiedAt).getTime() : 0),
    );
  const openCount = visibleReports.length + visibleDemotions.length;
  // D-QUALITY-SALVAGE-01: how many demotions have a ready one-click fix waiting.
  const readyFixCount = demotions.filter(
    (item) => item.proposal && !hiddenKey(`demotion:${item.questionId}`),
  ).length;

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 pt-6 pb-24">
      <header className="mb-5">
        <div className="mb-3">
          <AdminTabs active="reports" needingReviewCount={openCount} />
        </div>
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">Review queue</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Questions out of circulation, waiting on your call — reported by a player or pulled by
          the verifier. Nothing here is deleted until you decide.
        </p>
        <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
          Your calls: <strong>Uphold</strong> agrees with a report and removes the question ·{' '}
          <strong>Dismiss</strong> closes a report <em>permanently</em> ·{' '}
          <strong>Edit &amp; re-run</strong> fixes it and re-verifies · <strong>Restore</strong>{' '}
          puts it back unchanged · <strong>Retire</strong> shelves it (recoverable). One-tap calls
          show a 6-second Undo before anything is sent.
        </p>
        {readyFixCount > 0 ? (
          <p className="mt-2 text-sm font-medium text-[var(--success)]">
            {readyFixCount} {readyFixCount === 1 ? 'has' : 'have'} a suggested fix that re-verifies
            clean — look for “Approve fix”.
          </p>
        ) : null}
        <div className="mt-3 flex gap-4 border-b pb-px" style={{ borderColor: 'var(--border)' }}>
          <TabButton active={view === 'open'} onClick={() => setView('open')}>
            Needing review ({openCount})
          </TabButton>
          <TabButton active={view === 'blocked'} onClick={() => setView('blocked')}>
            Blocked / actioned ({blocked.length})
          </TabButton>
        </div>
      </header>

      {view === 'open' ? (
        <div className="space-y-3">
          {openCount === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing needing review — new player reports and verifier demotions land here.
            </p>
          ) : (
            <>
              {visibleReports.length > 0 ? (
                <SectionHeading
                  label={`Player reports (${visibleReports.length})`}
                  term="player_report"
                />
              ) : null}
              {visibleReports.map((report) => (
                <ReportRow
                  key={report.id}
                  report={report}
                  onCleared={() => clear(`report:${report.id}`)}
                  onStage={stageAction}
                />
              ))}
              {visibleDemotions.length > 0 ? (
                <SectionHeading
                  label={`Verifier demotions (${visibleDemotions.length})`}
                  term="verifier_demotion"
                />
              ) : null}
              {visibleDemotions.map((item) => (
                <DemotionRow
                  key={item.questionId}
                  item={item}
                  onCleared={() => clear(`demotion:${item.questionId}`)}
                  onStage={stageAction}
                />
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {blocked.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing blocked — content removed by an upheld report, a vetting verdict, or a sweep
              lands here and can be un-blocked.
            </p>
          ) : (
            blocked.map((item) =>
              hiddenKey(`blocked:${item.target.table}:${item.target.id}`) ? null : (
                <BlockedRow
                  key={`${item.target.table}:${item.target.id}`}
                  item={item}
                  onStage={stageAction}
                />
              ),
            )
          )}
        </div>
      )}

      {staged || toastError ? (
        <div
          className="fixed inset-x-0 bottom-24 z-[var(--z-toast)] flex justify-center px-4"
          role="status"
          aria-live="polite"
        >
          <div
            className="flex max-w-full items-center gap-3 rounded-full border px-4 py-2.5 text-sm shadow-lg"
            style={{ background: 'var(--brand-card)', borderColor: 'var(--border)' }}
          >
            {toastError ? (
              <>
                <span style={{ color: 'var(--danger)' }}>{toastError}</span>
                <button
                  type="button"
                  onClick={() => setToastError(null)}
                  className="font-semibold underline underline-offset-2"
                  style={{ color: 'var(--brand-ink-700)' }}
                >
                  Dismiss
                </button>
              </>
            ) : staged ? (
              <>
                <span className="text-[var(--brand-ink)]">{staged.label}</span>
                <button
                  type="button"
                  onClick={undoStaged}
                  className="font-semibold underline underline-offset-2"
                  style={{ color: 'var(--brand-navy)' }}
                >
                  Undo
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

// In-page view switcher — underline style, deliberately different from the
// bordered nav pills above so it can't be mistaken for site navigation.
function TabButton({
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
      className="border-b-2 px-0.5 pb-1 text-sm font-medium"
      style={
        active
          ? { borderColor: 'var(--brand-navy)', color: 'var(--brand-ink)' }
          : { borderColor: 'transparent', color: 'var(--text-muted)' }
      }
    >
      {children}
    </button>
  );
}

// A labelled stream divider for the open queue, with the definition one tap
// away (the provenance chips alone made the mixed list hard to scan).
function SectionHeading({
  label,
  term,
}: {
  label: string;
  term: 'player_report' | 'verifier_demotion';
}) {
  return (
    <h2
      className="pt-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
      style={{ color: 'var(--text-muted)' }}
    >
      <InfoTerm term={term}>{label}</InfoTerm>
    </h2>
  );
}

// The edit/re-run flow opens here instead of expanding inline — a bottom sheet
// on a phone, a centered dialog on desktop, so the form + verdict + actions get
// real room and the queue behind it doesn't jump. Esc / ✕ / Cancel close it;
// the scrim deliberately does NOT dismiss, so a mis-tap can't discard an edit
// and a re-run mid-flight.
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center sm:items-center sm:p-4"
      style={{ background: 'var(--scrim)' }}
    >
      <div
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-xl border sm:max-w-lg sm:rounded-xl"
        style={{ background: 'var(--brand-card)', borderColor: 'var(--border)' }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: 'var(--border)', background: 'var(--brand-card)' }}
        >
          <span className="font-serif text-base font-semibold text-[var(--brand-ink)]">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground inline-flex size-9 items-center justify-center rounded-md hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// Clamp a long block to a few lines with a show-more toggle — keeps review
// cards short enough to scan a full queue without endless scrolling.
function ClampText({ text, lines = 3 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  // Only offer the toggle when it's plausibly long enough to clamp.
  const longish = text.length > 180;
  return (
    <span>
      <span
        className="block"
        style={
          open || !longish
            ? undefined
            : {
                display: '-webkit-box',
                WebkitLineClamp: lines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
        }
      >
        {text}
      </span>
      {longish ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground mt-0.5 text-xs underline-offset-2 hover:underline"
        >
          {open ? 'show less' : 'show more'}
        </button>
      ) : null}
    </span>
  );
}

// A rotating progress line for the ~60s re-run (answer generation + grounded
// verify) so the wait reads as work, not a freeze — same idiom as the daily
// loading screen.
const RERUN_PHRASES = [
  'Generating a fresh answer…',
  'Checking it against sources…',
  'Weighing the premise…',
  'Almost there…',
];

function RerunProgress() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setI((n) => (n + 1) % RERUN_PHRASES.length), 2200);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="rounded-md px-3 py-2 text-quiet" style={{ background: 'var(--surface-2)' }}>
      <span className="animate-pulse text-[var(--brand-ink-700)]">{RERUN_PHRASES[i]}</span>
      <span className="mt-2 block h-3 w-2/3 animate-pulse rounded" style={{ background: 'var(--border)' }} />
      <span className="mt-1.5 block h-3 w-1/3 animate-pulse rounded" style={{ background: 'var(--border)' }} />
    </div>
  );
}

// A 401 here comes from the proxy (src/proxy.ts), never the route (which 404s
// non-admins): the session cookie went bad under an open tab. Retrying the
// action can't succeed, so say what actually fixes it instead of a bare code.
const SESSION_EXPIRED_MESSAGE = 'Your session has expired — reload the page and sign in again.';

function proxyErrorCode(res: Response): Promise<string | null> {
  return res
    .clone()
    .json()
    .then((body: { error?: unknown }) => (typeof body.error === 'string' ? body.error : null))
    .catch(() => null);
}

// POST to the admin endpoint, transparently repairing the repairable 401: the
// proxy rejects a legacy JWT missing the `inv` claim with
// {error: 'session_refresh_required'}, and /api/auth/refresh-session (excluded
// from the proxy matcher) re-mints the cookie from the live DB session — so
// one refresh + one retry fixes it without a re-login. A plain
// 'unauthenticated' 401 (expired/cleared cookie) is not repairable here;
// callers surface SESSION_EXPIRED_MESSAGE for any 401 that survives.
async function postContentReports(body: Record<string, unknown>): Promise<Response> {
  const send = () =>
    fetch('/api/admin/content-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  const res = await send();
  if (res.status !== 401 || (await proxyErrorCode(res)) !== 'session_refresh_required') {
    return res;
  }
  // redirect: 'manual' — the endpoint sets the cookie then redirects; the
  // Set-Cookie has landed by the redirect, so the target page isn't needed.
  await fetch('/api/auth/refresh-session', {
    credentials: 'include',
    redirect: 'manual',
  }).catch(() => null);
  return send();
}

async function postAdminAction(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await postContentReports(body);
    if (res.status === 401) return SESSION_EXPIRED_MESSAGE;
    if (!res.ok) return `Action failed (${res.status}).`;
    return null;
  } catch {
    return 'Action failed.';
  }
}

type RerunVerdict = {
  suggestedAnswer: string;
  alternateAnswers: string[];
  explanation: string;
  verdict: 'ok' | 'demoted' | 'unverifiable';
  reason: string;
  usedWeb: boolean;
  verifiedAnswer: string;
};

// Inline editor with the full loop (B-REVIEW-RERUN-01): edit the question →
// re-run it through the LLM for a fresh answer + grounded verdict → approve it
// back into circulation. "Save & re-verify" (edit + async sweep, canonical
// only) stays as the lighter option. Works on both question stores.
function EditPanel({
  target,
  initialQuestion,
  initialAnswer,
  initialExplanation,
  // Report-stream cards don't load the explanation, so the field is hidden and
  // OMITTED from the async-edit payload. Demotion cards carry it.
  showExplanation,
  canonicalSubcategory,
  broadCategory,
  // The reason this question is being edited (verifier reason / reporter note)
  // — repeated inside the panel so the one thing the admin needs while fixing
  // it never scrolls out of sight.
  concern,
  // D-QUALITY-SALVAGE-01: when opened from "Review fix", the salvage sweep has
  // ALREADY re-verified this exact proposed text (that's what makes the card
  // green). Seeding that verdict enables Approve immediately — no redundant
  // second re-run — while any edit re-gates it via edited() below.
  seedVerdict,
  onDone,
  onCancel,
}: {
  target: { table: 'question' | 'generated'; id: string };
  initialQuestion: string;
  initialAnswer: string;
  initialExplanation: string | null;
  showExplanation: boolean;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
  concern?: string | null;
  seedVerdict?: RerunVerdict | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [questionText, setQuestionText] = useState(initialQuestion);
  const [answerText, setAnswerText] = useState(initialAnswer);
  const [explanation, setExplanation] = useState(initialExplanation ?? '');
  const [pending, setPending] = useState<'save' | 'rerun' | 'approve' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rerun, setRerun] = useState<RerunVerdict | null>(seedVerdict ?? null);
  const [dirtySinceRerun, setDirtySinceRerun] = useState(false);

  // Any content edit invalidates a prior verdict — the machine vouched for the
  // old text, not this one. Approve stays gated until a fresh re-run.
  function edited<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      if (rerun) setDirtySinceRerun(true);
    };
  }

  async function rerunNow() {
    if (pending) return;
    if (!questionText.trim()) {
      setError('Question is required.');
      return;
    }
    setPending('rerun');
    setError(null);
    try {
      const res = await postContentReports({
        action: 'rerun_verify',
        questionText: questionText.trim(),
        answerText: answerText.trim() || undefined,
        canonicalSubcategory,
        broadCategory,
      });
      if (!res.ok) {
        setError(
          res.status === 401
            ? SESSION_EXPIRED_MESSAGE
            : res.status === 503
              ? 'The verifier is unavailable right now — try again shortly.'
              : `Re-run failed (${res.status}).`,
        );
        return;
      }
      const body = (await res.json()) as RerunVerdict;
      setRerun(body);
      setDirtySinceRerun(false);
    } catch {
      setError('Re-run failed.');
    } finally {
      setPending(null);
    }
  }

  function adoptSuggestion() {
    if (!rerun) return;
    setAnswerText(rerun.suggestedAnswer);
    if (showExplanation) setExplanation(rerun.explanation);
    setDirtySinceRerun(true); // adopting changes the answer → re-run to re-verify
  }

  async function approve() {
    if (pending) return;
    if (!questionText.trim() || !answerText.trim()) {
      setError('Question and answer are required.');
      return;
    }
    setPending('approve');
    setError(null);
    try {
      const res = await postContentReports({
        action: 'approve',
        target,
        questionText: questionText.trim(),
        answerText: answerText.trim(),
        explanation: showExplanation ? explanation.trim() || null : undefined,
      });
      if (!res.ok) {
        setError(res.status === 401 ? SESSION_EXPIRED_MESSAGE : `Approve failed (${res.status}).`);
        setPending(null);
        return;
      }
      onDone();
    } catch {
      setError('Approve failed.');
      setPending(null);
    }
  }

  // Async edit (canonical only — the generated store's report resolver runs via
  // approve). Clears the stamp; the batch sweep re-checks later.
  async function save() {
    if (pending) return;
    if (!questionText.trim() || !answerText.trim()) {
      setError('Question and answer are required.');
      return;
    }
    setPending('save');
    setError(null);
    const err = await postAdminAction({
      action: 'edit',
      questionId: target.id,
      questionText: questionText.trim(),
      answerText: answerText.trim(),
      ...(showExplanation ? { factualExplanation: explanation.trim() || null } : {}),
    });
    if (err) {
      setError(err);
      setPending(null);
      return;
    }
    onDone();
  }

  const fieldClass =
    'w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1 text-sm focus:border-[var(--brand-navy)]';
  const verdictTone =
    rerun?.verdict === 'ok'
      ? { color: 'var(--success)', background: 'var(--success-surface)' }
      : rerun?.verdict === 'demoted'
        ? { color: 'var(--danger)', background: 'var(--destructive-surface)' }
        : { color: 'var(--warning)', background: 'var(--warning-surface)' };
  const canApprove = rerun !== null && !dirtySinceRerun;

  return (
    <div className="mt-3 space-y-2">
      {concern ? (
        <p
          className="rounded-md px-3 py-2 text-quiet leading-relaxed"
          style={{ background: 'var(--warning-surface)', color: 'var(--brand-ink-700)' }}
        >
          <span className="text-muted-foreground">Fixing — </span>
          {concern}
        </p>
      ) : null}
      <label className="block">
        <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Question</span>
        {/* A generous starting canvas ("the edit area needs to be much larger",
            2026-07-03) — auto-grow still takes over past six lines. */}
        <AutoGrowTextarea
          value={questionText}
          minRows={6}
          onChange={(e) => edited(setQuestionText)(e.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="block">
        <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Answer</span>
        <input
          type="text"
          value={answerText}
          onChange={(e) => edited(setAnswerText)(e.target.value)}
          className={fieldClass}
        />
      </label>
      {showExplanation ? (
        <label className="block">
          <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">
            Explanation (optional)
          </span>
          <AutoGrowTextarea
            value={explanation}
            minRows={3}
            onChange={(e) => edited(setExplanation)(e.target.value)}
            className={fieldClass}
          />
        </label>
      ) : null}

      {/* The re-run verdict — the machine's read on the reworked question. */}
      {pending === 'rerun' ? (
        <RerunProgress />
      ) : rerun ? (
        <div className="rounded-md px-3 py-2 text-quiet leading-relaxed" style={verdictTone}>
          <span className="font-semibold">
            {rerun.verdict === 'ok'
              ? '✓ Verifier: looks correct'
              : rerun.verdict === 'demoted'
                ? '✗ Verifier: still wrong'
                : '? Verifier: couldn’t settle'}
          </span>
          {rerun.usedWeb ? <span className="text-muted-foreground"> · web-checked</span> : null}
          <span className="block">
            <ClampText text={rerun.reason} />
          </span>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[var(--brand-ink-700)]">
            <span>
              Verifier&rsquo;s answer: <strong>{rerun.suggestedAnswer}</strong>
            </span>
            {rerun.suggestedAnswer.trim().toLowerCase() !== answerText.trim().toLowerCase() ? (
              <button
                type="button"
                onClick={adoptSuggestion}
                className="rounded-md border px-2 py-0.5 text-xs font-medium"
                style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)', background: 'var(--brand-card)' }}
              >
                Use this answer
              </button>
            ) : null}
          </div>
          {dirtySinceRerun ? (
            <span className="mt-1 block text-xs text-[var(--brand-ink-700)]">
              You’ve edited since this check — re-run before approving.
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-[0.7rem]">
          Re-run the verifier to get a fresh answer and a fact-check — Approve unlocks once it
          passes.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void rerunNow()}
          disabled={pending !== null}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          {pending === 'rerun' ? 'Re-running…' : rerun ? 'Re-run again' : 'Re-run the verifier'}
        </button>
        <button
          type="button"
          onClick={() => void approve()}
          disabled={pending !== null || !canApprove}
          title={canApprove ? undefined : 'Re-run the verifier first, then approve'}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
        >
          {pending === 'approve' ? 'Approving…' : 'Approve & circulate'}
        </button>
        {target.table === 'question' ? (
          <button
            type="button"
            onClick={() => void save()}
            disabled={pending !== null}
            className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            title="Save the edit and let the nightly sweep re-verify (no immediate check)"
          >
            {pending === 'save' ? 'Saving…' : 'Save & re-verify later'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          disabled={pending !== null}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--border)' }}
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p className="text-quiet" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReportRow({
  report,
  onCleared,
  onStage,
}: {
  report: AdminReviewReport;
  onCleared: () => void;
  onStage: (action: StagedAction) => void;
}) {
  const router = useRouter();
  const [reviewReason, setReviewReason] = useState('');
  const [editing, setEditing] = useState(false);

  // Modal flows (approve / save) land immediately: the card leaves the list
  // (optimistic), then a background refresh reconciles with the server.
  function resolved() {
    onCleared();
    router.refresh();
  }

  // One-tap actions stage instead of posting — the parent's undo toast owns
  // the send (and any failure surfacing).
  function act(action: 'uphold' | 'dismiss') {
    onStage({
      key: `report:${report.id}`,
      label:
        action === 'uphold'
          ? 'Report upheld — question removed from circulation'
          : 'Report dismissed — permanent once this fades',
      body: {
        reportId: report.id,
        action,
        reviewReason: reviewReason.trim() || undefined,
      },
    });
  }

  const kindLabel =
    report.incorrectKind === 'answer_key'
      ? 'answer key'
      : report.incorrectKind === 'premise'
        ? 'question premise'
        : null;

  return (
    <article className="rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Player stream chip — reporter provenance. */}
        <InfoTerm
          term="player_report"
          className="rounded-sm border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em]"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          Player report
        </InfoTerm>
        <span
          className="rounded-sm border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em]"
          style={
            report.category === 'inappropriate'
              ? { borderColor: 'var(--danger)', color: 'var(--danger)' }
              : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
          }
        >
          {report.category}
          {kindLabel ? ` · ${kindLabel}` : ''}
        </span>
        <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">
          <InfoTerm term={TARGET_TERM[report.target.table]}>
            {TARGET_LABEL[report.target.table]}
          </InfoTerm>{' '}
          · {new Date(report.createdAt).toLocaleString()}
        </span>
      </div>

      <p className="mt-2 font-medium text-[var(--brand-ink)]">
        {report.questionText ?? '(question unavailable)'}
      </p>
      {report.correctAnswer ? (
        <p className="text-muted-foreground mt-0.5">Answer: {report.correctAnswer}</p>
      ) : null}

      <div className="mt-2 italic text-[var(--brand-ink-700)]">
        <ClampText text={`“${report.note}”`} />
      </div>
      {report.suggestedAnswer ? (
        <p className="text-muted-foreground mt-0.5">Suggested: {report.suggestedAnswer}</p>
      ) : null}

      {/* Admin-only — reporter identity is exposed nowhere else. */}
      <p className="text-muted-foreground mt-2 text-[0.7rem]">
        Reporter: {report.reporterName ?? report.reporterUserId}
      </p>

      {editing ? (
        <Modal title="Edit &amp; re-run" onClose={() => setEditing(false)}>
          <EditPanel
            target={report.target}
            initialQuestion={report.questionText ?? ''}
            initialAnswer={report.correctAnswer ?? ''}
            initialExplanation={null}
            showExplanation={false}
            canonicalSubcategory={null}
            broadCategory={null}
            concern={`${report.note}${report.suggestedAnswer ? ` (reader suggests: ${report.suggestedAnswer})` : ''}`}
            onDone={resolved}
            onCancel={() => setEditing(false)}
          />
        </Modal>
      ) : null}
      {!editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={reviewReason}
            onChange={(e) => setReviewReason(e.target.value)}
            placeholder="Reason (optional)"
            className="min-w-0 flex-1 rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1 text-sm focus:border-[var(--brand-navy)]"
          />
          <button
            type="button"
            onClick={() => act('uphold')}
            title="Agree with the report — the question is removed from circulation"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
          >
            Uphold
          </button>
          {/* Edit → re-run → approve works on BOTH stores now (B-REVIEW-RERUN-01):
              a reworked generated question re-verifies and returns to the bank. */}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          >
            Edit &amp; re-run
          </button>
          <button
            type="button"
            onClick={() => act('dismiss')}
            title="Close this report for good — a dismissed report cannot be re-opened (Undo is only the 6-second toast)"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: 'var(--border)' }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </article>
  );
}

// Machine stream card — same shape as ReportRow, but the provenance chip names
// the verifier and the "concern" block is the verifier's stored reason instead
// of a reporter note. Actions: restore (verifier was wrong), edit (verifier was
// right — fix it), retire (right, not worth fixing; soft/reversible).
function DemotionRow({
  item,
  onCleared,
  onStage,
}: {
  item: MachineDemotionReviewItem;
  onCleared: () => void;
  onStage: (action: StagedAction) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  // Opened from the "Review fix" button → EditPanel pre-fills the machine's
  // proposed edit (D-QUALITY-SALVAGE-01). The human still re-runs + approves.
  const [fixMode, setFixMode] = useState(false);

  function resolved() {
    onCleared();
    router.refresh();
  }

  function act(action: 'restore_demoted' | 'retire_demoted') {
    onStage({
      key: `demotion:${item.questionId}`,
      label: action === 'restore_demoted' ? 'Restored to circulation' : 'Retired (recoverable)',
      body: { action, questionId: item.questionId },
    });
  }

  function rejectFix() {
    onStage({
      key: `demotion:${item.questionId}`,
      label: 'Suggested fix dismissed',
      body: { action: 'reject_salvage', questionId: item.questionId },
    });
  }

  const proposal = item.proposal;
  function openFix() {
    setFixMode(true);
    setEditing(true);
  }

  // One-click accept of the machine's already-verified fix (D-QUALITY-SALVAGE-01).
  // The salvage sweep re-verified this exact text against the existing answer and
  // only stores it 'ready' when it passes — so approving needs no second re-run.
  // Staged (undoable) and idempotent like the other demotion commits; the field
  // fallbacks mirror what the sweep verified (proposed text, original otherwise).
  function approveFix() {
    if (!proposal) return;
    onStage({
      key: `demotion:${item.questionId}`,
      label: 'Fix approved — back in circulation',
      body: {
        action: 'approve',
        target: { table: 'question', id: item.questionId },
        questionText: proposal.proposedStem ?? item.questionText,
        answerText: item.correctAnswer,
        explanation: proposal.proposedExplanation ?? item.explanation ?? null,
      },
    });
  }

  // The verdict to seed into "Review fix" so Approve is live on open. Honest: it
  // reports the sweep's stored reason against the answer it was verified with.
  const fixSeedVerdict: RerunVerdict | null =
    proposal
      ? {
          suggestedAnswer: item.correctAnswer,
          alternateAnswers: [],
          explanation: proposal.proposedExplanation ?? item.explanation ?? '',
          verdict: 'ok',
          reason: proposal.reverifyReason ?? 'Re-verified clean by the salvage sweep.',
          usedWeb: false,
          verifiedAnswer: item.correctAnswer,
        }
      : null;

  const authorLabel = item.authorIsHouse
    ? 'House · editorial'
    : item.authorName
      ? `Human · ${item.authorName}`
      : `LLM · ${LLM_QUESTION_ATTRIBUTION}`;

  return (
    <article className="rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <InfoTerm
          term="verifier_demotion"
          className="rounded-sm border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em]"
          style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
        >
          Verifier
        </InfoTerm>
        <span
          className="rounded-sm border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          {authorLabel}
        </span>
        <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">
          {item.canonicalSubcategory ?? item.broadCategory ?? 'uncategorized'}
          {item.verifiedAt ? ` · demoted ${new Date(item.verifiedAt).toLocaleString()}` : ''}
        </span>
      </div>

      <p className="mt-2 font-medium text-[var(--brand-ink)]">{item.questionText}</p>
      <p className="text-muted-foreground mt-0.5">Answer: {item.correctAnswer}</p>
      {item.explanation ? (
        <div className="text-muted-foreground mt-0.5 text-quiet">
          <ClampText text={item.explanation} />
        </div>
      ) : null}

      <p
        className="mt-2 rounded-md px-3 py-2 text-quiet"
        style={{ background: 'var(--warning-surface)', color: 'var(--brand-ink-700)' }}
      >
        <span className="text-muted-foreground">The concern — </span>
        {item.verificationReason ?? 'reason not captured (demoted before reasons were stored)'}
      </p>

      {/* D-QUALITY-SALVAGE-01: the salvage sweep now chases every demotion
          automatically (batch-verify cron), so each card tells the human exactly
          where the machine got to: a ready fix (green, one click), a triage
          verdict (no safe fix — genuinely needs a human), or still pending. */}
      {!proposal && item.triage && !editing ? (
        <div
          className="mt-2 rounded-md border px-3 py-2 text-quiet"
          style={{ borderColor: 'var(--border)' }}
        >
          <p className="font-semibold" style={{ color: 'var(--brand-ink-700)' }}>
            No safe machine fix — needs your call
          </p>
          <p className="text-muted-foreground mt-0.5">
            The machine tried and couldn&apos;t produce a fix that passes fact-check — the answer
            or premise itself may be at fault.
            {item.triage.reason ? ` Its note: ${item.triage.reason}` : ''}
          </p>
        </div>
      ) : null}
      {!proposal && !item.triage && !editing ? (
        <p className="text-muted-foreground mt-2 text-[12px] italic">
          Machine fix pending — the salvage sweep proposes one automatically after the next verify
          run. Waiting is free; only step in now if this row is urgent.
        </p>
      ) : null}
      {/* A machine-proposed minimal fix that already re-verified clean.
          Conservative — "Review fix" opens the same edit panel pre-filled; the
          human still re-runs + approves. Nothing auto-applies. */}
      {proposal && !editing ? (
        <div
          className="mt-2 rounded-md border px-3 py-2 text-quiet"
          style={{ borderColor: 'var(--success)', background: 'var(--success-surface, transparent)' }}
        >
          <p className="font-semibold text-[var(--success)]">
            Machine fix ready — verifier re-checked, now passes
          </p>
          <p className="text-muted-foreground mt-0.5">
            {proposal.kind === 'extra_fact_explainer' ? 'Explainer' : 'Question'} edited · {proposal.reverifyReason ?? 'minimal edit'} · Approve returns it
            to circulation with no further re-run.
          </p>
          {proposal.proposedStem ? (
            <p className="mt-1 text-[var(--brand-ink)]">
              <span className="text-muted-foreground">Proposed question: </span>
              {proposal.proposedStem}
            </p>
          ) : null}
          {proposal.proposedExplanation ? (
            <p className="mt-1 text-[var(--brand-ink-700)]">
              <span className="text-muted-foreground">Proposed explainer: </span>
              {proposal.proposedExplanation}
            </p>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <Modal title="Edit &amp; re-run" onClose={() => { setEditing(false); setFixMode(false); }}>
          <EditPanel
            target={{ table: 'question', id: item.questionId }}
            initialQuestion={fixMode && proposal?.proposedStem ? proposal.proposedStem : item.questionText}
            initialAnswer={item.correctAnswer}
            initialExplanation={fixMode && proposal?.proposedExplanation ? proposal.proposedExplanation : item.explanation}
            showExplanation
            canonicalSubcategory={item.canonicalSubcategory}
            broadCategory={item.broadCategory}
            concern={item.verificationReason ?? 'demoted by the verifier (reason not captured)'}
            seedVerdict={fixMode ? fixSeedVerdict : null}
            onDone={resolved}
            onCancel={() => { setEditing(false); setFixMode(false); }}
          />
        </Modal>
      ) : null}
      {!editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {proposal ? (
            <>
              {/* Fast path: accept the already-verified fix in one click, no
                  re-run (D-QUALITY-SALVAGE-01). "Review fix" stays for eyeballing
                  or tweaking first — it opens the panel with Approve already live. */}
              <button
                type="button"
                onClick={approveFix}
                className="rounded-md border px-3 py-1.5 text-sm font-semibold"
                style={{ borderColor: 'var(--success)', background: 'var(--success)', color: 'var(--on-accent, #fff)' }}
              >
                Approve fix
              </button>
              <button
                type="button"
                onClick={openFix}
                className="rounded-md border px-3 py-1.5 text-sm font-medium"
                style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
              >
                Review fix →
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => act('restore_demoted')}
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
          >
            Restore — verifier was wrong
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => act('retire_demoted')}
            title="Shelve it softly — stays out of circulation but can be brought back later"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            Retire (recoverable)
          </button>
          {proposal ? (
            <button
              type="button"
              onClick={rejectFix}
              title="Discard the suggested fix — the question stays here for a manual call"
              className="rounded-md px-2 py-1.5 text-xs font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              Not a fix
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// Human vs. house vs. LLM, derived server-side from source/creatorId (never
// string-matched on the client). Generated rows carry authorName=null and are
// LLM-origin; house questions carry authorIsHouse=true.
function authorBadge(item: BlockedReviewItem): { label: string; tone: 'human' | 'house' | 'llm' } {
  if (item.authorIsHouse) return { label: 'House · editorial', tone: 'house' };
  if (item.target.table === 'generated' || item.authorName === null) {
    return { label: `LLM · ${LLM_QUESTION_ATTRIBUTION}`, tone: 'llm' };
  }
  return { label: `Human · ${item.authorName}`, tone: 'human' };
}

function BlockedRow({
  item,
  onStage,
}: {
  item: BlockedReviewItem;
  onStage: (action: StagedAction) => void;
}) {
  const [reviewReason, setReviewReason] = useState('');
  const [confirming, setConfirming] = useState(false);

  function unblock() {
    onStage({
      key: `blocked:${item.target.table}:${item.target.id}`,
      label: 'Un-blocked — back in circulation',
      body: {
        action: 'reverse',
        target: item.target,
        reviewReason: reviewReason.trim() || undefined,
      },
    });
  }

  const badge = authorBadge(item);
  const badgeStyle =
    badge.tone === 'human'
      ? { borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }
      : badge.tone === 'house'
        ? { borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)' }
        : { borderColor: 'var(--border)', color: 'var(--text-muted)' };

  return (
    <article className="rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-sm border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em]"
          style={badgeStyle}
        >
          {badge.label}
        </span>
        <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">
          <InfoTerm term={TARGET_TERM[item.target.table]}>
            {TARGET_LABEL[item.target.table]}
          </InfoTerm>
          {item.actionedAt ? (
            ` · removed ${new Date(item.actionedAt).toLocaleString()}`
          ) : (
            <>
              {' · '}
              <InfoTerm term="removed_automatically">removed automatically</InfoTerm>
            </>
          )}
        </span>
      </div>

      <p className="mt-2 font-medium text-[var(--brand-ink)]">
        {item.questionText ?? '(question unavailable)'}
      </p>
      {item.correctAnswer ? (
        <p className="text-muted-foreground mt-0.5">Answer: {item.correctAnswer}</p>
      ) : null}

      {!confirming ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          >
            Un-block
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-quiet text-[var(--brand-ink-700)]">
            Un-block this{' '}
            {item.target.table === 'question' ? 'question (restores to public)' : 'generated question'}?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={reviewReason}
              onChange={(e) => setReviewReason(e.target.value)}
              placeholder="Reason (optional)"
              className="min-w-0 flex-1 rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1 text-sm focus:border-[var(--brand-navy)]"
            />
            <button
              type="button"
              onClick={unblock}
              className="rounded-md border px-3 py-1.5 text-sm font-medium"
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
            >
              Confirm un-block
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border px-3 py-1.5 text-sm font-medium"
              style={{ borderColor: 'var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
