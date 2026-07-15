type DismissedFeedBarProps = {
  /** Restores the full card — no side effects, nothing learned. */
  onUndo: () => void
  disabled?: boolean
  /** The canonical answer to surface on the card back. null = none to show. */
  answer?: string | null
  /** True while the on-demand answer fetch is in flight. */
  answerLoading?: boolean
  /** True if the on-demand answer fetch failed. */
  answerError?: boolean
}

/**
 * The dismissed card rendered as the "back of the card": a solid muted surface
 * (no dashed border) that surfaces the question's answer, fetched on-demand when
 * the card is dismissed. Dismiss is view-state only (Undo restores it) — the
 * category-mute affordance was removed when feed-mute was retired.
 */
export function DismissedFeedBar({
  onUndo,
  disabled,
  answer,
  answerLoading,
  answerError,
}: DismissedFeedBarProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="relative overflow-hidden rounded-[var(--radius-xs)] border border-[var(--brand-rule)] bg-[var(--game-card-question)] px-4 py-3 shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm italic">Dismissed</span>
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={disabled}
            onClick={onUndo}
            className="text-foreground text-xs font-medium underline-offset-4 hover:underline disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      </div>
      <div className="mt-2">
        {answerLoading ? (
          <span className="text-muted-foreground text-quiet italic">
            Revealing answer…
          </span>
        ) : answerError ? (
          <span className="text-muted-foreground text-quiet italic">
            Answer unavailable
          </span>
        ) : answer ? (
          <p
            className="text-quiet italic"
            style={{
              fontFamily: 'var(--font-serif)',
              color: 'var(--ink)',
              opacity: 0.7,
            }}
          >
            {answer}
          </p>
        ) : null}
      </div>
    </div>
  )
}
