import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// The three feed "featured moment" treatments. Each maps to a subtle full-bleed
// background wash (--editorial-* in globals.css) plus an eyebrow accent color
// borrowed from the brand palette. Add a tone here (and the matching CSS var +
// accent) when a new editorial module joins the feed.
export type EditorialTone = 'parchment' | 'sage' | 'slate'

const TONE_BG: Record<EditorialTone, string> = {
  parchment: 'bg-[var(--editorial-parchment)]',
  sage: 'bg-[var(--editorial-sage)]',
  slate: 'bg-[var(--editorial-slate)]',
}

const TONE_ACCENT: Record<EditorialTone, string> = {
  parchment: 'text-[var(--brand-orange)]',
  sage: 'text-[var(--success)]',
  slate: 'text-[var(--brand-link)]',
}

interface EditorialFeatureProps {
  tone: EditorialTone
  // Small uppercase label (e.g. "Overlap"). Rendered uppercase; pass it in
  // natural case.
  eyebrow: string
  // Optional mark beside the eyebrow (e.g. a filled bookmark), inheriting the
  // tone accent color.
  eyebrowIcon?: ReactNode
  // Large editorial headline. A node, so callers can weave an inline link (e.g.
  // the friend's name) into it.
  headline: ReactNode
  // The hero artwork slot (circles, avatar cluster, territory rows…).
  artwork: ReactNode
  // One short supporting line under the artwork (e.g. "2 shared interests").
  supporting?: ReactNode
  // A single text-link call to action. The arrow is part of `label`. Optional so
  // a module whose action isn't navigation (e.g. a form submit) can pass
  // `footerSlot` instead, or omit both.
  cta?: { label: string; href: string }
  // Escape hatch for a non-link action (e.g. a form submit button), rendered in
  // the same position the CTA link occupies, INSTEAD of the link when present.
  // The caller owns the element (and any surrounding <form>). Keep the editorial
  // register — the three navigation callers should keep using `cta`.
  footerSlot?: ReactNode
}

/**
 * A full-bleed editorial feature section for the home feed.
 *
 * Replaces the old promo "cards": no border, radius, or shadow — a subtle
 * background wash bleeds edge to edge of the feed column (escaping the page
 * gutter via `-mx-4`) and generous vertical space creates a calm "featured
 * moment" that breaks the scrolling rhythm. This is the reusable editorial
 * language for feed modules; new modules (milestones, ceremonies, summaries)
 * should compose this rather than re-rolling their own chrome.
 */
export function EditorialFeature({
  tone,
  eyebrow,
  eyebrowIcon,
  headline,
  artwork,
  supporting,
  cta,
  footerSlot,
}: EditorialFeatureProps) {
  return (
    <section
      // -mx-4 escapes the home <main>'s px-4 gutter so the wash reaches the feed
      // column edges; -my-1.5 absorbs the feed's space-y-3 so the band meets its
      // neighbors edge to edge. Inner content is re-padded with px-8 (not
      // px-4) so the eyebrow/headline/artwork line up with the feed cards' text,
      // which sits at the 16px gutter + the card's own 14px padding = 30px.
      className={cn('-mx-4 -my-1.5 px-8 py-12 md:py-14', TONE_BG[tone])}
    >
      <p
        // The eyebrow uses the same ink register as the home zone headings
        // ("From Friends" / "For you") rather than the tone accent, so editorial
        // moments share one quiet small-caps label treatment. The tonal accent
        // survives on the CTA link below.
        className="flex items-center gap-1.5 text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase"
      >
        {eyebrowIcon ? (
          <span aria-hidden="true" className="inline-flex">
            {eyebrowIcon}
          </span>
        ) : null}
        {eyebrow}
      </p>

      <h2 className="mt-4 max-w-[20ch] font-serif text-[26px] leading-[1.15] font-medium text-[var(--brand-ink)] md:text-[32px]">
        {headline}
      </h2>

      <div className="mt-8">{artwork}</div>

      {supporting ? (
        <p className="mt-6 text-[13px] text-[var(--brand-ink-400)]">{supporting}</p>
      ) : null}

      {footerSlot ? (
        <div className="mt-5">{footerSlot}</div>
      ) : cta ? (
        <Link
          href={cta.href}
          className={cn(
            'mt-5 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 transition hover:opacity-70 active:opacity-90',
            TONE_ACCENT[tone],
          )}
        >
          {cta.label}
        </Link>
      ) : null}
    </section>
  )
}
