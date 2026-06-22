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
  getCommonGroundMock,
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
  getCommonGroundMock: vi.fn(),
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

vi.mock('@/server/db/queries/common-ground', () => ({
  getCommonGround: getCommonGroundMock,
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

vi.mock('@/components/profile/CommonGround', () => ({
  CommonGround: ({
    data,
    friendFirstName,
  }: {
    data: {
      proven: Array<{ canonical_subcategory: string }>
      latent: Array<{ canonical_subcategory: string }>
      isEmpty: boolean
    } | null
    friendFirstName: string
  }) =>
    data ? (
      <div data-testid="common-ground">
        <span data-testid="cg-proven">
          {data.proven.map((d) => d.canonical_subcategory).join(',')}
        </span>
        <span data-testid="cg-latent">
          {data.latent.map((d) => d.canonical_subcategory).join(',')}
        </span>
        <span data-testid="cg-empty">{String(data.isEmpty)}</span>
        <span data-testid="cg-friend">{friendFirstName}</span>
      </div>
    ) : null,
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
    getCommonGroundMock.mockResolvedValue({
      proven: [
        {
          canonical_subcategory: 'Virginia Woolf',
          broad_category: 'Literature',
          viewer: { mastery_points: 12, current_tier: 'solid', proven: true },
          friend: { mastery_points: 6, current_tier: 'familiar', proven: true },
          kind: 'proven',
        },
      ],
      latent: [],
      isEmpty: false,
    })
  })

  it('renders the friend profile shell and the common ground section', async () => {
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
    // The dashboard fetches one past the preview cap (5) so the feed can
    // decide whether to surface the "view all" link without a count query.
    expect(getAuthoredQuestionsForUserMock).toHaveBeenCalledWith({
      userId: 'friend-1',
      limit: 6,
      viewerUserId: 'viewer-1',
      viewer: 'friend',
      sectionVisible: true,
    })
    expect(html).toContain('Frances Friend')
    expect(html).toContain('href="/friends"')

    // The mastery-based common ground block renders from getCommonGround,
    // which is called with (viewerId, profileUserId). The declared-interest
    // Venn has been removed, so it is the only overlap surface now.
    expect(getCommonGroundMock).toHaveBeenCalledWith('viewer-1', 'friend-1')
    expect(html).toContain('common-ground')
    expect(html).toContain('Virginia Woolf')
    expect(html).not.toContain('shared-interests-overlap')
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
    // Developer tools are temporarily ungated (DEV_TOOLS_UNGATED in
    // AccountActions): every owner viewing their own profile sees them,
    // regardless of ADMIN_USER_IDS. Flip back to expecting absence when the
    // admin gate is restored.
    expect(html).toContain('Developer tools')
    expect(html).toContain('Log out')
    expect(html).toContain('Delete account')
    expect(html).toContain('id="privacy-discovery"')
    expect(html).toContain('id="notifications"')
    expect(html).toContain('Your invite link')
    expect(html).not.toContain('href="/account"')
    expect(html).not.toContain('href="/account/')
  })

  it('shows Developer tools to an admin owner (ADMIN_USER_IDS)', async () => {
    const prevAdmins = process.env.ADMIN_USER_IDS
    process.env.ADMIN_USER_IDS = 'self-1'
    try {
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

      expect(html).toContain('Developer tools')
    } finally {
      if (prevAdmins === undefined) delete process.env.ADMIN_USER_IDS
      else process.env.ADMIN_USER_IDS = prevAdmins
    }
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

  it('no longer renders the Recently exploring section', async () => {
    const element = await UserProfilePage({
      params: Promise.resolve({ id: 'friend-1' }),
      searchParams: Promise.resolve({}),
    })
    const html = renderToStaticMarkup(element)

    expect(html).not.toContain('Recently exploring')
  })

  describe('Friends module', () => {
    it("shows the viewed user's friends with a view-all link when over the cap", async () => {
      getFriendsMock.mockResolvedValueOnce([
        { id: 'f1', displayName: 'Ada Lovelace' },
        { id: 'f2', displayName: 'Grace Hopper' },
        { id: 'f3', displayName: 'Katherine Johnson' },
        { id: 'f4', displayName: 'Mary Jackson' },
        { id: 'f5', displayName: 'Dorothy Vaughan' },
        { id: 'f6', displayName: 'Annie Easley' },
      ])

      const element = await UserProfilePage({
        params: Promise.resolve({ id: 'friend-1' }),
        searchParams: Promise.resolve({}),
      })
      const html = renderToStaticMarkup(element)

      // Friends module fetches the viewed user's own friends.
      expect(getFriendsMock).toHaveBeenCalledWith('friend-1')
      expect(html).toContain('Ada Lovelace')
      // Capped at 5, so the 6th name is not shown in the preview.
      expect(html).not.toContain('Annie Easley')
      // View-all link points at the full friends page.
      expect(html).toContain('href="/users/friend-1/friends"')
      expect(html).toContain('View all 6 friends')
    })

    it('hides the Friends module when friends_list visibility is off', async () => {
      getFriendPortraitDataMock.mockResolvedValueOnce({
        user: {
          id: 'friend-1',
          displayName: 'Frances Friend',
          handle: null,
          memberSince: new Date('2026-01-01T00:00:00.000Z'),
        },
        visibility: 'friend',
        relationship: null,
        interests: [],
        sharedInterests: [],
        viewerSoloInterests: [],
        friendSoloInterests: [],
        mutualFriends: [],
        mutualFriendsOverflow: 0,
        isOwnerView: false,
        sectionSettings: null,
        sectionVisibleTo: {
          knowledge_base: true,
          friends_list: false,
          authored_questions: true,
        },
        previewedAs: null,
      })
      getFriendsMock.mockResolvedValueOnce([
        { id: 'f1', displayName: 'Ada Lovelace' },
      ])

      const element = await UserProfilePage({
        params: Promise.resolve({ id: 'friend-1' }),
        searchParams: Promise.resolve({}),
      })
      const html = renderToStaticMarkup(element)

      expect(html).not.toContain('href="/users/friend-1/friends"')
      // Common ground stays visible even though friends_list is off.
      expect(html).toContain('common-ground')
    })
  })
})
