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
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
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

vi.mock('@/components/profile/SharedInterestsOverlap', () => ({
  SharedInterestsOverlap: ({
    sharedInterests,
    friendSoloInterests,
    viewerSoloInterests,
    friendFirstName,
  }: {
    sharedInterests: string[]
    friendSoloInterests: string[]
    viewerSoloInterests: string[]
    friendFirstName: string
  }) => (
    <div data-testid="shared-interests-overlap">
      <span data-testid="shared">{sharedInterests.join(',')}</span>
      <span data-testid="friend-solo">{friendSoloInterests.join(',')}</span>
      <span data-testid="viewer-solo">{viewerSoloInterests.join(',')}</span>
      <span data-testid="friend-first-name">{friendFirstName}</span>
    </div>
  ),
}))

vi.mock('@/components/profile/AuthoredQuestionsFeed', () => ({
  AuthoredQuestionsFeed: ({
    questions,
    friendDisplayName,
  }: {
    questions: Array<{
      id: string
      questionText: string
      category: string | null
      viewerAnswered: { result: 'correct' | 'incorrect' } | null
    }>
    friendDisplayName: string
  }) => (
    <div data-testid="authored-feed">
      <span data-testid="friend-name">{friendDisplayName}</span>
      {questions.length === 0 ? (
        <span data-testid="authored-empty">
          {friendDisplayName} has not written any questions yet.
        </span>
      ) : null}
      {questions.map((q) => (
        <div key={q.id} data-testid={`q-${q.id}`}>
          <span data-testid={`q-text-${q.id}`}>{q.questionText}</span>
          <span data-testid={`q-state-${q.id}`}>
            {q.viewerAnswered ? `answered:${q.viewerAnswered.result}` : 'unanswered'}
          </span>
        </div>
      ))}
    </div>
  ),
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
        handle: null,
        tagline: null,
        location: null,
        bio: null,
        authorProfilePublic: true,
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
      viewerSoloInterests: ['Bauhaus design'],
      friendSoloInterests: ['Roman roads'],
      mutualFriends: [],
      mutualFriendsOverflow: 0,
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

  it('renders the friend profile shell and shared-interests overlap', async () => {
    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'friend-1' }),
    })
    const html = renderToStaticMarkup(element)

    expect(getFriendPortraitDataMock).toHaveBeenCalledWith(
      'friend-1',
      'viewer-1',
    )
    expect(getAuthoredQuestionsForUserMock).toHaveBeenCalledWith({
      userId: 'friend-1',
      limit: 25,
      viewerUserId: 'viewer-1',
    })
    expect(html).toContain('Friend profile')
    expect(html).toContain('Frances Friend')
    expect(html).toContain('shared-interests-overlap')
    expect(html).toContain('Jazz piano')
    expect(html).toContain('Bauhaus design')
    expect(html).toContain('href="/friends"')
  })

  it('renders the trimmed knowledge map with a link to the full overview', async () => {
    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'friend-1' }),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain('Knowledge map')
    expect(html).toContain('href="/users/friend-1/knowledge"')
    expect(html).toContain('full knowledge map')
    // Boxed KnowledgeCard / PortraitCircles previews removed from this page.
    expect(html).not.toContain('data-testid="knowledge-card"')
    expect(html).not.toContain('data-testid="portrait-circles"')
  })

  it('passes authored questions with viewer-answer status to the feed component', async () => {
    getAuthoredQuestionsForUserMock.mockResolvedValueOnce([
      {
        id: 'q1',
        questionText: 'What year did the Hungarian uprising begin?',
        canonicalSubcategory: 'Cold War history',
        broadCategory: 'History',
        createdAt: '2026-05-10T00:00:00.000Z',
        viewerAnswered: null,
      },
      {
        id: 'q2',
        questionText: 'Who painted Composition VIII?',
        canonicalSubcategory: 'Modern art',
        broadCategory: 'Art',
        createdAt: '2026-05-09T00:00:00.000Z',
        viewerAnswered: { result: 'correct' },
      },
    ])

    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'friend-1' }),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain('What year did the Hungarian uprising begin?')
    expect(html).toContain('Who painted Composition VIII?')
    expect(html).toContain('unanswered')
    expect(html).toContain('answered:correct')
  })

  it('handles unauthenticated and unavailable profiles with notFound', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    await expect(
      UserProfilePage({ params: Promise.resolve({ id: 'friend-1' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    getSessionMock.mockResolvedValueOnce({ userId: 'viewer-1' })
    getFriendPortraitDataMock.mockResolvedValueOnce(null)
    await expect(
      UserProfilePage({ params: Promise.resolve({ id: 'stranger-1' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
