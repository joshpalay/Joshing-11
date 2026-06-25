'use client'

import Link from 'next/link'

import type { ExpansionOffer } from '@/server/db/queries/daily-summary'
import { ExpandDomainOfferCard } from '../ExpandDomainOfferCard'

// Static sample so the post-daily-Five expansion offer can be reviewed from the
// profile without having to actually top a domain's difficulty ladder. The card
// is rendered in `preview` mode — accepting or dismissing here mutates nothing.
const SAMPLE_OFFER: ExpansionOffer = {
  sourceDomain: 'Tears of the Kingdom - the Legend of Zelda',
  sourceDisplayName: 'Tears of the Kingdom',
  candidates: [
    { label: 'Breath of the Wild', broadCategory: 'Video Games' },
    { label: 'Ocarina of Time', broadCategory: 'Video Games' },
    { label: "Majora's Mask", broadCategory: 'Video Games' },
    { label: 'The Wind Waker', broadCategory: 'Video Games' },
  ],
}

export default function ExpandOfferPreviewPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-28">
      <div className="mb-5">
        <Link
          href="/users/me"
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
        >
          ← Profile
        </Link>
      </div>

      <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">
        Expansion offer preview
      </h1>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        This is the &ldquo;you&rsquo;re crushing X — branch out?&rdquo; card that appears on the
        daily-Five summary when a player out-paces a domain&rsquo;s content. Sample data; nothing
        here changes your account.
      </p>

      <ExpandDomainOfferCard offer={SAMPLE_OFFER} preview />
    </main>
  )
}
