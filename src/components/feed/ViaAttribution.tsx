'use client'

import { useState } from 'react'
import Link from 'next/link'

// B-VIA-ATTRIBUTION-01: the "Via [friend]" answerer line that sits above a
// card's Answer action. Names friends (people the viewer follows) who answered
// this question correctly, recency-ordered (lead = most recent). The copy is
// neutral on relevance: the lead is recency-selected, so there is no "most
// relevant"/"closest" superlative.
//
// Never hides names behind a bare count: where more than one friend answered,
// the count only LABELS the expand affordance; opening it reveals the complete
// recency-ordered list. (Honors the "no 'and N others'" decision.)

export type ViaAnswerer = {
  userId: string
  displayName: string
  href: string
  answeredAt: string
}

function PersonLink({ answerer }: { answerer: ViaAnswerer }) {
  if (!answerer.href) return <>{answerer.displayName}</>
  return (
    <Link
      href={answerer.href}
      className="font-semibold text-[var(--brand-ink)] underline decoration-[var(--brand-rule)] underline-offset-2 hover:decoration-[var(--brand-ink)]"
    >
      {answerer.displayName}
    </Link>
  )
}

export function ViaAttribution({ answerers }: { answerers: ViaAnswerer[] }) {
  const [expanded, setExpanded] = useState(false)

  if (!answerers || answerers.length === 0) return null

  const lead = answerers[0]
  const hasMore = answerers.length > 1

  return (
    <p className="text-quiet leading-snug text-[var(--brand-ink-700)]">
      <span className="opacity-70">Via </span>
      {expanded ? (
        // Full recency-ordered set, names never hidden.
        answerers.map((answerer, index) => (
          <span key={answerer.userId}>
            {index > 0 ? <span className="opacity-70">, </span> : null}
            <PersonLink answerer={answerer} />
          </span>
        ))
      ) : (
        <PersonLink answerer={lead} />
      )}
      {hasMore ? (
        <>
          <span className="opacity-70"> · </span>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            className="font-medium text-[var(--brand-ink-700)] underline decoration-[var(--brand-rule)] underline-offset-2 hover:decoration-[var(--brand-ink)]"
          >
            {expanded ? 'Show less' : `${answerers.length} friends answered`}
          </button>
        </>
      ) : null}
    </p>
  )
}
