'use client'

import { type CSSProperties, useState } from 'react'

import type { ExpansionOffer } from '@/server/db/queries/daily-summary'

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--brand-ink)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
}

const groupStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '0.7rem',
  fontWeight: 600,
  color: 'var(--brand-ink-700)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

/**
 * Post-daily-Five expansion offer: "you're crushing {domain} — branch out?".
 * Surfaces when the player topped a domain's difficulty ladder yet still out-ran
 * its content (the supply-ceiling moment). Lets them multi-select adjacent domains
 * to add to their rotation permanently. Both accepting and dismissing resolve the
 * offer server-side so it shows once.
 */
export function ExpandDomainOfferCard({
  offer,
  preview = false,
}: {
  offer: ExpansionOffer
  /** Render-only mode for the profile preview link — never hits the API. */
  preview?: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'dismissed'>('idle')
  const [addedCount, setAddedCount] = useState(0)

  const toggle = (label: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const submit = async (picks: ExpansionOffer['candidates']) => {
    if (state === 'saving') return
    // Preview mode (profile link): show the result state without touching the API.
    if (preview) {
      if (picks.length > 0) {
        setAddedCount(picks.length)
        setState('done')
      } else {
        setState('dismissed')
      }
      return
    }
    setState('saving')
    try {
      const response = await fetch('/api/daily/expand-domains', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceDomain: offer.sourceDomain,
          selectedDomains: picks,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message ?? 'Could not save.')
      if (picks.length > 0) {
        setAddedCount(Array.isArray(body?.added) ? body.added.length : picks.length)
        setState('done')
      } else {
        setState('dismissed')
      }
    } catch {
      // Re-enable so the player can retry; the offer is still pending server-side.
      setState('idle')
    }
  }

  const accept = () => {
    const picks = offer.candidates.filter((c) => selected.has(c.label))
    if (picks.length === 0) return
    void submit(picks)
  }

  const dismiss = () => void submit([])

  if (state === 'dismissed') return null

  if (state === 'done') {
    return (
      <section className="mt-5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-4">
        <h2 style={titleStyle}>Branching out</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
          Added {addedCount} new {addedCount === 1 ? 'domain' : 'domains'} to your rotation. They&rsquo;ll
          start showing up in your daily five.
        </p>
      </section>
    )
  }

  const saving = state === 'saving'

  const broaderCandidates = offer.candidates.filter((c) => c.kind === 'broader')
  const widerCandidates = offer.candidates.filter((c) => c.kind === 'wider')

  const renderCandidate = (candidate: ExpansionOffer['candidates'][number]) => {
    const checked = selected.has(candidate.label)
    return (
      <label
        key={candidate.label}
        className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--brand-border)] px-3 py-2 text-sm text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-cream-page)]"
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={saving}
          onChange={() => toggle(candidate.label)}
          className="h-4 w-4 accent-[var(--brand-ink)]"
        />
        <span>{candidate.label}</span>
      </label>
    )
  }

  const renderGroup = (heading: string, hint: string, items: ExpansionOffer['candidates']) =>
    items.length > 0 ? (
      <div className="mt-4">
        <p style={groupStyle}>{heading}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--brand-ink-700)]">{hint}</p>
        <div className="mt-2 space-y-2">{items.map(renderCandidate)}</div>
      </div>
    ) : null

  return (
    <section className="mt-5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-4">
      <h2 style={titleStyle}>You&rsquo;re crushing {offer.sourceDisplayName}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
        You&rsquo;ve covered a lot of ground here. Add any to your rotation:
      </p>

      {/* Broader (the graduation — open the bigger field) leads; wider follows. */}
      {renderGroup('Go broader', 'Open up the bigger field this sits inside.', broaderCandidates)}
      {renderGroup('Branch wider', 'Jump to something close by.', widerCandidates)}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={accept}
          disabled={saving || selected.size === 0}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Adding…' : `Add ${selected.size > 0 ? selected.size : ''}`.trim()}
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={saving}
          className="btn-ghost disabled:opacity-50"
        >
          Not now
        </button>
      </div>
    </section>
  )
}
