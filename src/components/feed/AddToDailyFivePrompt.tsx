'use client'

import { useState } from 'react'
import Link from 'next/link'

type Status = 'idle' | 'submitting' | 'accepted' | 'dismissed' | 'error'

const SETTINGS_HREF = '/daily/setup'

export function AddToDailyFivePrompt({ domain }: { domain: string }) {
  const [status, setStatus] = useState<Status>('idle')

  const accept = async () => {
    if (status === 'submitting') return
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

  const dismiss = () => {
    if (status === 'submitting') return
    setStatus('dismissed')
  }

  if (status === 'accepted') {
    return (
      <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900">
        Added <strong>{domain}</strong> to your Daily Five.{' '}
        <Link
          href={SETTINGS_HREF}
          className="font-semibold underline underline-offset-2 hover:text-emerald-950"
        >
          Manage topics
        </Link>
        .
      </div>
    )
  }

  if (status === 'dismissed') {
    return (
      <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-[13px] text-stone-700">
        Got it. You can add topics anytime in{' '}
        <Link
          href={SETTINGS_HREF}
          className="font-semibold underline underline-offset-2 hover:text-stone-900"
        >
          Daily Five settings
        </Link>
        .
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-2xl border border-amber-300/70 bg-amber-50/60 px-4 py-3">
      <p className="font-serif text-[14px] leading-snug text-amber-950">
        Want questions on <strong>{domain}</strong> in your Daily Five?
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void accept()}
          disabled={status === 'submitting'}
          className="inline-flex items-center rounded-full bg-amber-700 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-amber-800 disabled:cursor-default disabled:opacity-60"
        >
          {status === 'submitting' ? 'Adding…' : 'Add to Daily Five'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={status === 'submitting'}
          className="inline-flex items-center rounded-full border border-amber-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-amber-900 transition hover:bg-amber-50 disabled:cursor-default disabled:opacity-60"
        >
          No thanks
        </button>
      </div>
      {status === 'error' ? (
        <p className="mt-2 text-[12px] text-red-700">
          Could not update your Daily Five. Try again from{' '}
          <Link
            href={SETTINGS_HREF}
            className="font-semibold underline underline-offset-2"
          >
            Daily Five settings
          </Link>
          .
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-amber-800/80">
          You can change this anytime in{' '}
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
  )
}
