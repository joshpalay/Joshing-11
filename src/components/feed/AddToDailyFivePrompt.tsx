'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'

type Status = 'idle' | 'submitting' | 'accepted' | 'error'

const SETTINGS_HREF = '/daily/setup'

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
    <div className="mt-3 rounded-2xl border border-amber-300/70 bg-amber-50/60 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"
          aria-hidden
        >
          <Sparkles className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[14px] leading-snug font-semibold text-amber-900">
            New territory{label ? <> in {label}</> : null} — it&rsquo;s on your map.
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px] text-amber-950 select-none">
            <input
              type="checkbox"
              checked={checked}
              disabled={status === 'submitting' || status === 'accepted'}
              onChange={() => void toggle()}
              className="size-4 shrink-0 rounded border-amber-400 text-amber-700 accent-amber-700 focus:ring-amber-600 disabled:cursor-default"
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
            <p className="mt-1.5 text-[12px] text-red-700">
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
            <p className="mt-1.5 text-[11px] text-amber-800/80">
              Change anytime in{' '}
              <Link
                href={SETTINGS_HREF}
                className="font-semibold underline underline-offset-2 hover:text-amber-900"
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
