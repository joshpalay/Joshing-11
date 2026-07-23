'use client'

import Link from 'next/link'

// D-4 via-attribution: the per-card "by {author}" / "via {source}" stranger-
// discovery affordance. Each names a stranger worth meeting off this card — the
// human who wrote the question (author) and/or the relay source it reached you
// through (via) — and links to their profile, where you can add them. Server-
// gated (stranger-only, opt-in, public questions); the client just renders
// whatever survived. Author leads; via second. The server collapses the two to
// one when they're the same person, so this never shows "by X · via X".

export type DiscoveryPerson = {
  userId: string
  displayName: string
  href: string
}

function DiscoveryLine({ label, person }: { label: string; person: DiscoveryPerson }) {
  return (
    <p className="type-metadata leading-snug text-[var(--brand-ink-700)]">
      <span className="opacity-70">{label} </span>
      <Link
        href={person.href}
        className="font-semibold text-[var(--brand-ink)] underline decoration-[var(--brand-rule)] underline-offset-2 hover:decoration-[var(--brand-ink)]"
      >
        {person.displayName}
      </Link>
      <span className="opacity-50"> · </span>
      <Link href={person.href} className="font-medium text-[var(--brand-link)] hover:underline">
        Add friend
      </Link>
    </p>
  )
}

export function DiscoveryAttribution({
  author,
  via,
}: {
  author?: DiscoveryPerson | null
  via?: DiscoveryPerson | null
}) {
  if (!author && !via) return null
  return (
    <div className="mt-1 space-y-0.5">
      {author ? <DiscoveryLine label="by" person={author} /> : null}
      {via ? <DiscoveryLine label="via" person={via} /> : null}
    </div>
  )
}
