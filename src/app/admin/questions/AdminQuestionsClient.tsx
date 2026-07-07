'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { AdminTabs } from '@/app/admin/AdminTabs';
import type { AdminQuestionRow, AdminQuestionsPage } from '@/server/db/queries/admin-questions';

// B-ADMIN-QUESTIONS-OVERVIEW-01 Phase 1 — the read-only pool audit table.
// Deliberately plain (an internal ops tool): a wide, horizontally-scrollable
// table with a show-deleted toggle and pagination. Interface quiet, content loud.
// Canon: house/tombstone rows carry the neutral "House" label resolved server-
// side (never a person); every flag is a TEXT badge, never color alone.

function fmtDate(iso: string): string {
  // YYYY-MM-DD — compact and sortable-looking for an audit table.
  return iso.slice(0, 10);
}

function fmtRate(row: AdminQuestionRow): string {
  if (row.correctRate !== null && row.correctRate !== undefined) {
    return `${Math.round(row.correctRate * 100)}%`;
  }
  if (row.askedCount > 0) return `${Math.round((row.correctCount / row.askedCount) * 100)}%`;
  return '—';
}

// A text-labelled badge. Callers pass a semantic token for tone; the LABEL always
// carries the meaning so nothing is conveyed by color alone.
function Badge({ label, tone }: { label: string; tone?: 'muted' | 'danger' | 'navy' | 'warning' }) {
  const style =
    tone === 'danger'
      ? { color: 'var(--danger)', borderColor: 'var(--danger)' }
      : tone === 'navy'
        ? { color: 'var(--brand-navy)', borderColor: 'var(--brand-navy)' }
        : tone === 'warning'
          ? { color: 'var(--warning)', borderColor: 'var(--warning)' }
          : { color: 'var(--text-muted)', borderColor: 'var(--border)' };
  return (
    <span
      className="inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium"
      style={style}
    >
      {label}
    </span>
  );
}

function FlagBadges({ row }: { row: AdminQuestionRow }) {
  const flags: { label: string; tone: 'danger' | 'warning' | 'muted' }[] = [];
  if (row.deletedAt) flags.push({ label: 'deleted', tone: 'danger' });
  if (row.authorDeleted) flags.push({ label: 'tombstone', tone: 'muted' });
  if (row.nobodyCorrectFlag) flags.push({ label: 'nobody-correct', tone: 'warning' });
  if (row.isDuplicate) flags.push({ label: 'duplicate', tone: 'warning' });
  if (row.perishable) flags.push({ label: 'perishable', tone: 'muted' });
  if (flags.length === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f.label} label={f.label} tone={f.tone} />
      ))}
    </span>
  );
}

const CELL = 'px-2 py-1.5 align-top text-[13px]';
const HEAD = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em]';

export function AdminQuestionsClient({ result }: { result: AdminQuestionsPage }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  function navigate(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    router.push(`/admin/questions?${params.toString()}`);
  }

  function toggleDeleted() {
    navigate({ showDeleted: result.showDeleted ? null : '1', page: '1' });
  }

  function goToPage(page: number) {
    navigate({ page: String(page) });
  }

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6">
      <h1 className="mb-3 font-serif text-2xl font-semibold text-[var(--brand-ink)]">Questions</h1>
      <div className="mb-4">
        <AdminTabs active="questions" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {result.total.toLocaleString()} question{result.total === 1 ? '' : 's'}
          {result.showDeleted ? ' (including deleted)' : ''}
        </p>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--brand-ink-700)' }}>
          <input type="checkbox" checked={result.showDeleted} onChange={toggleDeleted} />
          Show deleted
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              <th className={HEAD}>Question</th>
              <th className={HEAD}>Answer</th>
              <th className={HEAD}>Category</th>
              <th className={HEAD}>Author</th>
              <th className={HEAD}>Source</th>
              <th className={HEAD}>Trust</th>
              <th className={HEAD}>Visibility</th>
              <th className={HEAD}>Public status</th>
              <th className={HEAD}>Verdict</th>
              <th className={HEAD}>Asked</th>
              <th className={HEAD}>Correct</th>
              <th className={HEAD}>Rate</th>
              <th className={HEAD}>Flags</th>
              <th className={HEAD}>Created</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.length === 0 ? (
              <tr>
                <td className={CELL} colSpan={14} style={{ color: 'var(--text-muted)' }}>
                  No questions match.
                </td>
              </tr>
            ) : (
              result.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t"
                  style={{
                    borderColor: 'var(--border)',
                    opacity: row.deletedAt ? 0.6 : 1,
                    color: 'var(--brand-ink)',
                  }}
                >
                  <td className={`${CELL} min-w-[280px] max-w-[360px]`}>
                    <span className="line-clamp-2">{row.questionText}</span>
                  </td>
                  <td className={`${CELL} min-w-[120px] max-w-[200px]`}>
                    <span className="line-clamp-2">{row.answerText}</span>
                  </td>
                  <td className={`${CELL} whitespace-nowrap`}>
                    {row.category}
                    {row.broadCategory ? (
                      <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {row.broadCategory}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${CELL} whitespace-nowrap`}>
                    {row.authorIsPerson ? (
                      row.authorLabel
                    ) : (
                      <Badge label={row.authorLabel} tone="muted" />
                    )}
                  </td>
                  <td className={`${CELL} whitespace-nowrap`}>{row.source}</td>
                  <td className={`${CELL} whitespace-nowrap`}>{row.trustTier}</td>
                  <td className={`${CELL} whitespace-nowrap`}>{row.visibility}</td>
                  <td className={`${CELL} whitespace-nowrap`}>{row.publicStatus}</td>
                  <td className={`${CELL} whitespace-nowrap`}>{row.verificationVerdict ?? '—'}</td>
                  <td className={`${CELL} text-right tabular-nums`}>{row.askedCount}</td>
                  <td className={`${CELL} text-right tabular-nums`}>{row.correctCount}</td>
                  <td className={`${CELL} text-right tabular-nums`}>{fmtRate(row)}</td>
                  <td className={`${CELL} min-w-[140px]`}>
                    <FlagBadges row={row} />
                  </td>
                  <td className={`${CELL} whitespace-nowrap`} style={{ color: 'var(--text-muted)' }}>
                    {fmtDate(row.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span style={{ color: 'var(--text-muted)' }}>
          Page {result.page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            disabled={result.page <= 1}
            onClick={() => goToPage(result.page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            disabled={result.page >= totalPages}
            onClick={() => goToPage(result.page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </main>
  );
}
