import Link from 'next/link'

export function MissedQuestionsCard({
  count,
  expiringCount,
}: {
  count: number
  expiringCount: number
}) {
  if (count === 0) return null
  const missedLabel = count === 1 ? '1 missed question' : `${count} missed questions`
  return (
    <div
      className="bg-card text-card-foreground flex items-center justify-between gap-3 rounded-[4px] border border-[var(--brand-border)] px-3 py-4"
      style={
        expiringCount > 0
          ? { borderColor: 'color-mix(in srgb, var(--brand-orange) 40%, var(--brand-border))' }
          : undefined
      }
    >
      <div className="min-w-0">
        <p className="font-serif text-base leading-[24px] font-semibold tracking-[0.04em] text-[var(--brand-ink)]">
          Catch up
        </p>
        <p className="mt-1 text-xs font-medium tracking-[0.06em] text-[var(--brand-ink-400)]">
          {missedLabel}
          {expiringCount > 0 ? ` · ${expiringCount} expire tomorrow` : ''}
        </p>
      </div>
      <Link
        href="/daily/catchup"
        className="text-sm font-medium whitespace-nowrap text-[var(--brand-link)] underline underline-offset-4"
        aria-label={`Catch up on ${missedLabel}`}
      >
        Play →
      </Link>
    </div>
  )
}
