'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type { ReplayDebugRow } from '@/app/api/replay/debug/route';

type Response = {
  userId: string;
  total: number;
  rows: ReplayDebugRow[];
};

function fmtCell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value === '') return '(empty)';
  return String(value);
}

export default function ReplayDebugPage() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterSuspect, setFilterSuspect] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/replay/debug', { credentials: 'include', cache: 'no-store' });
      const body = await response.json().catch(() => null) as Response | null;
      if (!response.ok || !body) throw new Error('Could not load debug data.');
      setData(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load debug data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (!filterSuspect) return data.rows;
    return data.rows.filter((row) =>
      !row.submittedAnswer
      || row.submittedAnswer.trim() === ''
      || row.textMismatch
      || row.dismissedAt
      || row.skipped
      || row.recheckStatus === 'needs_human',
    );
  }, [data, filterSuspect]);

  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-4 py-6">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
        <Link href="/replay" className="underline underline-offset-2">Replay</Link>
        {' / Debug'}
      </p>
      <h1 className="mt-2 font-serif text-3xl font-semibold text-[var(--text)]">Missed-question audit</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
        Every slot that currently passes the &quot;missed&quot; filter. Scan for entries you don&apos;t recognize.
        &quot;Suspect&quot; entries: no submitted answer, slot text doesn&apos;t match canonical, dismissed, skipped, or recheck pending.
      </p>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={filterSuspect}
            onChange={(event) => setFilterSuspect(event.target.checked)}
          />
          Show only suspect rows
        </label>
        <button type="button" className="btn-ghost" onClick={() => void load()}>Reload</button>
      </div>

      {loading ? <p className="mt-5 text-sm text-[var(--text-muted)]">Loading…</p> : null}
      {error ? <p className="mt-5 text-sm text-[var(--danger)]">{error}</p> : null}

      {data && !loading && !error ? (
        <>
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            {data.total} total missed slot{data.total === 1 ? '' : 's'} · showing {rows.length}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1400px] border-collapse text-xs">
              <thead>
                <tr className="text-left">
                  <th className="border-b p-2">Queue date</th>
                  <th className="border-b p-2">Slot</th>
                  <th className="border-b p-2">Source</th>
                  <th className="border-b p-2">Domain</th>
                  <th className="border-b p-2">Question (slot)</th>
                  <th className="border-b p-2">Question (canonical)</th>
                  <th className="border-b p-2">Mismatch?</th>
                  <th className="border-b p-2">You submitted</th>
                  <th className="border-b p-2">Correct answer</th>
                  <th className="border-b p-2">Points</th>
                  <th className="border-b p-2">Recheck</th>
                  <th className="border-b p-2">Skipped</th>
                  <th className="border-b p-2">Dismissed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const suspect = !row.submittedAnswer
                    || row.submittedAnswer.trim() === ''
                    || row.textMismatch
                    || row.dismissedAt
                    || row.skipped
                    || row.recheckStatus === 'needs_human';
                  return (
                    <tr key={row.dailyQueueItemId} className={suspect ? 'bg-rose-50' : ''}>
                      <td className="border-b p-2 align-top">{row.queueDate}</td>
                      <td className="border-b p-2 align-top">{row.slotIndex}</td>
                      <td className="border-b p-2 align-top">{row.source}</td>
                      <td className="border-b p-2 align-top">{row.domain}</td>
                      <td className="border-b p-2 align-top">{row.slotQuestionText}</td>
                      <td className="border-b p-2 align-top">{fmtCell(row.canonicalQuestionText)}</td>
                      <td className="border-b p-2 align-top">{fmtCell(row.textMismatch)}</td>
                      <td className="border-b p-2 align-top">{fmtCell(row.submittedAnswer)}</td>
                      <td className="border-b p-2 align-top">{fmtCell(row.revealCanonicalAnswer)}</td>
                      <td className="border-b p-2 align-top">{fmtCell(row.awardedPoints)}</td>
                      <td className="border-b p-2 align-top">
                        {row.recheckStatus ? `${row.recheckStatus}${row.recheckReason ? ` — ${row.recheckReason}` : ''}` : '—'}
                      </td>
                      <td className="border-b p-2 align-top">{fmtCell(row.skipped)}</td>
                      <td className="border-b p-2 align-top">
                        {row.dismissedAt ? `${row.dismissedAt}${row.dismissedReason ? ` (${row.dismissedReason})` : ''}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </main>
  );
}
