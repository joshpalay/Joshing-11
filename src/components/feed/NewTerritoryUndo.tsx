'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import {
  TERRITORY_FREQUENCIES,
  TERRITORY_FREQUENCY_LABEL,
  type TerritoryFrequency,
} from '@/lib/daily/territory-model';

// Darkened triangle-gold so the "New territory" copy clears AA on the cream
// card (raw --tri-amber #d9a82e is too light for small text).
const GOLD_INK = 'color-mix(in srgb, var(--tri-amber) 50%, var(--brand-ink))';

// Default-add with player control (B-1): a correct answer in an unfamiliar domain
// opens it in the player's Knowledge base automatically (server-side, via
// writeMasteryEvent), starting in the default "Sometimes" rotation. This card
// surfaces that the domain was added and lets the player dial how often it should
// come up — Often / Sometimes / Blue Moon / Never — via a segmented control that
// saves on tap. No Undo is needed: the control is self-reversible (re-tap another
// tier). Used on both reveal surfaces.
const FREQUENCY_HINT: Record<TerritoryFrequency, string> = {
  often: 'Shows up most in your rounds.',
  sometimes: 'Stays in normal rotation.',
  blue_moon: 'Only surfaces every so often.',
  resting: "Stays on your map, but won't be asked.",
};

export function NewTerritoryUndo({
  domain,
  category,
}: {
  domain: string;
  category?: string | null;
}) {
  // Freshly-added domains start in the default rotation ('sometimes').
  const [selected, setSelected] = useState<TerritoryFrequency>('sometimes');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const label = category || domain;

  const setFrequency = async (frequency: TerritoryFrequency) => {
    const response = await fetch('/api/daily/preferences/domain-frequency', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain, frequency }),
    });
    if (!response.ok) throw new Error('frequency update failed');
  };

  const handleSelect = async (frequency: TerritoryFrequency) => {
    if (busy || frequency === selected) return;
    const previous = selected;
    setSelected(frequency);
    setBusy(true);
    setError(false);
    try {
      await setFrequency(frequency);
    } catch {
      setSelected(previous);
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-3 rounded-2xl border px-4 py-3"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--tri-amber) 10%, var(--brand-card))',
        borderColor: 'color-mix(in srgb, var(--tri-amber) 40%, var(--brand-border))',
      }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--tri-amber) 18%, var(--brand-card))',
            color: GOLD_INK,
          }}
          aria-hidden
        >
          <Sparkles className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-sm leading-snug font-semibold" style={{ color: GOLD_INK }}>
            Added {label} to your knowledge base.
          </p>
          <p className="mt-1 text-[13px] text-[var(--brand-ink)]">How often should it come up?</p>

          <div
            className="mt-2 flex flex-wrap gap-1.5"
            role="group"
            aria-label={`How often to ask about ${label}`}
          >
            {TERRITORY_FREQUENCIES.map((frequency) => {
              const isSelected = frequency === selected;
              return (
                <button
                  key={frequency}
                  type="button"
                  onClick={() => void handleSelect(frequency)}
                  disabled={busy}
                  aria-pressed={isSelected}
                  className="rounded-full border px-3 py-1 text-[13px] font-semibold transition-opacity disabled:opacity-60"
                  style={{
                    color: isSelected ? 'var(--brand-card)' : GOLD_INK,
                    backgroundColor: isSelected
                      ? GOLD_INK
                      : 'color-mix(in srgb, var(--tri-amber) 12%, var(--brand-card))',
                    borderColor: 'color-mix(in srgb, var(--tri-amber) 40%, var(--brand-border))',
                  }}
                >
                  {TERRITORY_FREQUENCY_LABEL[frequency]}
                </button>
              );
            })}
          </div>

          <p className="mt-1.5 text-[13px] text-[var(--brand-ink-400)]">
            {busy ? 'Saving…' : FREQUENCY_HINT[selected]}
          </p>

          {error ? (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--game-wrong-strong)' }}>
              Could not update it. Try again.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
