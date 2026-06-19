import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// The feed "featured moment" treatments. Each maps to a subtle full-bleed
// background wash (--editorial-* in globals.css) plus a CTA accent color
// borrowed from the brand palette. Add a tone here (and the matching CSS var +
// accent) when a new editorial module joins the feed.
//
// The two `interlude-*` tones are the home editorial interludes
// (B-HOME-INTERLUDE-TYPE-01): a solid sage ground (Overlap, navy ink on top) and
// a solid navy ground (Write, cream type inverted). On these two tones the
// supporting line + CTA take the Josefin caps "system voice"; the parchment/
// sage/slate washes are untouched.
export type EditorialTone = 'parchment' | 'sage' | 'slate' | 'interlude-sage' | 'interlude-ink'

const TONE_BG: Record<EditorialTone, string> = {
  parchment: 'bg-[var(--editorial-parchment)]',
  sage: 'bg-[var(--editorial-sage)]',
  slate: 'bg-[var(--editorial-slate)]',
  'interlude-sage': 'bg-[var(--interlude-sage)]',
  'interlude-ink': 'bg-[var(--ink)]',
}

const TONE_ACCENT: Record<EditorialTone, string> = {
  parchment: 'text-[var(--brand-orange)]',
  sage: 'text-[var(--success)]',
  slate: 'text-[var(--brand-link)]',
  // Navy ink reads on the light sage ground; cream reads on the navy ground.
  'interlude-sage': 'text-[var(--ink)]',
  'interlude-ink': 'text-[var(--cream)]',
}

const INTERLUDE_TONES = new Set<EditorialTone>(['interlude-sage', 'interlude-ink'])
const DARK_TONES = new Set<EditorialTone>(['interlude-ink'])

interface EditorialFeatureProps {
  tone: EditorialTone
  // Large editorial headline. A node, so callers can weave an inline link (e.g.
  // the friend's name) into it. The editorial moments lead with the headline —
  // there is deliberately no small-caps eyebrow above it.
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
  headline,
  artwork,
  supporting,
  cta,
  footerSlot,
}: EditorialFeatureProps) {
  const isInterlude = INTERLUDE_TONES.has(tone)
  const isDark = DARK_TONES.has(tone)
  return (
    <section
      // -mx-4 escapes the home <main>'s px-4 gutter so the wash reaches the feed
      // column edges; -my-1.5 absorbs the feed's space-y-3 so the band meets its
      // neighbors edge to edge. Inner content is re-padded with px-8 (not
      // px-4) so the headline/artwork line up with the feed cards' text,
      // which sits at the 16px gutter + the card's own 14px padding = 30px.
      className={cn('-mx-4 -my-1.5 px-8 py-12 md:py-14', TONE_BG[tone])}
    >
      <h2
        className={cn(
          'max-w-[20ch] font-serif text-[26px] leading-[1.15] font-medium md:text-[32px]',
          // Cormorant 500 headline; on the dark interlude ground it inverts to
          // cream, otherwise navy ink.
          isDark ? 'text-[var(--cream)]' : 'text-[var(--brand-ink)]',
        )}
      >
        {headline}
      </h2>

      <div className="mt-8">{artwork}</div>

      {supporting ? (
        <p
          className={cn(
            'mt-6 text-[13px]',
            // On the home interludes the supporting line is "system voice":
            // Josefin caps + letterspacing, inverted to cream on the dark ground.
            isInterlude
              ? cn(
                  'font-sans tracking-[0.12em] uppercase',
                  isDark ? 'text-[var(--cream)]/70' : 'text-[var(--brand-ink-400)]',
                )
              : 'text-[var(--brand-ink-400)]',
          )}
        >
          {supporting}
        </p>
      ) : null}

      {footerSlot ? (
        <div className="mt-5">{footerSlot}</div>
      ) : cta ? (
        <Link
          href={cta.href}
          className={cn(
            'mt-5 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 transition hover:opacity-70 active:opacity-90',
            // Interlude CTAs carry the same Josefin caps system voice.
            isInterlude && 'font-sans text-[13px] tracking-[0.12em] uppercase',
            TONE_ACCENT[tone],
          )}
        >
          {cta.label}
        </Link>
      ) : null}
    </section>
  )
}
