import type * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import AcceptedRequestsCard, {
  acceptedRequestsBody,
  acceptedRequestsHeadline,
  acceptedRequestsLink,
} from '@/components/home/AcceptedRequestsCard'

describe('AcceptedRequestsCard copy', () => {
  it('names one, two, or "N others"', () => {
    expect(acceptedRequestsHeadline(['Chiann'])).toBe('Chiann said yes!')
    expect(acceptedRequestsHeadline(['Chiann', 'Tre'])).toBe('Chiann and Tre said yes!')
    expect(acceptedRequestsHeadline(['Chiann', 'Tre', 'Bo'])).toBe('Chiann and 2 others said yes!')
    expect(acceptedRequestsBody(1)).toBe('You two are friends now.')
    expect(acceptedRequestsBody(3)).toBe("You're all friends now.")
  })

  it('links one accepter to their profile, several to the Friends page', () => {
    expect(acceptedRequestsLink([{ userId: 'u1', name: 'Chiann' }])).toEqual({
      href: '/users/u1',
      label: "See Chiann's profile",
    })
    expect(
      acceptedRequestsLink([
        { userId: 'u1', name: 'Chiann' },
        { userId: 'u2', name: 'Tre' },
      ]),
    ).toEqual({ href: '/friends', label: 'See your friends' })
  })
})

describe('AcceptedRequestsCard render', () => {
  it('renders the headline, profile link, and Got it', () => {
    const html = renderToStaticMarkup(
      <AcceptedRequestsCard notice={{ activityIds: ['a'], friends: [{ userId: 'u1', name: 'Chiann' }] }} />,
    )
    expect(html).toContain('Chiann said yes!')
    expect(html).toContain('href="/users/u1"')
    expect(html).toContain('Got it')
  })

  it('renders nothing with no accepters', () => {
    expect(renderToStaticMarkup(<AcceptedRequestsCard notice={{ activityIds: [], friends: [] }} />)).toBe('')
  })
})
