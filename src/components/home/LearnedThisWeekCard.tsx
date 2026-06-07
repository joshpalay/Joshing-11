import Link from 'next/link'

export function LearnedThisWeekCard({ count }: { count: number }) {
  if (count === 0) return null
  const label = count === 1 ? '1 question you turned around' : `${count} questions you turned around`
  return (
    <div className="bg-card text-card-foreground flex items-center justify-between gap-3 rounded-[4px] border border-[var(--brand-border)] px-3 py-4">
      <div className="min-w-0">
        <p className="font-serif text-base leading-[24px] font-semibold tracking-[0.04em] text-[var(--brand-ink)]">
          Something you learned this week
        </p>
        <p className="mt-1 text-xs font-medium tracking-[0.06em] text-[var(--brand-ink-400)]">
          {label}
        </p>
      </div>
      <Link
        href="/learned"
        className="font-serif text-lg leading-[24px] font-semibold tracking-[0.05em] whitespace-nowrap text-[var(--brand-link)] underline underline-offset-4"
        aria-label="See something you learned this week"
      >
        Look back →
      </Link>
    </div>
  )
}
