import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

/**
 * Header chrome shared by the two Home overflow subpages (B-HOME-OVERFLOW-02
 * §6): a clear back affordance to Home over the zone's eyebrow + serif title.
 * These pages are reached only from Home's "N more →" rows, so back is always
 * a real Link to `/` — a fresh dynamic render there recomputes the served
 * window from the shared pending queue (D-HOME-PACING-01 §7), which is why
 * this is a Link and not history.back().
 */
export function OverflowSubpageHeader({
  eyebrow,
  title,
}: {
  eyebrow: string
  title: string
}) {
  return (
    <header>
      <Link
        href="/"
        aria-label="Back to Home"
        className="-ml-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--brand-ink-400)] transition hover:text-[var(--brand-ink)]"
      >
        <ArrowLeft className="size-5" strokeWidth={1.9} />
      </Link>
      <p className="text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-1 font-serif text-[26px] leading-[1.15] font-medium text-[var(--brand-ink)]">
        {title}
      </h1>
    </header>
  )
}
