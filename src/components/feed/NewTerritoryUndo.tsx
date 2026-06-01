'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

// Darkened triangle-gold so the "New territory" copy clears AA on the cream
// card (raw --tri-amber #d9a82e is too light for small text).
const GOLD_INK = 'color-mix(in srgb, var(--tri-amber) 50%, var(--brand-ink))';

type RemoveState = 'idle' | 'removing' | 'removed' | 'error';

// Default-add with undo (B-1): a correct answer in an unfamiliar domain opens
// it in the player's Knowledge base automatically (server-side, via
// writeMasteryEvent). This card surfaces that the domain was added and offers
// a single "remove" that deletes the freshly-opened domain — reversing the KB
// open and pulling it from any custom Daily Five selection. The player stays in
// control via removal, not an opt-in gate. Used on both reveal surfaces.
export function NewTerritoryUndo({
  domain,
  category,
}: {
  domain: string;
  category?: string | null;
}) {
  const [state, setState] = useState<RemoveState>('idle');
  const label = category || domain;

  const handleRemove = async () => {
    if (state === 'removing' || state === 'removed') return;
    setState('removing');
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(domain)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('remove failed');
      setState('removed');
    } catch {
      setState('error');
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
          {state === 'removed' ? (
            <p
              className="font-serif text-[14px] leading-snug"
              style={{ color: 'var(--brand-ink)' }}
            >
              Removed {label} from your knowledge base.
            </p>
          ) : (
            <>
              <p
                className="font-serif text-[14px] leading-snug font-semibold"
                style={{ color: GOLD_INK }}
              >
                Added {label} to your knowledge base.
              </p>
              <p className="mt-1.5 text-[13px] text-[var(--brand-ink)]">
                {state === 'removing' ? (
                  <span className="text-[var(--brand-ink-400)]">Removing…</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleRemove()}
                    className="font-semibold underline underline-offset-2 hover:opacity-70"
                    style={{ color: GOLD_INK }}
                  >
                    Remove
                  </button>
                )}
              </p>
              {state === 'error' ? (
                <p className="mt-1.5 text-[12px]" style={{ color: 'var(--game-wrong-strong)' }}>
                  Could not remove it. Try again.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
