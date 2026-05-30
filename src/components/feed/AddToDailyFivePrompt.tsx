'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'

type Status = 'idle' | 'submitting' | 'accepted' | 'error'

const SETTINGS_HREF = '/daily/setup'

// Darkened triangle-gold so the "New territory" eyebrow/title clears AA on the
// cream card (raw --tri-amber #d9a82e is too light for small text).
const GOLD_INK = 'color-mix(in srgb, var(--tri-amber) 50%, var(--brand-ink))'

export function AddToDailyFivePrompt({
  domain,
  category,
}: {
  domain: string
  category?: string | null
}) {
  const [status, setStatus] = useState<Status>('idle')
  const checked = status === 'accepted'
  const label = category || domain

  const toggle = async () => {
    if (status === 'submitting' || status === 'accepted') return
    setStatus('submitting')
    try {
      const response = await fetch('/api/daily/preferences/add-domain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain }),
      })
      if (!response.ok) throw new Error('add failed')
      setStatus('accepted')
    } catch {
      setStatus('error')
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
          <Sparkles className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[14px] leading-snug font-semibold" style={{ color: GOLD_INK }}>
            New territory{label ? <> in {label}</> : null} — it&rsquo;s on your map.
          </p>
          <label
            className="mt-2 flex cursor-pointer items-center gap-2 text-[13px] select-none text-[var(--brand-ink)]"
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={status === 'submitting' || status === 'accepted'}
              onChange={() => void toggle()}
              className="size-4 shrink-0 rounded accent-[var(--tri-amber)] disabled:cursor-default"
            />
            <span>
              {status === 'submitting'
                ? 'Adding to your Daily Five…'
                : status === 'accepted'
                  ? 'Added to your Daily Five'
                  : 'Add to my Daily Five'}
            </span>
          </label>
          {status === 'error' ? (
            <p className="mt-1.5 text-[12px]" style={{ color: 'var(--game-wrong-strong)' }}>
              Could not update your Daily Five. Try from{' '}
              <Link
                href={SETTINGS_HREF}
                className="font-semibold underline underline-offset-2"
              >
                Daily Five settings
              </Link>
              .
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-[var(--brand-ink-400)]">
              Change anytime in{' '}
              <Link
                href={SETTINGS_HREF}
                className="font-semibold underline underline-offset-2 hover:opacity-70"
              >
                Daily Five settings
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
