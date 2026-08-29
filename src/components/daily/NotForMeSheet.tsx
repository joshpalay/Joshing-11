'use client'

import { useEffect, useState } from 'react'
import { Clock, EyeOff, Moon, X } from 'lucide-react'

// The single "Not for me" control's sheet.
//
// It replaces two adjacent, identically-styled links that did drastically
// different things: "Dismiss" (a temporary, capped skip) and "This is {Name}'s
// bag but not mine" (a DURABLE category opt-out that wrote a preference on one
// tap, and only ever appeared on +2 bonus slots). Same look, one reversible and
// one not, no confirmation on either.
//
// Now there is one control everywhere, and the scope is an explicit choice:
//   - Skip for now        → temporary, comes back
//   - Never this question → durable, undoable from Settings
//   - Rest this category  → durable, undoable from Manage your topics
//
// Person-scope hiding deliberately stays in the feed's ⋯ menu; it is a different
// axis (who, not what) and mixing it in here would make the sheet a grab bag.

export type NotForMeScope = 'skip' | 'hide_question' | 'rest_category'

export function NotForMeSheet({
  domain,
  categoryLabel,
  presenceSourceName,
  skipDisabled,
  skipDisabledReason,
  onChoose,
  onClose,
}: {
  /** Canonical subcategory — what "rest this category" actually rests. */
  domain: string
  /** Human label for the category, when it differs from the raw domain key. */
  categoryLabel?: string | null
  /**
   * Set only on a +2 bonus slot, where the question came from a friend's world.
   * Swaps the category row's copy to the product's own phrasing for it.
   */
  presenceSourceName?: string | null
  /** True once the round's skip cap is spent — the row stays visible but inert. */
  skipDisabled?: boolean
  skipDisabledReason?: string
  onChoose: (scope: NotForMeScope) => void | Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState<NotForMeScope | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const label = (categoryLabel && categoryLabel.trim()) || domain
  const firstName = presenceSourceName ? presenceSourceName.trim().split(/\s+/)[0] : null

  async function choose(scope: NotForMeScope) {
    if (busy) return
    setBusy(scope)
    try {
      await onChoose(scope)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0"
        style={{ background: 'var(--scrim)' }}
        onClick={onClose}
        aria-label="Dismiss"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Not for me"
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl bg-[var(--brand-card)] shadow-[var(--shadow-overlay)]"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <p className="text-xs font-semibold tracking-[0.18em] uppercase text-[var(--brand-ink-400)]">
            Not for me
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-11 items-center justify-center rounded-full text-[var(--brand-ink-400)] transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto px-5 pt-2 pb-6">
          <Choice
            icon={<Clock className="size-5" />}
            title="Skip for now"
            subtitle={
              skipDisabled
                ? (skipDisabledReason ?? 'No skips left in this round.')
                : "It'll come back another day."
            }
            disabled={Boolean(skipDisabled) || busy !== null}
            busy={busy === 'skip'}
            onClick={() => void choose('skip')}
          />

          <Choice
            icon={<EyeOff className="size-5" />}
            title="Never show this question"
            subtitle="You can bring it back from Settings › Hidden questions."
            disabled={busy !== null}
            busy={busy === 'hide_question'}
            onClick={() => void choose('hide_question')}
          />

          <Choice
            icon={<Moon className="size-5" />}
            title={firstName ? `This is ${firstName}’s bag but not mine` : `Rest ${label}`}
            subtitle={`${label} stops appearing in your five. Undo it in Manage your topics.`}
            disabled={busy !== null}
            busy={busy === 'rest_category'}
            onClick={() => void choose('rest_category')}
          />
        </div>
      </div>
    </div>
  )
}

function Choice({
  icon,
  title,
  subtitle,
  disabled,
  busy,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  disabled?: boolean
  busy?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start gap-3 rounded-2xl border border-[var(--brand-rule)] bg-[var(--brand-card)] px-4 py-3 text-left transition hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="mt-0.5 shrink-0 text-[var(--brand-ink-400)]">{icon}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">
          {title}
          {busy ? '…' : ''}
        </span>
        <span className="text-quiet text-[var(--brand-ink-400)]">{subtitle}</span>
      </span>
    </button>
  )
}
