'use client'

import { useState } from 'react'
import { Moon, Sparkles } from 'lucide-react'

import type { TerritoryFrequency } from '@/lib/daily/territory-model'

// Darkened triangle-gold so the "New territory" copy clears AA on the cream
// card (raw --tri-amber #d9a82e is too light for small text).
const GOLD_INK = 'color-mix(in srgb, var(--tri-amber) 50%, var(--brand-ink))'

// Default-add with a soft demote (B-1): a correct answer in an unfamiliar domain
// opens it in the player's Knowledge base automatically (server-side, via
// writeMasteryEvent). This card surfaces that the domain was added, and the
// primary control doesn't delete it — it moves the freshly-opened domain to
// "Once in a Blue Moon" so it stays on the map but only surfaces every so often.
// After moving, an "Undo" steps back to the just-added stage by restoring the
// domain's prior frequency. The player stays in control without losing the
// territory. Used on both reveal surfaces.
export function NewTerritoryUndo({
  domain,
  category,
}: {
  domain: string
  category?: string | null
}) {
  // 'open' = freshly added (default rotation); 'blue_moon' = demoted to rare.
  const [stage, setStage] = useState<'open' | 'blue_moon'>('open')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  // The frequency the domain had before we moved it to blue_moon, so Undo can
  // restore exactly that (usually unset → null, i.e. default rotation).
  const [previousFrequency, setPreviousFrequency] = useState<TerritoryFrequency | null>(null)
  const label = category || domain

  const setFrequency = async (frequency: TerritoryFrequency | null) => {
    const response = await fetch('/api/daily/preferences/domain-frequency', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain, frequency }),
    })
    if (!response.ok) throw new Error('frequency update failed')
    return (await response.json().catch(() => null)) as {
      previousFrequency?: TerritoryFrequency | null
    } | null
  }

  const handleBlueMoon = async () => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      const result = await setFrequency('blue_moon')
      setPreviousFrequency(result?.previousFrequency ?? null)
      setStage('blue_moon')
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const handleUndo = async () => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      await setFrequency(previousFrequency)
      setStage('open')
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

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
          {stage === 'blue_moon' ? <Moon className="size-3.5" /> : <Sparkles className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          {stage === 'blue_moon' ? (
            <>
              <p className="font-serif text-sm leading-snug font-semibold" style={{ color: GOLD_INK }}>
                {label} is now once in a blue moon.
              </p>
              <p className="mt-1 text-[13px] text-[var(--brand-ink)]">
                It stays on your map but will only surface every so often.
              </p>
              <p className="mt-1.5 text-[13px] text-[var(--brand-ink)]">
                {busy ? (
                  <span className="text-[var(--brand-ink-400)]">Undoing…</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleUndo()}
                    className="font-semibold underline underline-offset-2 hover:opacity-70"
                    style={{ color: GOLD_INK }}
                  >
                    Undo
                  </button>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="font-serif text-sm leading-snug font-semibold" style={{ color: GOLD_INK }}>
                Added {label} to your knowledge base.
              </p>
              <p className="mt-1 text-[13px] text-[var(--brand-ink)]">
                Want it only every so often?
              </p>
              <p className="mt-1.5 text-[13px] text-[var(--brand-ink)]">
                {busy ? (
                  <span className="text-[var(--brand-ink-400)]">Moving…</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleBlueMoon()}
                    className="font-semibold underline underline-offset-2 hover:opacity-70"
                    style={{ color: GOLD_INK }}
                  >
                    Move to Once in a Blue Moon
                  </button>
                )}
              </p>
            </>
          )}
          {error ? (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--game-wrong-strong)' }}>
              Could not update it. Try again.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
