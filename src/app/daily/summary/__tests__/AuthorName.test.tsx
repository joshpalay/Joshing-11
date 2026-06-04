import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// B5/D9: summary-page author attribution. Human authors link to their profile;
// house/editorial authors (no users.id) stay plain text. Everyone with an
// authorId gets the link (no friend/stranger gating — per product decision).
import { AuthorName } from '@/app/daily/summary/page'

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node)
}

describe('summary AuthorName attribution', () => {
  it('links a human author to their profile page', () => {
    const out = html(<AuthorName name="Robyn" authorId="user_robyn" />)
    expect(out).toContain('href="/users/user_robyn"')
    expect(out).toContain('Robyn')
  })

  it('renders plain text (no link) when there is no authorId (house/editorial)', () => {
    const out = html(<AuthorName name="Joshing" authorId={null} />)
    expect(out).not.toContain('<a')
    expect(out).toContain('Joshing')
  })

  it('encodes the author id into the profile href', () => {
    const out = html(<AuthorName name="A B" authorId="weird id/with?chars" />)
    expect(out).toContain('href="/users/weird%20id%2Fwith%3Fchars"')
  })
})
