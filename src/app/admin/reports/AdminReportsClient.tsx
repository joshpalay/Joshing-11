'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { AdminReviewReport, BlockedReviewItem } from '@/server/db/queries/content-reports';
import type { MachineDemotionReviewItem } from '@/server/db/queries/machine-demotions';
import { LLM_QUESTION_ATTRIBUTION } from '@/lib/questions-types';
import { AdminTabs } from '@/app/admin/AdminTabs';

// Deliberately minimal — an internal ops tool, not a product surface. Two views:
// the NEEDING-REVIEW queue (B-CRAFTER-LIFECYCLE-01 Phase 1: player reports and
// machine demotions merged into one list — same card shape, different provenance
// chip and different "concern" source) and the BLOCKED / actioned list
// (un-block / reverse). Both expose admin-only context.
export function AdminReportsClient({
  reports,
  demotions,
  blocked,
}: {
  reports: AdminReviewReport[];
  demotions: MachineDemotionReviewItem[];
  blocked: BlockedReviewItem[];
}) {
  const [view, setView] = useState<'open' | 'blocked'>('open');
  // Optimistic clear: an actioned card leaves immediately and the count ticks
  // down, while router.refresh() reconciles with the server in the background.
  // Keyed by the card's stable id ('report:<id>' / 'demotion:<qid>').
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const clear = (key: string) => setCleared((prev) => new Set(prev).add(key));

  // One queue, two streams. Player inappropriate reports stay pinned first
  // (high-priority, matching the query's ordering); everything else — incorrect
  // reports and machine demotions — merges oldest-first so the longest-suppressed
  // content is reviewed soonest.
  const inappropriate = reports.filter(
    (r) => r.category === 'inappropriate' && !cleared.has(`report:${r.id}`),
  );
  const rest: Array<
    | { kind: 'report'; at: number; report: AdminReviewReport }
    | { kind: 'demotion'; at: number; item: MachineDemotionReviewItem }
  > = [
    ...reports
      .filter((r) => r.category !== 'inappropriate' && !cleared.has(`report:${r.id}`))
      .map((report) => ({ kind: 'report' as const, at: new Date(report.createdAt).getTime(), report })),
    ...demotions
      .filter((item) => !cleared.has(`demotion:${item.questionId}`))
      .map((item) => ({
        kind: 'demotion' as const,
        at: item.verifiedAt ? new Date(item.verifiedAt).getTime() : 0,
        item,
      })),
  ].sort((a, b) => a.at - b.at);
  const openCount = inappropriate.length + rest.length;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="mb-3 font-serif text-2xl font-semibold text-[var(--brand-ink)]">
          Review queue
        </h1>
        <AdminTabs active="reports" needingReviewCount={openCount} />
        <p className="text-muted-foreground mt-3 text-sm">
          Two streams, one queue: players reported these, or the verifier pulled them pending your
          call. Nothing here is deleted — flagged questions sit out of circulation until you act.
        </p>
        <div className="mt-3 flex gap-2">
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
            <p className="text-muted-foreground text-sm">Nothing needing review.</p>
          ) : (
            <>
              {inappropriate.map((report) => (
                <ReportRow key={report.id} report={report} onCleared={() => clear(`report:${report.id}`)} />
              ))}
              {rest.map((entry) =>
                entry.kind === 'report' ? (
                  <ReportRow
                    key={entry.report.id}
                    report={entry.report}
                    onCleared={() => clear(`report:${entry.report.id}`)}
                  />
                ) : (
                  <DemotionRow
                    key={entry.item.questionId}
                    item={entry.item}
                    onCleared={() => clear(`demotion:${entry.item.questionId}`)}
                  />
                ),
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {blocked.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing blocked.</p>
          ) : (
            blocked.map((item) => (
              <BlockedRow key={`${item.target.table}:${item.target.id}`} item={item} />
            ))
          )}
        </div>
      )}
    </main>
  );
}

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
      className="rounded-md border px-3 py-1.5 text-sm font-medium"
      style={
        active
          ? { borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }
          : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
      }
    >
      {children}
    </button>
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
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
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
    <div className="rounded-md px-3 py-2 text-[13px]" style={{ background: 'var(--surface-2)' }}>
      <span className="animate-pulse text-[var(--brand-ink-700)]">{RERUN_PHRASES[i]}</span>
      <span className="mt-2 block h-3 w-2/3 animate-pulse rounded" style={{ background: 'var(--border)' }} />
      <span className="mt-1.5 block h-3 w-1/3 animate-pulse rounded" style={{ background: 'var(--border)' }} />
    </div>
  );
}

