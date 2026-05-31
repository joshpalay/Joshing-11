'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'

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
  // Opt-out by default: the freshly opened territory is added to the Daily Five
  // automatically (checkbox starts checked, add fires on mount), and the user
  // can uncheck to pull it back out. Mirrors the practice-bank auto-save + undo
  // flow in AnswerFeedbackSheet so "New territory" celebrations don't require an
  // extra tap to start practicing the topic.
  const [checked, setChecked] = useState(true)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState(false)
  // Latest selectedDomains the server has confirmed, so an uncheck can PATCH the
  // list with this domain removed. Also remember the canonical (server-cased)
  // form of the domain for accurate removal.
  const selectedDomainsRef = useRef<string[]>([])
  const matchedDomainRef = useRef(domain)
  const didAutoAddRef = useRef(false)
  const label = category || domain

  const addDomain = useCallback(async () => {
    const response = await fetch('/api/daily/preferences/add-domain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ domain }),
    })
    if (!response.ok) throw new Error('add failed')
    const data = (await response.json()) as { selectedDomains?: unknown }
    if (Array.isArray(data.selectedDomains)) {
      const domains = data.selectedDomains.filter((d): d is string => typeof d === 'string')
      selectedDomainsRef.current = domains
      const match = domains.find((d) => d.toLowerCase() === domain.toLowerCase())
      if (match) matchedDomainRef.current = match
    }
  }, [domain])

  const removeDomain = useCallback(async () => {
    const key = matchedDomainRef.current.toLowerCase()
    const next = selectedDomainsRef.current.filter((d) => d.toLowerCase() !== key)
    const response = await fetch('/api/daily/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ selectedDomains: next }),
    })
    if (!response.ok) throw new Error('remove failed')
    const data = (await response.json()) as { preferences?: { selectedDomains?: unknown } }
    const updated = data.preferences?.selectedDomains
    if (Array.isArray(updated)) {
      selectedDomainsRef.current = updated.filter((d): d is string => typeof d === 'string')
    } else {
      selectedDomainsRef.current = next
    }
  }, [])

  // Auto-add on mount so the default-checked box reflects reality.
  useEffect(() => {
    if (didAutoAddRef.current) return
    didAutoAddRef.current = true
    void (async () => {
      try {
        await addDomain()
        setError(false)
      } catch {
        setChecked(false)
        setError(true)
      } finally {
        setPending(false)
      }
    })()
  }, [addDomain])

  const toggle = () => {
    if (pending) return
    const next = !checked
    setChecked(next)
    setPending(true)
    setError(false)
    void (async () => {
      try {
        if (next) await addDomain()
        else await removeDomain()
      } catch {
        setChecked(!next)
        setError(true)
      } finally {
        setPending(false)
      }
    })()
  }

  const statusLabel = pending
    ? checked
      ? 'Adding to your Daily Five…'
      : 'Removing from your Daily Five…'
    : checked
      ? 'Added to your Daily Five'
      : 'Add to my Daily Five'

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
              disabled={pending}
              onChange={() => toggle()}
              className="size-4 shrink-0 rounded accent-[var(--tri-amber)] disabled:cursor-default"
            />
            <span>{statusLabel}</span>
          </label>
          {error ? (
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
