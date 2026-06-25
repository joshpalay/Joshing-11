import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { loadExpansionOfferDiagnostic } from '@/server/db/queries/expansion-offer-diagnostic';

export const dynamic = 'force-dynamic';

const BOX: React.CSSProperties = {
  padding: '8px 12px',
  background: '#fafafa',
  border: '1px solid #eee',
  fontFamily: 'monospace',
  fontSize: '12px',
};

const TH: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 10px',
  borderBottom: '1px solid #ccc',
  fontFamily: 'monospace',
  fontSize: '11px',
  color: '#444',
};

const TD: React.CSSProperties = {
  padding: '4px 10px',
  borderBottom: '1px solid #f0f0f0',
  fontFamily: 'monospace',
  fontSize: '12px',
  whiteSpace: 'nowrap',
};

function fmt(date: Date | null): string {
  return date ? date.toISOString().replace('T', ' ').slice(0, 16) : '—';
}

export default async function ExpansionOfferDiagnosticPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { totals, byDomain, recent } = await loadExpansionOfferDiagnostic();
  const conversion = totals.eligible > 0 ? Math.round((totals.resolved / totals.eligible) * 100) : 0;

  return (
    <main style={{ padding: '16px', maxWidth: '1100px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontFamily: 'monospace', fontSize: '18px', marginBottom: '4px' }}>
        Expansion offer — funnel
      </h1>
      <p style={{ color: '#666', fontSize: '12px', marginTop: '0' }}>
        How often the post-daily-Five &ldquo;branch out&rdquo; offer is triggered, read from{' '}
        <code>USER_DOMAIN_DIFFICULTY</code>. <strong>Eligible</strong> = a player topped a domain&rsquo;s
        ladder yet still out-ran its content. <strong>Resolved</strong> = they accepted or dismissed it.{' '}
        <strong>Pending</strong> = still surfacing. The accept-vs-dismiss split lives in the{' '}
        <code>[expansion-offer]</code> logs (Axiom). This is a diagnostic, not product UI.
      </p>

      <section style={{ marginTop: '16px', ...BOX }}>
        <strong>Triggered (eligible): {totals.eligible}</strong>
        {' · '}resolved={totals.resolved}
        {' · '}pending={totals.pending}
        {' · '}resolve_rate={conversion}%
        {' · '}domains={byDomain.length}
      </section>

      <h2 style={{ fontFamily: 'monospace', fontSize: '14px', marginTop: '24px', marginBottom: '6px' }}>
        By domain
      </h2>
      {byDomain.length === 0 ? (
        <section style={{ ...BOX }}>No domains have triggered the offer yet.</section>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={TH}>domain</th>
              <th style={{ ...TH, textAlign: 'right' }}>eligible</th>
              <th style={{ ...TH, textAlign: 'right' }}>resolved</th>
              <th style={{ ...TH, textAlign: 'right' }}>pending</th>
            </tr>
          </thead>
          <tbody>
            {byDomain.map((row) => (
              <tr key={row.domain}>
                <td style={TD}>{row.domain}</td>
                <td style={{ ...TD, textAlign: 'right' }}>{row.eligible}</td>
                <td style={{ ...TD, textAlign: 'right' }}>{row.resolved}</td>
                <td style={{ ...TD, textAlign: 'right' }}>{row.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontFamily: 'monospace', fontSize: '14px', marginTop: '24px', marginBottom: '6px' }}>
        Recent triggers (most recent first, max {recent.length})
      </h2>
      {recent.length === 0 ? (
        <section style={{ ...BOX }}>Nothing triggered yet.</section>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={TH}>user_id</th>
              <th style={TH}>domain</th>
              <th style={TH}>served</th>
              <th style={TH}>eligible_since</th>
              <th style={TH}>resolved_at</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((row) => (
              <tr key={`${row.userId}:${row.domain}`}>
                <td style={TD}>{row.userId}</td>
                <td style={TD}>{row.domain}</td>
                <td style={TD}>{row.servedDifficulty}</td>
                <td style={TD}>{fmt(row.eligibleSince)}</td>
                <td style={{ ...TD, color: row.offeredAt ? '#000' : '#a06a00' }}>
                  {row.offeredAt ? fmt(row.offeredAt) : 'pending'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
