'use client';

import { useCallback, useState } from 'react';

import { Switch } from '@/components/ui/Switch';

/**
 * D-MISSED-RETURN-01 §7-D — the Customize control for returning questions.
 *
 * ONE control: on or off. Deliberately NOT a list.
 *
 * §7-D originally paired the toggle with a list of currently-eligible questions
 * and a per-row dismiss. That shipped, and then didn't survive contact with real
 * data (Josh, 2026-08-10): a heavy account had 135 eligible rows, which buried
 * the rest of the page and turned a settings screen into an inventory nobody
 * asked to read. "I don't need to see those."
 *
 * Dropping the list also removes two hazards the walkthrough surfaced — the
 * unbounded scroll, and the undo strip whose disappearance shifted the list
 * under an in-flight tap.
 *
 * The dismiss capability itself is unchanged and still reachable where it has
 * always made sense: waving a question off in catch-up dual-writes
 * MissedReturnDismissed, which suppresses the return. What's gone is the
 * separate browsable surface for doing that in advance.
 */
export function MissedReturnSection({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async (next: boolean) => {
    setEnabled(next); // optimistic — the control should never feel laggy
    setError(null);
    try {
      const res = await fetch('/api/daily/missed-return/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      setEnabled(!next);
      setError('That didn’t save. Try again?');
    }
  }, []);

  return (
    <section className="border-t border-[var(--border-warm)] pt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h2 className="m-0 font-serif text-lg font-semibold text-[var(--brand-ink)]">
            Questions that come back
          </h2>
          <p className="mt-1 mb-0 text-quiet leading-[1.5] text-[var(--text-muted-warm)]">
            Every so often, one question you didn’t land turns up again in your five. Nothing
            stacks up — it’s one at a time, and once you get it, it’s done.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(next) => void toggle(next)}
          label="Let missed questions come back"
          className="mt-1"
        />
      </div>

      {error ? (
        <p className="mt-3 mb-0 text-quiet text-[var(--brand-ink)]" role="status" aria-live="polite">
          {error}
        </p>
      ) : null}
    </section>
  );
}
