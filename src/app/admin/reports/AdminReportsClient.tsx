'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { AdminReviewReport } from '@/server/db/queries/content-reports';

// Deliberately minimal — an internal ops tool, not a product surface. Two actions
// (uphold / dismiss), the full review context including admin-only reporter identity.
export function AdminReportsClient({ reports }: { reports: AdminReviewReport[] }) {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">Report queue</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {reports.length === 0 ? 'Nothing open.' : `${reports.length} open`}
        </p>
      </header>

      <div className="space-y-3">
        {reports.map((report) => (
          <ReportRow key={report.id} report={report} />
        ))}
      </div>
    </main>
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
