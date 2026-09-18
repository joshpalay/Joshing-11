'use client';

import { useState } from 'react';

import { AdminTabs } from '../AdminTabs';
import type { PendingGradeDispute } from '@/server/db/queries/grade-disputes';

type Props = {
  disputes: PendingGradeDispute[];
};

const DECISION_LABEL: Record<string, string> = {
  canonical_disputed: 'Question may be broken',
  needs_human: 'Needs a human look',
  reject: 'Rejected (player disagreed)',
};

function DecisionBadge({ decision }: { decision: string | null }) {
  const label = decision ? DECISION_LABEL[decision] ?? decision : 'Unknown';
  const isUrgent = decision === 'canonical_disputed';
  return (
    <span
      className="inline-block w-fit rounded-md border px-2 py-0.5 text-xs font-medium"
      style={
        isUrgent
          ? { borderColor: 'var(--danger)', color: 'var(--danger)' }
          : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
      }
    >
      {label}
    </span>
  );
}

export function AdminDisputesClient({ disputes }: Props) {
  const [rows, setRows] = useState(disputes);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  async function resolve(id: string, status: 'reviewed' | 'dismissed') {
    setPendingId(id);
    setErrorId(null);
    try {
      const response = await fetch('/api/admin/disputes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, status }),
      });
      if (!response.ok) throw new Error('failed');
      setRows((current) => current.filter((row) => row.id !== id));
    } catch {
      setErrorId(id);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4">
        <AdminTabs active="disputes" />
        <div>
          <h1 className="font-serif text-2xl font-semibold" style={{ color: 'var(--brand-ink)' }}>
            Answer disputes
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Rechecks that didn&apos;t cleanly resolve on their own — a player disagreed with a grade, or the
            reviewer flagged the question itself as possibly wrong. Sorted with likely-broken questions first.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Nothing pending.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-2 rounded-md border p-4"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <DecisionBadge decision={row.reviewDecision} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {row.surface ?? 'unknown surface'} ·{' '}
                  {row.questionCreatorId ? 'friend-authored' : 'editorial / unlinked'} ·{' '}
                  {row.createdAt.toLocaleString()}
                </span>
              </div>

              <p className="font-serif text-base" style={{ color: 'var(--brand-ink)' }}>
                {row.questionText ?? '(question text unavailable)'}
              </p>

              <div className="grid gap-1 text-sm sm:grid-cols-2">
                <p style={{ color: 'var(--text-muted)' }}>
                  Submitted: <span style={{ color: 'var(--brand-ink)' }}>{row.submittedAnswer}</span>
                </p>
                <p style={{ color: 'var(--text-muted)' }}>
                  Canonical: <span style={{ color: 'var(--brand-ink)' }}>{row.canonicalAnswer}</span>
                </p>
              </div>

              {row.reviewReason ? (
                <p className="text-quiet italic" style={{ color: 'var(--text-muted)' }}>
                  Reviewer: {row.reviewReason}
                </p>
              ) : null}

              <div className="mt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void resolve(row.id, 'reviewed')}
                  disabled={pendingId === row.id}
                  className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                >
                  Mark reviewed
                </button>
                <button
                  type="button"
                  onClick={() => void resolve(row.id, 'dismissed')}
                  disabled={pendingId === row.id}
                  className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                >
                  Dismiss
                </button>
                {errorId === row.id ? (
                  <span className="text-xs" style={{ color: 'var(--danger)' }}>
                    Could not update — try again.
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
