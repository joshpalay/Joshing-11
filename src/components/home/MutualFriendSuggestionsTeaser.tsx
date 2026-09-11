import Link from 'next/link'

// B-MUTUAL-FRIEND-SUGGESTIONS-01 Phase 2c. Mirrors MissedQuestionsCard's
// shape (bg-card, serif heading, muted subline, Link out, null at zero) --
// but deliberately carries NONE of that card's urgency styling (no
// conditional border color, no icon) per the approved design: "no visual
// emphasis -- no color, no badge, no icon pulse". The whole card is the tap
// target (not just a corner link), and it never renders an inline list --
// tapping goes straight to the Friends page section.
export function MutualFriendSuggestionsTeaser({ count }: { count: number }) {
  if (count === 0) return null
  const label = count === 1 ? '1 person you may know' : `${count} people you may know`
  return (
    <Link
      href="/friends"
      className="bg-card text-card-foreground flex items-center justify-between gap-3 rounded-[var(--radius-xs)] border border-[var(--brand-border)] px-3 py-4"
      aria-label={label}
    >
      <p className="font-serif text-base leading-[24px] font-semibold tracking-[0.04em] text-[var(--brand-ink)]">
        {label}
      </p>
      <span aria-hidden className="text-sm font-medium text-[var(--brand-ink-400)]">
        →
      </span>
    </Link>
  )
}
