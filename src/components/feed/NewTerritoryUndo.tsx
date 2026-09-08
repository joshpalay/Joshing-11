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
// B-DOMAIN-BONUS-ROTATION-01 / ask-before-add: on the daily +2 BONUS surface the
// domain is NOT auto-added at all — writeMasteryEvent deliberately skips the
// knowledge-base write for a bonus answer that opens a new territory, so nothing
// exists server-side until the player says yes here. `adopted={false}` therefore
// renders a permission question ("Add {domain} to your topics?") instead of the
// already-added state; only on "Yes, sometimes"/"Yes, often" does the row get
// created (adoptBonusDomain). "Not now" makes no call — there is nothing to undo.
const FREQUENCY_HINT: Record<TerritoryFrequency, string> = {
  often: 'Shows up most in your rounds.',
  sometimes: 'Stays in normal rotation.',
  blue_moon: 'Only surfaces every so often.',
  resting: "Stays on your map, but won't be asked.",
};

const cardShellProps = {
  rail: 'var(--accent-gold)',
  border: 'color-mix(in srgb, var(--accent-gold) 32%, var(--brand-rule))',
  fill: 'color-mix(in srgb, var(--accent-gold) 7%, var(--brand-card))',
  style: { marginTop: '8px' },
} as const;

const eyebrowStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.6rem',
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  color: GOLD_INK,
};

const primaryMessageStyle = {
  fontSize: '1.02rem',
  lineHeight: 1.35,
  color: 'var(--brand-ink)',
};

const pillButton =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-quiet transition-colors disabled:opacity-60';

export function NewTerritoryUndo({
  domain,
  category,
  adopted = true,
}: {
  domain: string;
  category?: string | null;
  /**
   * Whether this domain is already in rotation (B-1 default-add). True on the
   * feed/core surfaces. The daily +2 bonus surface passes false: nothing has
   * been written yet, so this renders the ask-before-add confirm instead of
   * the already-added frequency dial (B-DOMAIN-BONUS-ROTATION-01).
   */
  adopted?: boolean;
}) {
  return adopted ? (
    <AdoptedFrequencyCard domain={domain} category={category} />
  ) : (
    <BonusAskCard domain={domain} category={category} />
  );
}

type AdoptFrequency = Extract<TerritoryFrequency, 'often' | 'sometimes'>;

type BonusPhase =
  | { step: 'ask' }
  | { step: 'adding'; frequency: AdoptFrequency }
  | { step: 'added'; frequency: AdoptFrequency }
  | { step: 'declined' }
  | { step: 'failed'; frequency: AdoptFrequency };

/**
 * Ask-before-add: the +2 bonus reveal. Nothing is on the player's map yet, so
 * this asks permission first ("Add {label} to your topics?") and only calls
 * adopt-bonus-domain once they pick a frequency — mirroring the confirm step
 * KnowledgeNodeCard already uses for the ghost-add path on the Knowledge map.
 */
function BonusAskCard({ domain, category }: { domain: string; category?: string | null }) {
  const [phase, setPhase] = useState<BonusPhase>({ step: 'ask' });
  const label = category || domain;

  const confirm = async (frequency: AdoptFrequency) => {
    setPhase({ step: 'adding', frequency });
    try {
      const response = await fetch('/api/daily/preferences/adopt-bonus-domain', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain, frequency, broadCategory: category ?? undefined }),
      });
      if (!response.ok) throw new Error('adopt failed');
      setPhase({ step: 'added', frequency });
    } catch {
      setPhase({ step: 'failed', frequency });
    }
  };

  if (phase.step === 'declined') return null;

  return (
    <ThreadCard {...cardShellProps}>
      <p className="flex items-center gap-1.5" style={eyebrowStyle}>
        <Sparkles className="size-3" aria-hidden />
        {phase.step === 'added' ? 'Knowledge updated' : 'New territory'}
      </p>

      {phase.step === 'ask' ? (
        <>
          <p className="mt-1.5 font-serif font-semibold" style={primaryMessageStyle}>
            Add <strong>{label}</strong> to your topics?
          </p>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            It&rsquo;ll start showing up in your Daily Five.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void confirm('sometimes')}
              className={`${pillButton} font-semibold`}
              style={{
                color: GOLD_INK,
                backgroundColor: 'color-mix(in srgb, var(--accent-gold) 20%, var(--brand-card))',
                borderColor: 'color-mix(in srgb, var(--accent-gold) 55%, var(--brand-border))',
              }}
            >
              Yes, sometimes
            </button>
            <button
              type="button"
              onClick={() => void confirm('often')}
              className={`${pillButton} font-medium`}
              style={{ color: 'var(--text-muted)', borderColor: 'var(--brand-rule)' }}
            >
              Yes, often
            </button>
            <button
              type="button"
              onClick={() => setPhase({ step: 'declined' })}
              className={`${pillButton} font-medium`}
              style={{ color: 'var(--text-muted)', borderColor: 'var(--brand-rule)' }}
            >
              Not now
            </button>
          </div>
        </>
      ) : phase.step === 'adding' ? (
        <p className="mt-1.5 font-serif" style={primaryMessageStyle} aria-live="polite">
          Adding {label}…
        </p>
      ) : phase.step === 'added' ? (
        <>
          <p className="mt-1.5 font-serif font-semibold" style={primaryMessageStyle} aria-live="polite">
            Added <strong>{label}</strong> to your topics.
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--brand-ink-400)' }}>
            {FREQUENCY_HINT[phase.frequency]}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1.5 font-serif" style={primaryMessageStyle} aria-live="polite">
            Couldn&rsquo;t add {label} just now.
          </p>
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => void confirm(phase.frequency)}
              className={`${pillButton} font-semibold`}
              style={{
                color: GOLD_INK,
                borderColor: 'color-mix(in srgb, var(--accent-gold) 55%, var(--brand-border))',
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => setPhase({ step: 'ask' })}
              className={`${pillButton} font-medium`}
              style={{ color: 'var(--text-muted)', borderColor: 'var(--brand-rule)' }}
            >
              Back
            </button>
          </div>
        </>
      )}
    </ThreadCard>
  );
}

/**
 * Default-add (B-1): the domain is already on the player's map — this only
 * lets them dial how often it should come up. Unchanged by ask-before-add;
 * that gate only applies to the not-yet-adopted bonus surface above.
 */
function AdoptedFrequencyCard({ domain, category }: { domain: string; category?: string | null }) {
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
    <ThreadCard {...cardShellProps}>
      {/* Quiet label — same eyebrow rhythm as the result cards. */}
      <p className="flex items-center gap-1.5" style={eyebrowStyle}>
        <Sparkles className="size-3" aria-hidden />
        Knowledge updated
      </p>

      {/* Primary message — the dominant, clearest line in the card. */}
      <p className="mt-1.5 font-serif font-semibold" style={primaryMessageStyle}>
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
              className={pillButton}
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
