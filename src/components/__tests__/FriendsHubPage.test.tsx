import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : String(href)} {...props}>
      {children}
    </a>
  ),
}))

import FriendsHubPage from '@/components/FriendsHubPage'
import FriendsList from '@/components/FriendsList'

const forbiddenGamificationCopy =
  /leaderboard|ranking|ranked|score|points?|percent|%|timer|streak|hurry|urgent/i

describe('Friends page QA surface', () => {
  it('keeps the Add Friend CTA visible and avoids leaderboard/ranking mechanics', () => {
    const html = renderToStaticMarkup(<FriendsHubPage />)

    expect(html).toContain('Friends')
    expect(html).toContain('Add friend')
    expect(html).toContain('Bring a friend into Joshing.')
    expect(html).not.toMatch(forbiddenGamificationCopy)
  })

  it('renders request, invite, active friend, and empty-state sections from the initial loading shell', () => {
    const html = renderToStaticMarkup(<FriendsList />)

    expect(html).toContain('Incoming friend requests')
    expect(html).toContain('Loading requests')
    expect(html).toContain('People you invited')
    expect(html).toContain('Loading invites')
    expect(html).toContain('Active friends')
    expect(html).toContain('Loading friends')
    expect(html).not.toMatch(forbiddenGamificationCopy)
  })
})
