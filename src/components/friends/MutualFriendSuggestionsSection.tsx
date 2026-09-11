'use client'

import { useState } from 'react'

import { AddFriendRequestModal } from '@/components/friends/AddFriendRequestModal'

// B-MUTUAL-FRIEND-SUGGESTIONS-01 Phase 2a. Server-fetched suggestion, already
// enriched with the (optional) interests preview -- see friends/page.tsx.
export type MutualFriendSuggestionRow = {
  id: string
  displayName: string
  mutualFriendCount: number
  // Up to 3 of the candidate's active declared interests, already comma-
  // joined ("Astronomy, Baking, Chess"), or null when they have none (the row
  // then shows only the mutual-friend-count line -- no placeholder text).
  interestsPreview: string | null
}

export const DEFAULT_VISIBLE = 5

// Matches KnowledgePeaksView's inline "+ Add" pill exactly (same classes) --
// the approved mockup names that button as the visual reference. bg-background
// + text-foreground resolve to the cream page surface + navy ink in this
// app's theme, giving the outlined navy-on-cream look without a new color.
const REQUEST_BUTTON_CLASS =
  'inline-flex min-h-9 flex-none items-center gap-1 rounded-[var(--radius-xs)] border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function mutualFriendCountLabel(count: number): string {
  return count === 1 ? '1 mutual friend' : `${count} mutual friends`
}

// Pure decision logic, DB/DOM-free and exported for unit testing without
// rendering anything -- mirrors FriendRequestsSection's deriveVisibleRequests
// (this repo's established pattern for testing an interactive client
// component's state logic, since @testing-library/react isn't a dependency
// here). Derives the visible list from props minus locally-resolved ids
// (a request just sent from THIS card) rather than seeding state, so a prop
// update from the parent is never shadowed by stale local state.
export function deriveVisibleSuggestions(
  all: MutualFriendSuggestionRow[],
  sentIds: ReadonlySet<string>,
): MutualFriendSuggestionRow[] {
  return all.filter((s) => !sentIds.has(s.id))
}

// Pure: what to actually render given the expand/collapse toggle, and
// whether a "See more" affordance is still warranted.
export function deriveDisplayedSuggestions(
  visible: MutualFriendSuggestionRow[],
  expanded: boolean,
  defaultVisible = DEFAULT_VISIBLE,
): { displayed: MutualFriendSuggestionRow[]; hasMore: boolean } {
  const displayed = expanded ? visible : visible.slice(0, defaultVisible)
  return { displayed, hasMore: !expanded && visible.length > displayed.length }
}

function SuggestionRow({
  suggestion,
  onRequestClick,
  isLast,
}: {
  suggestion: MutualFriendSuggestionRow
  onRequestClick: () => void
  isLast: boolean
}) {
  return (
    <article
      className={`flex items-center justify-between gap-3 py-3 ${
        isLast ? '' : 'border-b border-[var(--brand-border)]'
      }`}
    >
      {/* No avatar -- name + text only, per the approved mockup. */}
      <div className="min-w-0 flex-1">
        <h3 className="font-serif text-lg font-semibold text-foreground">
          {suggestion.displayName}
        </h3>
        <p className="text-[var(--brand-ink-400)] text-sm">
          {mutualFriendCountLabel(suggestion.mutualFriendCount)}
        </p>
        {suggestion.interestsPreview ? (
          <p className="text-[var(--brand-ink-400)] text-sm">Into {suggestion.interestsPreview}</p>
        ) : null}
      </div>
      <button type="button" className={REQUEST_BUTTON_CLASS} onClick={onRequestClick}>
        + Request
      </button>
    </article>
  )
}

export function MutualFriendSuggestionsSection({
  initialSuggestions,
}: {
  initialSuggestions: MutualFriendSuggestionRow[]
}) {
  // Optimistically-cleared ids (request just sent) -- same pattern as
  // FriendRequestsSection's removedIds. No cross-surface duplicate of this
  // exact card exists elsewhere on this page, so no router.refresh() is
  // needed on send (unlike that component, which also has to clear a
  // duplicate "wants to be friends" row in the Recent Activity feed).
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState(false)
  const [requestTarget, setRequestTarget] = useState<MutualFriendSuggestionRow | null>(null)

  const visible = deriveVisibleSuggestions(initialSuggestions, sentIds)

  // Empty state: render nothing at all -- no card, no heading, no "no
  // suggestions yet" copy. Consistent with the feature's low-key design and
  // matching FriendRequestsSection's own zero-state convention on this page.
  if (visible.length === 0) return null

  const { displayed, hasMore } = deriveDisplayedSuggestions(visible, expanded)

  return (
    <section aria-labelledby="mutual-friend-suggestions-heading" className="mb-5 space-y-3">
      <h2
        id="mutual-friend-suggestions-heading"
        className="text-quiet font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase"
      >
        People you may know
      </h2>
      <div className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
        {displayed.map((suggestion, index) => (
          <SuggestionRow
            key={suggestion.id}
            suggestion={suggestion}
            isLast={index === displayed.length - 1}
            onRequestClick={() => setRequestTarget(suggestion)}
          />
        ))}
      </div>
      {hasMore ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="focus-visible:ring-ring text-sm font-medium text-[var(--brand-ink-400)] underline underline-offset-4 hover:text-foreground focus-visible:rounded focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          See more
        </button>
      ) : null}

      {requestTarget ? (
        <AddFriendRequestModal
          targetUserId={requestTarget.id}
          targetDisplayName={requestTarget.displayName}
          onClose={() => setRequestTarget(null)}
          onSent={() => {
            setSentIds((current) => {
              const next = new Set(current)
              next.add(requestTarget.id)
              return next
            })
            setRequestTarget(null)
          }}
        />
      ) : null}
    </section>
  )
}
