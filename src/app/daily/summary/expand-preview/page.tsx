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
    { label: 'The Legend of Zelda series', broadCategory: 'Pop Culture', kind: 'broader' },
    { label: 'Breath of the Wild', broadCategory: 'Pop Culture', kind: 'wider' },
    { label: 'Ocarina of Time', broadCategory: 'Pop Culture', kind: 'wider' },
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
        This is the &ldquo;branch out?&rdquo; card on the daily-Five summary, shown when a player
        out-paces a domain&rsquo;s content (supply-ceiling) or runs a small declared area dry
        (thinness). It offers both <strong>broader</strong> parents and <strong>wider</strong>
        siblings. Sample data; nothing here changes your account.
      </p>

      <ExpandDomainOfferCard offer={SAMPLE_OFFER} preview />
    </main>
  )
}
