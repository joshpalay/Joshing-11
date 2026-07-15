'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import { ThreadCard } from '@/components/play/ThreadCard';
import { FrequencyMark } from '@/components/knowledge/FrequencyMark';
import {
  TERRITORY_FREQUENCIES,
  TERRITORY_FREQUENCY_LABEL,
  type TerritoryFrequency,
} from '@/lib/daily/territory-model';

// Darkened triangle-gold so the "New territory" copy clears AA on the cream
// card (raw --accent-gold is too light for small text).
const GOLD_INK = 'var(--accent-gold-ink)';

// Default-add with player control (B-1): a correct answer in an unfamiliar domain
// opens it in the player's Knowledge base automatically (server-side, via
// writeMasteryEvent), starting in the default "Sometimes" rotation. This card
// surfaces that the domain was added and lets the player dial how often it should
// come up — Often / Sometimes / Blue Moon / Never — via a segmented control that
// saves on tap. No Undo is needed: the control is self-reversible (re-tap another
// tier). Used on both reveal surfaces.
//
// B-DOMAIN-BONUS-ROTATION-01: on the daily +2 BONUS surface the domain is NOT
// auto-added to rotation — it's parked out of the core five until the player
// adopts it. There `adopted={false}` opens the control on "Never" (its real
// state: on the map, not yet asked), so picking any other tier is the explicit
// opt-in. The mastery row already exists, so the "Added to your knowledge base"
// lead still holds (knowledge base = your map, which includes resting domains).
const FREQUENCY_HINT: Record<TerritoryFrequency, string> = {
  often: 'Shows up most in your rounds.',
  sometimes: 'Stays in normal rotation.',
  blue_moon: 'Only surfaces every so often.',
  resting: "Stays on your map, but won't be asked.",
};

export function NewTerritoryUndo({
  domain,
  category,
  adopted = true,
}: {
  domain: string;
  category?: string | null;
  /**
   * Whether this domain is already in rotation (B-1 default-add). True on the
   * feed/core surfaces. The daily +2 bonus surface passes false: the domain is
   * parked out of rotation, so the control opens on "Never" and any other tier
   * is the explicit opt-in (B-DOMAIN-BONUS-ROTATION-01).
   */
  adopted?: boolean;
}) {
  // Adopted (default-add) domains start in the default 'sometimes' rotation; a
  // not-yet-adopted bonus domain opens on 'resting' so any tier the player taps —
  // including 'sometimes' — actually writes the adoption.
  const [selected, setSelected] = useState<TerritoryFrequency>(adopted ? 'sometimes' : 'resting');
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
    <ThreadCard
      rail="var(--accent-gold)"
      border="color-mix(in srgb, var(--accent-gold) 32%, var(--brand-rule))"
      fill="color-mix(in srgb, var(--accent-gold) 7%, var(--brand-card))"
      style={{ marginTop: '8px' }}
    >
      {/* Quiet label — same eyebrow rhythm as the result cards. */}
      <p
        className="flex items-center gap-1.5"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6rem',
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: GOLD_INK,
        }}
      >
        <Sparkles className="size-3" aria-hidden />
        Knowledge updated
      </p>

      {/* Primary message — the dominant, clearest line in the card. */}
      <p
        className="mt-1.5 font-serif font-semibold"
        style={{ fontSize: '1.02rem', lineHeight: 1.35, color: 'var(--brand-ink)' }}
      >
        Added {label} to your knowledge base.
      </p>

      {/* Secondary prompt — clearly subordinate to the message above. */}
      <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        How often should this show up?
      </p>

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
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-quiet transition-colors disabled:opacity-60"
              style={{
                fontWeight: isSelected ? 700 : 500,
                color: isSelected ? GOLD_INK : 'var(--text-muted)',
                backgroundColor: isSelected
                  ? 'color-mix(in srgb, var(--accent-gold) 20%, var(--brand-card))'
                  : 'transparent',
                borderColor: isSelected
                  ? 'color-mix(in srgb, var(--accent-gold) 55%, var(--brand-border))'
                  : 'var(--brand-rule)',
              }}
            >
              {TERRITORY_FREQUENCY_LABEL[frequency]}
              <FrequencyMark frequency={frequency} color="var(--brand-ink-400)" size={13} decorative />
            </button>
          );
        })}
      </div>

      {/* Helper text — clearly tertiary: small, quiet, but not faint. */}
      <p className="mt-2 text-xs" style={{ color: 'var(--brand-ink-400)' }}>
        {busy ? 'Saving…' : FREQUENCY_HINT[selected]}
      </p>

      {error ? (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--game-wrong-strong)' }}>
          Could not update it. Try again.
        </p>
      ) : null}
    </ThreadCard>
  );
}
