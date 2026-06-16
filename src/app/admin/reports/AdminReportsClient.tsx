'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { AdminReviewReport, BlockedReviewItem } from '@/server/db/queries/content-reports';
import { LLM_QUESTION_ATTRIBUTION } from '@/lib/questions-types';

// Deliberately minimal — an internal ops tool, not a product surface. Two views:
// the OPEN report queue (uphold / dismiss) and the BLOCKED / actioned list
// (un-block / reverse). Both expose admin-only context.
export function AdminReportsClient({
  reports,
  blocked,
}: {
  reports: AdminReviewReport[];
  blocked: BlockedReviewItem[];
}) {
  const [view, setView] = useState<'open' | 'blocked'>('open');

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">Report queue</h1>
        <div className="mt-3 flex gap-2">
          <TabButton active={view === 'open'} onClick={() => setView('open')}>
            Open reports ({reports.length})
          </TabButton>
          <TabButton active={view === 'blocked'} onClick={() => setView('blocked')}>
            Blocked / actioned ({blocked.length})
          </TabButton>
        </div>
      </header>

      {view === 'open' ? (
        <div className="space-y-3">
          {reports.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing open.</p>
          ) : (
            reports.map((report) => <ReportRow key={report.id} report={report} />)
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

function ReportRow({ report }: { report: AdminReviewReport }) {
  const router = useRouter();
  const [reviewReason, setReviewReason] = useState('');
  const [pending, setPending] = useState<'uphold' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'uphold' | 'dismiss') {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      const res = await fetch('/api/admin/content-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reportId: report.id, action, reviewReason: reviewReason.trim() || undefined }),
      });
      if (!res.ok) {
        setError(`Action failed (${res.status}).`);
        setPending(null);
        return;
      }
      router.refresh();
    } catch {
      setError('Action failed.');
      setPending(null);
    }
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

      <p className="mt-2 font-medium text-[var(--brand-ink)]">{report.questionText ?? '(question unavailable)'}</p>
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
      {error ? <p className="mt-2 text-[13px]" style={{ color: 'var(--danger)' }}>{error}</p> : null}
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
    try {
      const res = await fetch('/api/admin/content-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'reverse',
          target: item.target,
          reviewReason: reviewReason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError(`Un-block failed (${res.status}).`);
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError('Un-block failed.');
      setPending(false);
    }
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
          {item.actionedAt ? ` · removed ${new Date(item.actionedAt).toLocaleString()}` : ' · removed (vet/cron)'}
        </span>
      </div>

      <p className="mt-2 font-medium text-[var(--brand-ink)]">{item.questionText ?? '(question unavailable)'}</p>
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
            Un-block this {item.target.table === 'question' ? 'question (restores to public)' : 'generated question'}?
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
      {error ? <p className="mt-2 text-[13px]" style={{ color: 'var(--danger)' }}>{error}</p> : null}
    </article>
  );
}
