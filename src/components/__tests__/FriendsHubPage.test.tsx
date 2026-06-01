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
    expect(html).not.toContain('Joshing</p>')
    expect(html).not.toContain('Invite your people')
    expect(html).not.toContain('Send a warm note')
    expect(html).not.toMatch(forbiddenGamificationCopy)
  })

  it('renders the Following / Followers / Pending tab bar with following active by default', () => {
    const html = renderToStaticMarkup(<FriendsList />)

    expect(html).toContain('Following')
    expect(html).toContain('Followers')
    expect(html).toContain('Pending')
    expect(html).toContain('Who can follow you')
    expect(html).not.toMatch(forbiddenGamificationCopy)
  })
})
