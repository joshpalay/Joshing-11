type DismissedFeedBarProps = {
  /** Visible category label for the mute affordance; omit/null to hide it. */
  category: string | null
  /** Restores the full card — no side effects, nothing learned. */
  onUndo: () => void
  /** The only mute path from here — wired to the existing category-mute handler. */
  onMute: () => void
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
 * the card is dismissed. Dismiss is view-state only; the deliberate
 * "Not into {category}?" second tap is the single place — alongside the "…"
 * menu — that fires the existing category mute.
 */
export function DismissedFeedBar({
  category,
  onUndo,
  onMute,
  disabled,
  answer,
  answerLoading,
  answerError,
}: DismissedFeedBarProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="relative overflow-hidden rounded-[4px] border border-[var(--brand-rule)] bg-[var(--game-card-question)] px-4 py-3 shadow-[var(--shadow-card)]"
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
          {category ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onMute}
              className="text-muted-foreground text-xs font-medium underline-offset-4 hover:underline disabled:opacity-50"
            >
              Not into {category}?
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-2">
        {answerLoading ? (
          <span className="text-muted-foreground text-[13px] italic">
            Revealing answer…
          </span>
        ) : answerError ? (
          <span className="text-muted-foreground text-[13px] italic">
            Answer unavailable
          </span>
        ) : answer ? (
          <p
            className="text-[13px] italic"
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
