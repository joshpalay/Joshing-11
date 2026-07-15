import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { buildSupplyCoverageSummary } from '@/server/daily/supply-coverage';
import type { SupplyState } from '@/server/daily/supply-state';
import { AdminTabs } from '../AdminTabs';
import { InfoTerm } from '../InfoTerm';
import type { GlossaryKey } from '../glossary';
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
//
// State labels are plain speech, never the raw enum (soft_finite etc.); each
// carries its glossary definition one tap away via <InfoTerm>. Keep these in
// lockstep with SUPPLY_STATE_TEXT in KnowledgeAdminClient — the tree's supply
// chips must speak the same words.

const STATE_LABEL: Record<SupplyState, string> = {
  discrepancy: 'Ran dry early',
  raise_estimate: 'Estimate too low',
  filling: 'Filling',
  soft_finite: 'Likely complete',
  unsized: 'Unsized',
};

const STATE_TERM: Record<SupplyState, GlossaryKey> = {
  discrepancy: 'supply_ran_dry',
  raise_estimate: 'supply_estimate_too_low',
  filling: 'supply_filling',
  soft_finite: 'supply_likely_complete',
  unsized: 'supply_unsized',
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
        // Unsized rows have no ratio — biggest areas first so the ones most
        // worth sizing surface at the top of that band.
        if (a.ratio == null && b.ratio == null) return b.realized - a.realized;
        return (a.ratio ?? 1) - (b.ratio ?? 1);
      })
    : [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4">
        <AdminTabs active="supply" />
        <div>
          {/* Table page — max-w-5xl on purpose (9 columns); content pages sit at 4xl. */}
          <h1 className="font-serif text-2xl font-semibold" style={{ color: 'var(--brand-ink)' }}>
            Domain supply
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            How question generation is doing per domain: what it has <strong>made</strong> vs the{' '}
            <strong>estimated</strong> size of the topic. Same population as the Tree view, seen
            through the supply lens — tap any state or column name for what it means. Sorted
            alarm-first.
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
            <InfoTerm term="supply_ran_dry">
              <strong style={{ color: 'var(--danger)' }}>{summary.counts.discrepancy}</strong> ran
              dry early
            </InfoTerm>
            <InfoTerm term="supply_estimate_too_low">
              <strong style={{ color: 'var(--brand-navy)' }}>{summary.counts.raise_estimate}</strong>{' '}
              estimate too low
            </InfoTerm>
            <InfoTerm term="supply_filling">
              <strong>{summary.counts.filling}</strong> filling
            </InfoTerm>
            <InfoTerm term="supply_likely_complete">
              <strong>{summary.counts.soft_finite}</strong> likely complete
            </InfoTerm>
            <InfoTerm term="supply_unsized">
              <strong>{summary.counts.unsized}</strong> unsized
            </InfoTerm>
            {summary.cappedCount > 0 ? (
              <InfoTerm term="supply_capped">
                <strong style={{ color: 'var(--danger)' }}>{summary.cappedCount}</strong> capped
              </InfoTerm>
            ) : null}
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
                  <th className="py-2 pr-3 text-right font-medium">Made</th>
                  <th className="py-2 pr-3 text-right font-medium">
                    <InfoTerm term="supply_estimate">Estimate</InfoTerm>
                  </th>
                  <th className="py-2 pr-3 text-right font-medium">
                    <InfoTerm def="Made ÷ estimate — how much of the believed topic size has been generated.">
                      Coverage
                    </InfoTerm>
                  </th>
                  <th className="py-2 pr-3 text-right font-medium">
                    <InfoTerm term="dry_rounds">Dry rounds</InfoTerm>
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    <InfoTerm term="supply_confidence">Confidence</InfoTerm>
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    <InfoTerm term="supply_basis">Basis</InfoTerm>
                  </th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((entry) => (
                  <tr
                    key={entry.domainKey}
                    // Anchor target for the knowledge page's per-row supply link.
                    id={`supply-${entry.domainKey}`}
                    className="border-b scroll-mt-24"
                    style={{ borderColor: 'var(--border-light)' }}
                  >
                    <td className="py-2 pr-3">{entry.label}</td>
                    <td className="py-2 pr-3">
                      <InfoTerm
                        term={STATE_TERM[entry.state]}
                        style={{ color: STATE_COLOR[entry.state] }}
                      >
                        {STATE_LABEL[entry.state]}
                      </InfoTerm>
                      {entry.generationCapped ? (
                        <span className="block text-xs font-semibold">
                          <InfoTerm term="supply_capped" style={{ color: 'var(--danger)' }}>
                            ⛔ capped
                          </InfoTerm>
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-right">{entry.realized}</td>
                    <td className="py-2 pr-3 text-right">
                      {entry.estimatedQuestions == null ? (
                        '—'
                      ) : entry.estimateClamped ? (
                        <span title="Corpus count hit the sizing ceiling — the topic is at least this big, not measured at it.">
                          ≥{entry.estimatedQuestions}
                        </span>
                      ) : (
                        entry.estimatedQuestions
                      )}
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
                    <td className="py-2 pr-3 text-right">
                      {/* Coverage of a ceiling clamp is meaningless — suppress it. */}
                      {entry.estimateClamped ? '—' : pctLabel(entry.ratio)}
                    </td>
                    <td className="py-2 pr-3 text-right">{entry.consecutiveDryRounds}</td>
                    <td className="py-2 pr-3">{entry.confidence ?? '—'}</td>
                    <td className="py-2 pr-3" style={{ color: 'var(--text-muted)' }}>
                      {entry.basis ?? '—'}
                    </td>
                    <td className="py-2">
                      <SupplyRowActions
                        domainKey={entry.domainKey}
                        manualEstimatedQuestions={entry.manualEstimatedQuestions}
                        generationCapped={entry.generationCapped}
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
