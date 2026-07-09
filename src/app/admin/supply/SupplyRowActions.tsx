'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Per-row actions for the /admin/supply dashboard (0119): re-run the corpus
// resolver, or set/clear the manual estimate override. Mutations go through
// POST /api/admin/supply (admin re-checked server-side); on success the server
// component re-reads via router.refresh(), so this component keeps no state
// beyond the in-flight flag and the pending input value.
export function SupplyRowActions({
  domainKey,
  manualEstimatedQuestions,
  generationCapped,
}: {
  domainKey: string;
  manualEstimatedQuestions: number | null;
  generationCapped: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>, failLabel: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/supply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(
          res.status === 422 ? 'Resolver could not size this domain.' : `${failLabel} failed (${res.status}).`,
        );
        setBusy(false);
        return;
      }
      setEditing(false);
      setValue('');
      setBusy(false);
      router.refresh();
    } catch {
      setError(`${failLabel} failed.`);
      setBusy(false);
    }
  }

  const buttonClass = 'rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-50';
  const buttonStyle = { borderColor: 'var(--border)', color: 'var(--text-muted)' } as const;

  if (editing) {
    const parsed = Number(value);
    const valid = Number.isInteger(parsed) && parsed >= 1;
    return (
      <span className="flex flex-wrap items-center gap-1">
        <input
          type="number"
          min={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="est."
          className="w-20 rounded-md border px-2 py-0.5 text-xs"
          style={{ borderColor: 'var(--border)' }}
          disabled={busy}
          autoFocus
        />
        <button
          type="button"
          className={buttonClass}
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          disabled={busy || !valid}
          onClick={() => post({ action: 'set_estimate', domainKey, estimate: parsed }, 'Set')}
        >
          Save
        </button>
        <button
          type="button"
          className={buttonClass}
          style={buttonStyle}
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setValue('');
            setError(null);
          }}
        >
          Cancel
        </button>
        {error ? (
          <span className="text-xs" style={{ color: 'var(--danger)' }}>
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        className={buttonClass}
        style={buttonStyle}
        disabled={busy}
        onClick={() => post({ action: 'resize', domainKey }, 'Re-size')}
        title="Re-run the corpus resolver for this domain"
      >
        Re-size
      </button>
      <button
        type="button"
        className={buttonClass}
        style={buttonStyle}
        disabled={busy}
        onClick={() => setEditing(true)}
        title="Manually set the estimate (wins over the corpus number)"
      >
        Set est.
      </button>
      {manualEstimatedQuestions != null ? (
        <button
          type="button"
          className={buttonClass}
          style={buttonStyle}
          disabled={busy}
          onClick={() => post({ action: 'set_estimate', domainKey, estimate: null }, 'Clear')}
          title="Clear the manual override; the corpus estimate takes over again"
        >
          Clear
        </button>
      ) : null}
      {generationCapped ? (
        <button
          type="button"
          className={buttonClass}
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          disabled={busy}
          onClick={() => post({ action: 'set_cap', domainKey, capped: false }, 'Un-cap')}
          title="Resume generation for this domain"
        >
          Un-cap
        </button>
      ) : (
        <button
          type="button"
          className={buttonClass}
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
          disabled={busy}
          onClick={() => post({ action: 'set_cap', domainKey, capped: true }, 'Cap')}
          title="Stop generating new questions for this domain (serving is untouched)"
        >
          Cap
        </button>
      )}
      {error ? (
        <span className="text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
