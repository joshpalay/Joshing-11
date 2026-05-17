'use client';

import { useState } from 'react';

type RunResult = {
  answerer: string | null;
  dryRun: boolean;
  scanned: number;
  parseFailures: number;
  persistFailures: number;
  alreadyHadConflict: number;
  updated: number;
  propagated: number;
  errors: Array<{ masteryEventId: string; error: string }>;
};

export function BackfillButton({ answererUserId }: { answererUserId: string | null }) {
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    setRunning(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (answererUserId) params.set('answerer', answererUserId);
      if (dryRun) params.set('dryRun', 'true');
      params.set('limit', '500');
      const res = await fetch(`/api/feed/backfill-missing-feed-items?${params.toString()}`, {
        method: 'POST',
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        setRunning(false);
        return;
      }
      const json = (await res.json()) as RunResult;
      setLastRun(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ marginTop: '12px', padding: '8px 12px', border: '1px solid #c8b900', background: '#fffbe6', fontFamily: 'monospace', fontSize: '12px' }}>
      <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
        Backfill missing canonical question ids / feed items
        {answererUserId ? ` for answerer=${answererUserId}` : ' (all users)'}
      </div>
      <div>
        <button type="button" onClick={() => run(true)} disabled={running} style={{ padding: '4px 10px', marginRight: '8px' }}>
          {running ? 'running…' : 'Dry run'}
        </button>
        <button type="button" onClick={() => run(false)} disabled={running} style={{ padding: '4px 10px' }}>
          {running ? 'running…' : 'Run backfill'}
        </button>
      </div>
      {error && <div style={{ marginTop: '6px', color: '#a02500' }}>error: {error}</div>}
      {lastRun && (
        <div style={{ marginTop: '8px' }}>
          <div>
            scanned={lastRun.scanned}
            {' · '}updated={lastRun.updated}
            {' · '}propagated={lastRun.propagated}
            {' · '}parseFailures={lastRun.parseFailures}
            {' · '}persistFailures={lastRun.persistFailures}
            {' · '}alreadyHadConflict={lastRun.alreadyHadConflict}
            {lastRun.dryRun && <strong>{' '}(dry run — no rows were written)</strong>}
          </div>
          {lastRun.errors.length > 0 && (
            <details style={{ marginTop: '6px' }}>
              <summary style={{ cursor: 'pointer' }}>errors ({lastRun.errors.length})</summary>
              <ul style={{ marginTop: '4px' }}>
                {lastRun.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>{e.masteryEventId.slice(0, 8)}… — {e.error}</li>
                ))}
              </ul>
            </details>
          )}
          <div style={{ marginTop: '6px', color: '#666' }}>
            Reload the page to see the diagnostic refresh.
          </div>
        </div>
      )}
    </div>
  );
}
