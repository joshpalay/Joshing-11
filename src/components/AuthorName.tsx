import Link from 'next/link'
import type { CSSProperties } from 'react'

// B5/D9: on recap surfaces (the daily-five summary and the catch-up recap, unlike
// the gameplay chat which stays plain text) author names link to the author's
// profile. Only human authors carry an authorId; house/editorial and LLM-origin
// names render as plain text.
export function AuthorName({
  name,
  authorId,
  weight,
  style,
}: {
  name: string
  authorId: string | null
  weight?: number
  style?: CSSProperties
}) {
  if (!authorId) {
    return <span style={{ fontWeight: weight, ...style }}>{name}</span>
  }
  return (
    <Link
      href={`/users/${encodeURIComponent(authorId)}`}
      style={{
        fontWeight: weight,
        color: 'var(--brand-link)',
        textDecoration: 'underline',
        textUnderlineOffset: 2,
        ...style,
      }}
    >
      {name}
    </Link>
  )
}
