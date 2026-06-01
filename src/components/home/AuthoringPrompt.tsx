import Link from 'next/link'

// Capability 12 (B-4 Stage B): a homepage nudge encouraging question authoring,
// framed around the author's own benefit — writing questions opens new domains
// in your Knowledge base and feeds your own Daily Five — not as a chore. Kept
// lightweight and placed below the daily ritual so it never crowds Today's Five
// or its +2 bonus slots.
export function AuthoringPrompt() {
  return (
    <div className="bg-card text-card-foreground flex items-center justify-between gap-3 rounded-[4px] border border-[var(--brand-border)] px-3 py-4">
      <div className="min-w-0">
        <p className="font-serif text-[16px] leading-[24px] font-semibold tracking-[0.04em] text-[var(--brand-ink)]">
          Write a question
        </p>
        <p className="mt-1 text-xs font-medium tracking-[0.06em] text-[var(--brand-ink-400)]">
          Sharpens your own Daily Five — and gives you something to share.
        </p>
      </div>
      <Link
        href="/questions?create=1&intent=bank"
        className="font-serif text-lg leading-[24px] font-semibold tracking-[0.05em] whitespace-nowrap text-[var(--brand-link)] underline underline-offset-4"
        aria-label="Write a question"
      >
        Write →
      </Link>
    </div>
  )
}
