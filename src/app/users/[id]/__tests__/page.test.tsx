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
  getEditableProfileMock,
  getDiscoverabilityMock,
  getReminderStateMock,
  getOrCreateInviteTokenMock,
  getFriendsMock,
  resolvePreviewAsMock,
} = vi.hoisted(() => ({
  getFriendPortraitDataMock: vi.fn(),
  getSessionMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  getUserMasteryOverviewMock: vi.fn(),
  getKnowledgePageDataMock: vi.fn(),
  getAuthoredQuestionsForUserMock: vi.fn(),
  getEditableProfileMock: vi.fn(),
  getDiscoverabilityMock: vi.fn(),
  getReminderStateMock: vi.fn(),
  getOrCreateInviteTokenMock: vi.fn(),
  getFriendsMock: vi.fn(async () => []),
  resolvePreviewAsMock: vi.fn(async () => null),
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

vi.mock('@/server/db/queries/account', () => ({
  getEditableProfile: getEditableProfileMock,
  getDiscoverability: getDiscoverabilityMock,
  getReminderState: getReminderStateMock,
  HANDLE_CHANGE_COOLDOWN_DAYS: 30,
}))

vi.mock('@/server/db/queries/friends', () => ({
  getFriends: getFriendsMock,
}))

vi.mock('@/server/profile/preview', () => ({
  resolvePreviewAs: resolvePreviewAsMock,
}))

vi.mock('@/server/friends/user-invite-token', () => ({
  getOrCreateInviteToken: getOrCreateInviteTokenMock,
  buildInviteUrl: (baseUrl: string, handle: string, token: string) =>
    `${baseUrl}/u/${handle}/${token}`,
  getBaseUrl: () => 'https://example.com',
}))

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
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
    getEditableProfileMock.mockResolvedValue(null)
    getDiscoverabilityMock.mockResolvedValue(null)
    getReminderStateMock.mockResolvedValue(null)
    getOrCreateInviteTokenMock.mockResolvedValue(null)
    getFriendPortraitDataMock.mockResolvedValue({
      user: {
        id: 'friend-1',
        displayName: 'Frances Friend',
        handle: null,
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
      isOwnerView: false,
      sectionSettings: null,
      sectionVisibleTo: {
        knowledge_base: true,
        friends_list: true,
        authored_questions: true,
      },
      previewedAs: null,
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
      searchParams: Promise.resolve({}),
    })
    const html = renderToStaticMarkup(element)

    expect(getFriendPortraitDataMock).toHaveBeenCalledWith(
      'friend-1',
      'viewer-1',
      null,
    )
    expect(getAuthoredQuestionsForUserMock).toHaveBeenCalledWith({
      userId: 'friend-1',
      limit: 25,
      viewerUserId: 'viewer-1',
      viewer: 'friend',
      sectionVisible: true,
    })
    expect(html).toContain('Frances Friend')
    expect(html).toContain('shared-interests-overlap')
    expect(html).toContain('Jazz piano')
    expect(html).toContain('Bauhaus design')
    expect(html).toContain('href="/friends"')
  })

  it('renders the knowledge base section with a link to the full overview', async () => {
    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'friend-1' }),
      searchParams: Promise.resolve({}),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain('Knowledge base')
    expect(html).toContain('href="/users/friend-1/knowledge"')
    expect(html).toContain('full knowledge base')
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
      searchParams: Promise.resolve({}),
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
      UserProfilePage({
        params: Promise.resolve({ id: 'friend-1' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    getSessionMock.mockResolvedValueOnce({ userId: 'viewer-1' })
    getFriendPortraitDataMock.mockResolvedValueOnce(null)
    await expect(
      UserProfilePage({
        params: Promise.resolve({ id: 'stranger-1' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('forwards previewAs through resolvePreviewAs into the portrait fetch', async () => {
    resolvePreviewAsMock.mockResolvedValueOnce('stranger')
    // Once preview is on, the portrait re-renders as that simulated viewer.
    getFriendPortraitDataMock.mockResolvedValueOnce({
      user: {
        id: 'self-1',
        displayName: 'Owner',
        handle: 'owner',
        memberSince: new Date('2026-01-01T00:00:00.000Z'),
      },
      visibility: 'stranger',
      friendship: null,
      interests: [],
      sharedInterests: [],
      viewerSoloInterests: [],
      friendSoloInterests: [],
      mutualFriends: [],
      mutualFriendsOverflow: 0,
      isOwnerView: true,
      sectionSettings: {
        knowledge_base: 'public',
        friends_list: 'friends',
        authored_questions: 'public',
      },
      sectionVisibleTo: {
        knowledge_base: true,
        friends_list: false,
        authored_questions: true,
      },
      previewedAs: 'stranger',
    })
    getSessionMock.mockResolvedValueOnce({ userId: 'self-1' })

    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'self-1' }),
      searchParams: Promise.resolve({ previewAs: 'stranger' }),
    })
    const html = renderToStaticMarkup(element)

    expect(resolvePreviewAsMock).toHaveBeenCalledWith(
      'stranger',
      'self-1',
      'self-1',
    )
    expect(getFriendPortraitDataMock).toHaveBeenCalledWith(
      'self-1',
      'self-1',
      'stranger',
    )
    // Banner + exit link appear at the top. The 'stranger' preview value
    // surfaces in the UI as 'public'.
    expect(html).toContain('Previewing your profile as public.')
    expect(html).toContain('href="/users/self-1"')
    // Stranger short-circuit fires because visibility is 'stranger' — the
    // page renders the stranger card, gated on the simulated viewer.
    expect(html).toContain('Become friends to see')
    // Owner is previewing as a stranger of themselves — the friend
    // button must NOT render (you can't befriend yourself).
    expect(html).not.toContain('Add friend')
  })

  it('renders the owner self-view with consolidated settings sections', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'self-1' })
    getEditableProfileMock.mockResolvedValueOnce({
      id: 'self-1',
      displayName: 'Owner',
      handle: 'owner',
      handleLastChangedAt: null,
      phoneNumber: '+15555550100',
    })
    getDiscoverabilityMock.mockResolvedValueOnce({
      discoverableByContacts: false,
      discoverableByMutualFriends: true,
    })
    getReminderStateMock.mockResolvedValueOnce({
      phoneNumber: '+15555550100',
      smsOptIn: 'not_asked',
      emailOptIn: 'not_asked',
      email: null,
      pendingEmail: null,
      emailVerified: false,
    })
    getOrCreateInviteTokenMock.mockResolvedValueOnce({
      handle: 'owner',
      token: 'invite-token-abc',
    })
    getFriendPortraitDataMock.mockResolvedValueOnce({
      user: {
        id: 'self-1',
        displayName: 'Owner',
        handle: 'owner',
        memberSince: new Date('2026-01-01T00:00:00.000Z'),
      },
      visibility: 'self',
      friendship: null,
      interests: [],
      sharedInterests: [],
      viewerSoloInterests: [],
      friendSoloInterests: [],
      mutualFriends: [],
      mutualFriendsOverflow: 0,
      isOwnerView: true,
      sectionSettings: {
        knowledge_base: 'public',
        friends_list: 'friends',
        authored_questions: 'public',
      },
      sectionVisibleTo: {
        knowledge_base: true,
        friends_list: true,
        authored_questions: true,
      },
      previewedAs: null,
    })

    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'self-1' }),
      searchParams: Promise.resolve({}),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain('Privacy &amp; discovery')
    expect(html).toContain('Notifications')
    expect(html).toContain('Developer tools')
    expect(html).toContain('Log out')
    expect(html).toContain('Delete account')
    expect(html).toContain('id="privacy-discovery"')
    expect(html).toContain('id="notifications"')
    expect(html).toContain('Your invite link')
    expect(html).not.toContain('href="/account"')
    expect(html).not.toContain('href="/account/')
  })

  it('ignores invalid previewAs (resolved to null) and renders normally', async () => {
    resolvePreviewAsMock.mockResolvedValueOnce(null)

    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'friend-1' }),
      searchParams: Promise.resolve({ previewAs: 'nope' }),
    })
    const html = renderToStaticMarkup(element)

    expect(getFriendPortraitDataMock).toHaveBeenCalledWith(
      'friend-1',
      'viewer-1',
      null,
    )
    expect(html).not.toContain('Previewing your profile')
  })
})
