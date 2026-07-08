import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { buildSupplyCoverageSummary } from '@/server/daily/supply-coverage';
import type { SupplyState } from '@/server/daily/supply-state';
import { AdminTabs } from '../AdminTabs';
import { SupplyRowActions } from './SupplyRowActions';

export const dynamic = 'force-dynamic';

// D-SUPPLY-FINITENESS-01 #5 — the domain-supply coverage dashboard: per domain,
// the corpus-grounded size estimate vs realized generation, the dry-round
// counter, and the derived supply state. Classification happens in
// classifySupplyState so this and the weekly digest email always agree. Per-row
// actions (0119): re-run the corpus resolver, or set/clear a manual estimate
// override — the override wins over the corpus number everywhere and shows here
// with the corpus value alongside. Same admin gate as every /admin page:
// ADMIN_USER_IDS or a 404 that doesn't reveal the route.

const STATE_LABEL: Record<SupplyState, string> = {
  discrepancy: 'Discrepancy',
  raise_estimate: 'Raise estimate',
  filling: 'Filling',
  soft_finite: 'Resting (believed complete)',
  unsized: 'Unsized',
};

const STATE_COLOR: Record<SupplyState, string> = {
  discrepancy: 'var(--danger)',
  raise_estimate: 'var(--brand-navy)',
  filling: 'var(--text-muted)',
  soft_finite: 'var(--text-muted)',
  unsized: 'var(--text-muted)',
};

// Alarm-first ordering for the table.
const STATE_ORDER: SupplyState[] = [
  'discrepancy',
  'raise_estimate',
  'filling',
  'soft_finite',
  'unsized',
];

function pctLabel(ratio: number | null): string {
  return ratio == null ? '—' : `${Math.round(ratio * 100)}%`;
}

export default async function AdminSupplyPage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const summary = await buildSupplyCoverageSummary();

  const ordered = summary
    ? [...summary.entries].sort((a, b) => {
        const stateDelta = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);
        if (stateDelta !== 0) return stateDelta;
        return (a.ratio ?? 1) - (b.ratio ?? 1);
      })
    : [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4">
        <AdminTabs active="supply" />
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--brand-navy)' }}>
            Domain supply
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Corpus-grounded size estimate vs realized generation, per domain. A{' '}
            <strong>discrepancy</strong> is a domain that went dry far short of a trusted
            estimate — a supply problem, not completion. Resting domains are believed complete
            and stay re-probeable.
          </p>
        </div>
      </div>

      {!summary ? (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>
          Coverage read failed — see server logs ([supply-coverage]).
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
            <span>
              <strong style={{ color: 'var(--danger)' }}>{summary.counts.discrepancy}</strong>{' '}
              discrepancy
            </span>
            <span>
              <strong style={{ color: 'var(--brand-navy)' }}>{summary.counts.raise_estimate}</strong>{' '}
              raise estimate
            </span>
            <span>
              <strong>{summary.counts.filling}</strong> filling
            </span>
            <span>
              <strong>{summary.counts.soft_finite}</strong> resting
            </span>
            <span>
              <strong>{summary.counts.unsized}</strong> unsized
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                >
                  <th className="py-2 pr-3 font-medium">Domain</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                  <th className="py-2 pr-3 text-right font-medium">Have</th>
                  <th className="py-2 pr-3 text-right font-medium">Est.</th>
                  <th className="py-2 pr-3 text-right font-medium">Coverage</th>
                  <th className="py-2 pr-3 text-right font-medium">Dry rounds</th>
                  <th className="py-2 pr-3 font-medium">Confidence</th>
                  <th className="py-2 pr-3 font-medium">Basis</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((entry) => (
                  <tr
                    key={entry.domainKey}
                    className="border-b"
                    style={{ borderColor: 'var(--border-light)' }}
                  >
                    <td className="py-2 pr-3">{entry.label}</td>
                    <td className="py-2 pr-3" style={{ color: STATE_COLOR[entry.state] }}>
                      {STATE_LABEL[entry.state]}
                    </td>
                    <td className="py-2 pr-3 text-right">{entry.realized}</td>
                    <td className="py-2 pr-3 text-right">
                      {entry.estimatedQuestions ?? '—'}
                      {entry.manualEstimatedQuestions != null ? (
                        <span
                          className="block text-xs"
                          style={{ color: 'var(--text-muted)' }}
                          title="Manual override; the corpus estimate shown underneath"
                        >
                          manual · corpus {entry.corpusEstimatedQuestions ?? '—'}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-right">{pctLabel(entry.ratio)}</td>
                    <td className="py-2 pr-3 text-right">{entry.consecutiveDryRounds}</td>
                    <td className="py-2 pr-3">{entry.confidence ?? '—'}</td>
                    <td className="py-2 pr-3" style={{ color: 'var(--text-muted)' }}>
                      {entry.basis ?? '—'}
                    </td>
                    <td className="py-2">
                      <SupplyRowActions
                        domainKey={entry.domainKey}
                        manualEstimatedQuestions={entry.manualEstimatedQuestions}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
