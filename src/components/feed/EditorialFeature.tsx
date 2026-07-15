import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// The feed "featured moment" treatments. Each maps to a subtle full-bleed
// background wash (--editorial-* in globals.css) plus a CTA accent color
// borrowed from the brand palette. Add a tone here (and the matching CSS var +
// accent) when a new editorial module joins the feed.
//
// The three `interlude-*` tones are the home editorial interludes
// (B-HOME-INTERLUDE-TYPE-01): a solid sage ground (Overlap, navy ink on top), a
// solid navy ground (Write, cream type inverted), and a deep terracotta ground
// (Find friends, cream type inverted). On these tones the supporting line + CTA
// take the Josefin caps "system voice"; the parchment/sage/slate washes are
// untouched.
export type EditorialTone =
  | 'parchment'
  | 'sage'
  | 'slate'
  | 'interlude-sage'
  | 'interlude-ink'
  | 'interlude-terracotta'

const TONE_BG: Record<EditorialTone, string> = {
  parchment: 'bg-[var(--editorial-parchment)]',
  sage: 'bg-[var(--editorial-sage)]',
  slate: 'bg-[var(--editorial-slate)]',
  'interlude-sage': 'bg-[var(--interlude-sage)]',
  'interlude-ink': 'bg-[var(--ink)]',
  'interlude-terracotta': 'bg-[var(--interlude-terracotta)]',
}

const TONE_ACCENT: Record<EditorialTone, string> = {
  parchment: 'text-[var(--brand-orange)]',
  sage: 'text-[var(--success)]',
  slate: 'text-[var(--brand-link)]',
  // Navy ink reads on the light sage ground; cream reads on the dark navy and
  // terracotta grounds.
  'interlude-sage': 'text-[var(--ink)]',
  'interlude-ink': 'text-[var(--cream)]',
  'interlude-terracotta': 'text-[var(--cream)]',
}

const INTERLUDE_TONES = new Set<EditorialTone>([
  'interlude-sage',
  'interlude-ink',
  'interlude-terracotta',
])
const DARK_TONES = new Set<EditorialTone>(['interlude-ink', 'interlude-terracotta'])

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
  // For a band that closes the page (the feed-tail "Write a Question" interlude):
  // run the wash all the way to the bottom of the scroll instead of stopping
  // short and leaving an orphaned strip of page cream between the band and the
  // fixed bottom nav. The band's bottom padding then both fills that gap and
  // keeps its own content clear of the nav. See FeedContributeFooter.
  bleedBottom?: boolean
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
  bleedBottom = false,
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
      // The home interludes carry a slightly condensed vertical rhythm (still
      // spacious, one notch tighter) than the parchment/sage/slate feed washes.
      className={cn(
        // Top bleed/padding is unchanged across every tone. The bottom is split
        // out so a closing band (bleedBottom) can run the wash past the page's
        // bottom padding instead of ending in an orphaned cream strip.
        '-mx-4 -mt-1.5 px-8',
        isInterlude ? 'pt-10 md:pt-12' : 'pt-12 md:pt-14',
        bleedBottom
          ? // Fill the home <main>'s pb-32 with the wash (-mb-32 cancels that
            // page padding; pb-32 paints the band over it) so the band closes the
            // scroll. The deep bottom padding also keeps the content clear of the
            // fixed bottom nav that floats over the band's tail.
            'pb-32 -mb-32'
          : cn('-mb-1.5', isInterlude ? 'pb-10 md:pb-12' : 'pb-12 md:pb-14'),
        TONE_BG[tone],
      )}
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

      <div className={isInterlude ? 'mt-7' : 'mt-8'}>{artwork}</div>

      {supporting ? (
        <p
          className={cn(
            isInterlude ? 'mt-5 text-quiet' : 'mt-6 text-quiet',
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
            'inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 transition hover:opacity-70 active:opacity-90',
            isInterlude ? 'mt-4' : 'mt-5',
            // Interlude CTAs carry the same Josefin caps system voice.
            isInterlude && 'font-sans text-quiet tracking-[0.12em] uppercase',
            TONE_ACCENT[tone],
          )}
        >
          {cta.label}
        </Link>
      ) : null}
    </section>
  )
}
