import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getFriendPortraitDataMock,
  getSessionMock,
  notFoundMock,
  getUserMasteryOverviewMock,
  getKnowledgePageDataMock,
  getAuthoredQuestionsForUserMock,
} = vi.hoisted(() => ({
  getFriendPortraitDataMock: vi.fn(),
  getSessionMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  getUserMasteryOverviewMock: vi.fn(),
  getKnowledgePageDataMock: vi.fn(),
  getAuthoredQuestionsForUserMock: vi.fn(),
}))

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

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/profile/friend', () => ({
  getFriendPortraitData: getFriendPortraitDataMock,
}))

vi.mock('@/server/db/queries/knowledge', () => ({
  getUserMasteryOverview: getUserMasteryOverviewMock,
  getKnowledgePageData: getKnowledgePageDataMock,
}))

vi.mock('@/server/db/queries/questions', () => ({
  getAuthoredQuestionsForUser: getAuthoredQuestionsForUserMock,
}))

vi.mock('@/components/knowledge/KnowledgeCard', () => ({
  KnowledgeCard: ({ playerDisplayName }: { playerDisplayName: string }) => (
    <div data-testid="knowledge-card">{playerDisplayName}</div>
  ),
}))

vi.mock('@/components/knowledge/PortraitCircles', () => ({
  PortraitCircles: () => <div data-testid="portrait-circles" />,
}))

import UserProfilePage from '@/app/users/[id]/page'

describe('/users/[id] friend profile page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'viewer-1' })
    getFriendPortraitDataMock.mockResolvedValue({
      user: {
        id: 'friend-1',
        displayName: 'Frances Friend',
        memberSince: new Date('2026-01-01T00:00:00.000Z'),
      },
      visibility: 'friend',
      friendship: {
        id: 'friendship-1',
        formedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      interests: [
        { domain: 'Jazz piano', broadCategory: 'Music', shared: true },
        { domain: 'Roman roads', broadCategory: 'History', shared: false },
      ],
      sharedInterests: ['Jazz piano'],
    })
    getUserMasteryOverviewMock.mockResolvedValue({
      totalPoints: 0,
      currentTier: 'establishing',
      tierProgress: 0,
      nextTier: null,
      pointsToNextTier: null,
      domains: [],
      recentActivity: [],
    })
    getKnowledgePageDataMock.mockResolvedValue({
      allDomains: [],
      declaredInterests: [],
      expandingDomains: [],
    })
    getAuthoredQuestionsForUserMock.mockResolvedValue([])
  })

  it('renders the active friend portrait shell', async () => {
    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'friend-1' }),
    })
    const html = renderToStaticMarkup(element)

    expect(getFriendPortraitDataMock).toHaveBeenCalledWith(
      'friend-1',
      'viewer-1'
    )
    expect(html).toContain('Friend profile')
    expect(html).toContain('Frances Friend')
    expect(html).toContain('Jazz piano')
    expect(html).toContain('shared')
    expect(html).toContain('href="/friends"')
  })

  it('renders empty-state knowledge map and authored-questions sections', async () => {
    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'friend-1' }),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain('Knowledge map')
    expect(html).toContain('Their map will fill in')
    expect(html).toContain('Questions Frances wrote')
    expect(html).toContain('hasn')
  })

  it('renders authored questions when present', async () => {
    getAuthoredQuestionsForUserMock.mockResolvedValueOnce([
      {
        id: 'q1',
        questionText: 'What year did the Hungarian uprising begin?',
        canonicalSubcategory: 'Cold War history',
        broadCategory: 'History',
        createdAt: '2026-05-10T00:00:00.000Z',
      },
    ])

    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'friend-1' }),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain('What year did the Hungarian uprising begin?')
    expect(html).toContain('Cold War history')
  })

  it('handles unauthenticated and unavailable profiles with notFound', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    await expect(
      UserProfilePage({ params: Promise.resolve({ id: 'friend-1' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND')

    getSessionMock.mockResolvedValueOnce({ userId: 'viewer-1' })
    getFriendPortraitDataMock.mockResolvedValueOnce(null)
    await expect(
      UserProfilePage({ params: Promise.resolve({ id: 'stranger-1' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