async function postAdminAction(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch('/api/admin/content-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
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
  onDone: () => void;
  onCancel: () => void;
}) {
  const [questionText, setQuestionText] = useState(initialQuestion);
  const [answerText, setAnswerText] = useState(initialAnswer);
  const [explanation, setExplanation] = useState(initialExplanation ?? '');
  const [pending, setPending] = useState<'save' | 'rerun' | 'approve' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rerun, setRerun] = useState<RerunVerdict | null>(null);
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
      const res = await fetch('/api/admin/content-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'rerun_verify',
          questionText: questionText.trim(),
          answerText: answerText.trim() || undefined,
          canonicalSubcategory,
          broadCategory,
        }),
      });
      if (!res.ok) {
        setError(
          res.status === 503
            ? 'The machine is unavailable right now — try again shortly.'
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
      const res = await fetch('/api/admin/content-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'approve',
          target,
          questionText: questionText.trim(),
          answerText: answerText.trim(),
          explanation: showExplanation ? explanation.trim() || null : undefined,
        }),
      });
      if (!res.ok) {
        setError(`Approve failed (${res.status}).`);
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
          className="rounded-md px-3 py-2 text-[13px] leading-relaxed"
          style={{ background: 'var(--warning-surface)', color: 'var(--brand-ink-700)' }}
        >
          <span className="text-muted-foreground">Fixing — </span>
          {concern}
        </p>
      ) : null}
      <label className="block">
        <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Question</span>
        <textarea
          value={questionText}
          onChange={(e) => edited(setQuestionText)(e.target.value)}
          rows={2}
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
          <textarea
            value={explanation}
            onChange={(e) => edited(setExplanation)(e.target.value)}
            rows={2}
            className={fieldClass}
          />
        </label>
      ) : null}

      {/* The re-run verdict — the machine's read on the reworked question. */}
      {pending === 'rerun' ? (
        <RerunProgress />
      ) : rerun ? (
        <div className="rounded-md px-3 py-2 text-[13px] leading-relaxed" style={verdictTone}>
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
              LLM answer: <strong>{rerun.suggestedAnswer}</strong>
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
          Re-run the machine to get a fresh answer and a fact-check, then approve it back into
          circulation.
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
          {pending === 'rerun' ? 'Re-running…' : rerun ? 'Re-run again' : 'Re-run through the LLM'}
        </button>
        <button
          type="button"
          onClick={() => void approve()}
          disabled={pending !== null || !canApprove}
          title={canApprove ? undefined : 'Re-run the machine first, then approve'}
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
        <p className="text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReportRow({ report, onCleared }: { report: AdminReviewReport; onCleared: () => void }) {
  const router = useRouter();
  const [reviewReason, setReviewReason] = useState('');
  const [pending, setPending] = useState<'uphold' | 'dismiss' | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On success the card leaves the list immediately (optimistic), then a
  // background refresh reconciles with the server.
  function resolved() {
    onCleared();
    router.refresh();
  }

  async function act(action: 'uphold' | 'dismiss') {
    if (pending) return;
    setPending(action);
    setError(null);
    const err = await postAdminAction({
      reportId: report.id,
      action,
      reviewReason: reviewReason.trim() || undefined,
    });
    if (err) {
      setError(err);
      setPending(null);
      return;
    }
    resolved();
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
        <span
          className="rounded-sm border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em]"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          Player report
        </span>
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
          {report.target.table} · {new Date(report.createdAt).toLocaleString()}
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
            onClick={() => void act('uphold')}
            disabled={pending !== null}
            className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
          >
            {pending === 'uphold' ? 'Upholding…' : 'Uphold'}
          </button>
          {/* Edit → re-run → approve works on BOTH stores now (B-REVIEW-RERUN-01):
              a reworked generated question re-verifies and returns to the bank. */}
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={pending !== null}
            className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          >
            Edit &amp; re-run
          </button>
          <button
            type="button"
            onClick={() => void act('dismiss')}
            disabled={pending !== null}
            className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
          >
            {pending === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
    </article>
  );
}

// Machine stream card — same shape as ReportRow, but the provenance chip names
// the verifier and the "concern" block is the verifier's stored reason instead
// of a reporter note. Actions: restore (verifier was wrong), edit (verifier was
// right — fix it), retire (right, not worth fixing; soft/reversible).
function DemotionRow({ item, onCleared }: { item: MachineDemotionReviewItem; onCleared: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState<'restore' | 'retire' | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resolved() {
    onCleared();
    router.refresh();
  }

  async function act(action: 'restore_demoted' | 'retire_demoted') {
    if (pending) return;
    setPending(action === 'restore_demoted' ? 'restore' : 'retire');
    setError(null);
    const err = await postAdminAction({ action, questionId: item.questionId });
    if (err) {
      setError(err);
      setPending(null);
      return;
    }
    resolved();
  }

  const authorLabel = item.authorIsHouse
    ? 'House · editorial'
    : item.authorName
      ? `Human · ${item.authorName}`
      : `LLM · ${LLM_QUESTION_ATTRIBUTION}`;

  return (
    <article className="rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-sm border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em]"
          style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
        >
          Verifier
        </span>
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
        <div className="text-muted-foreground mt-0.5 text-[13px]">
          <ClampText text={item.explanation} />
        </div>
      ) : null}

      <p
        className="mt-2 rounded-md px-3 py-2 text-[13px]"
        style={{ background: 'var(--warning-surface)', color: 'var(--brand-ink-700)' }}
      >
        <span className="text-muted-foreground">The concern — </span>
        {item.verificationReason ?? 'reason not captured (demoted before reasons were stored)'}
      </p>

      {editing ? (
        <Modal title="Edit &amp; re-run" onClose={() => setEditing(false)}>
          <EditPanel
            target={{ table: 'question', id: item.questionId }}
            initialQuestion={item.questionText}
            initialAnswer={item.correctAnswer}
            initialExplanation={item.explanation}
            showExplanation
            canonicalSubcategory={item.canonicalSubcategory}
            broadCategory={item.broadCategory}
            concern={item.verificationReason ?? 'demoted by the verifier (reason not captured)'}
            onDone={resolved}
            onCancel={() => setEditing(false)}
          />
        </Modal>
      ) : null}
      {!editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void act('restore_demoted')}
            disabled={pending !== null}
            className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
          >
            {pending === 'restore' ? 'Restoring…' : 'Restore — verifier was wrong'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={pending !== null}
            className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => void act('retire_demoted')}
            disabled={pending !== null}
            className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            {pending === 'retire' ? 'Retiring…' : 'Retire (recoverable)'}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
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

function BlockedRow({ item }: { item: BlockedReviewItem }) {
  const router = useRouter();
  const [reviewReason, setReviewReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unblock() {
    if (pending) return;
    setPending(true);
    setError(null);
    const err = await postAdminAction({
      action: 'reverse',
      target: item.target,
      reviewReason: reviewReason.trim() || undefined,
    });
    if (err) {
      setError(err.replace('Action', 'Un-block'));
      setPending(false);
      return;
    }
    router.refresh();
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
          {item.target.table}
          {item.actionedAt
            ? ` · removed ${new Date(item.actionedAt).toLocaleString()}`
            : ' · removed (vet/cron)'}
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
          <p className="text-[13px] text-[var(--brand-ink-700)]">
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
              onClick={() => void unblock()}
              disabled={pending}
              className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
            >
              {pending ? 'Un-blocking…' : 'Confirm un-block'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={pending}
              className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p className="mt-2 text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
    </article>
  );
}
