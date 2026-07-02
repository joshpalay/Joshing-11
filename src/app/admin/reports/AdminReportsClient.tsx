'use client';

import { useState } from 'react';
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

  // One queue, two streams. Player inappropriate reports stay pinned first
  // (high-priority, matching the query's ordering); everything else — incorrect
  // reports and machine demotions — merges oldest-first so the longest-suppressed
  // content is reviewed soonest.
  const inappropriate = reports.filter((r) => r.category === 'inappropriate');
  const rest: Array<
    | { kind: 'report'; at: number; report: AdminReviewReport }
    | { kind: 'demotion'; at: number; item: MachineDemotionReviewItem }
  > = [
    ...reports
      .filter((r) => r.category !== 'inappropriate')
      .map((report) => ({ kind: 'report' as const, at: new Date(report.createdAt).getTime(), report })),
    ...demotions.map((item) => ({
      kind: 'demotion' as const,
      at: item.verifiedAt ? new Date(item.verifiedAt).getTime() : 0,
      item,
    })),
  ].sort((a, b) => a.at - b.at);
  const openCount = reports.length + demotions.length;

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
                <ReportRow key={report.id} report={report} />
              ))}
              {rest.map((entry) =>
                entry.kind === 'report' ? (
                  <ReportRow key={entry.report.id} report={entry.report} />
                ) : (
                  <DemotionRow key={entry.item.questionId} item={entry.item} />
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

// Inline content editor shared by both streams. Saving posts the 'edit' action:
// the server clears the verification stamp (the batch sweep re-fact-checks the
// edit), returns the row to circulation if it was demoted, and resolves any
// active incorrect reports as admin_edited.
function EditPanel({
  questionId,
  initialQuestion,
  initialAnswer,
  initialExplanation,
  // Report-stream cards don't load the explanation, so the field is hidden and
  // OMITTED from the payload — otherwise saving would null an explanation the
  // admin never saw. Demotion cards carry it and may edit it.
  showExplanation,
  // The reason this question is being edited (verifier reason / reporter note)
  // — repeated inside the panel so the one thing the admin needs while fixing
  // it never scrolls out of sight.
  concern,
  onDone,
  onCancel,
}: {
  questionId: string;
  initialQuestion: string;
  initialAnswer: string;
  initialExplanation: string | null;
  showExplanation: boolean;
  concern?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [questionText, setQuestionText] = useState(initialQuestion);
  const [answerText, setAnswerText] = useState(initialAnswer);
  const [explanation, setExplanation] = useState(initialExplanation ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending) return;
    if (!questionText.trim() || !answerText.trim()) {
      setError('Question and answer are required.');
      return;
    }
    setPending(true);
    setError(null);
    const err = await postAdminAction({
      action: 'edit',
      questionId,
      questionText: questionText.trim(),
      answerText: answerText.trim(),
      ...(showExplanation ? { factualExplanation: explanation.trim() || null } : {}),
    });
    if (err) {
      setError(err);
      setPending(false);
      return;
    }
    onDone();
  }

  const fieldClass =
    'w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 py-1 text-sm focus:border-[var(--brand-navy)]';

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
          onChange={(e) => setQuestionText(e.target.value)}
          rows={2}
          className={fieldClass}
        />
      </label>
      <label className="block">
        <span className="text-muted-foreground text-[0.7rem] uppercase tracking-[0.06em]">Answer</span>
        <input
          type="text"
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
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
            onChange={(e) => setExplanation(e.target.value)}
            rows={2}
            className={fieldClass}
          />
        </label>
      ) : null}
      <p className="text-muted-foreground text-[0.7rem]">
        Saving returns it to circulation and queues it for machine re-verification.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={pending}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          {pending ? 'Saving…' : 'Save & re-verify'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
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

function ReportRow({ report }: { report: AdminReviewReport }) {
  const router = useRouter();
  const [reviewReason, setReviewReason] = useState('');
  const [pending, setPending] = useState<'uphold' | 'dismiss' | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    router.refresh();
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

      <p className="mt-2 italic text-[var(--brand-ink-700)]">&ldquo;{report.note}&rdquo;</p>
      {report.suggestedAnswer ? (
        <p className="text-muted-foreground mt-0.5">Suggested: {report.suggestedAnswer}</p>
      ) : null}

      {/* Admin-only — reporter identity is exposed nowhere else. */}
      <p className="text-muted-foreground mt-2 text-[0.7rem]">
        Reporter: {report.reporterName ?? report.reporterUserId}
      </p>

      {editing ? (
        <EditPanel
          questionId={report.target.id}
          initialQuestion={report.questionText ?? ''}
          initialAnswer={report.correctAnswer ?? ''}
          initialExplanation={null}
          showExplanation={false}
          concern={`${report.note}${report.suggestedAnswer ? ` (reader suggests: ${report.suggestedAnswer})` : ''}`}
          onDone={() => router.refresh()}
          onCancel={() => setEditing(false)}
        />
      ) : (
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
          {/* Edit reworks canonical questions only — generated bank rows are
              machine substrate; fix supply at the creation surface instead. */}
          {report.target.table === 'question' ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending !== null}
              className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
            >
              Edit
            </button>
          ) : null}
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
      )}
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
function DemotionRow({ item }: { item: MachineDemotionReviewItem }) {
  const router = useRouter();
  const [pending, setPending] = useState<'restore' | 'retire' | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    router.refresh();
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
        <p className="text-muted-foreground mt-0.5 text-[13px]">{item.explanation}</p>
      ) : null}

      <p
        className="mt-2 rounded-md px-3 py-2 text-[13px]"
        style={{ background: 'var(--warning-surface)', color: 'var(--brand-ink-700)' }}
      >
        <span className="text-muted-foreground">The concern — </span>
        {item.verificationReason ?? 'reason not captured (demoted before reasons were stored)'}
      </p>

      {editing ? (
        <EditPanel
          questionId={item.questionId}
          initialQuestion={item.questionText}
          initialAnswer={item.correctAnswer}
          initialExplanation={item.explanation}
          showExplanation
          concern={item.verificationReason ?? 'demoted by the verifier (reason not captured)'}
          onDone={() => router.refresh()}
          onCancel={() => setEditing(false)}
        />
      ) : (
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
      )}
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
