type DismissedFeedBarProps = {
  /** Visible category label for the mute affordance; omit/null to hide it. */
  category: string | null
  /** Restores the full card — no side effects, nothing learned. */
  onUndo: () => void
  /** The only mute path from here — wired to the existing category-mute handler. */
  onMute: () => void
  disabled?: boolean
}

/**
 * The collapsed inline bar shown in place of a dismissed card (modeled on the
 * thumbs-down confirmation row). Dismiss is view-state only; the deliberate
 * "Not into {category}?" second tap is the single place — alongside the "…"
 * menu — that fires the existing category mute.
 */
export function DismissedFeedBar({
  category,
  onUndo,
  onMute,
  disabled,
}: DismissedFeedBarProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-muted-foreground flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-sm italic"
    >
      <span>Dismissed</span>
      <div className="flex items-center gap-4 not-italic">
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
            className="text-xs font-medium underline-offset-4 hover:underline disabled:opacity-50"
          >
            Not into {category}?
          </button>
        ) : null}
      </div>
    </div>
  )
}
