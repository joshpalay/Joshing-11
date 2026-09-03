import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  getUserOnboardingProfileMock,
  getPreSeededInterestsForUserMock,
  hasInviteLinkFriendshipMock,
  getInviterForUserMock,
  getInviteLinkSeedTopicsMock,
  getSeedTopicsForJoinedLinkMock,
  friendInvitationRowsMock,
  getCatalogSuggestionsMock,
  redirectMock,
  onboardingFlowMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getUserOnboardingProfileMock: vi.fn(),
  getPreSeededInterestsForUserMock: vi.fn(),
  hasInviteLinkFriendshipMock: vi.fn(async () => false),
  // Stage 2: resolves null by default so tests whose interests come back
  // empty for reasons OTHER than a link arrival (e.g. an unrelated redirect
  // guard test) don't accidentally exercise the link-fallback branch.
  getInviterForUserMock: vi.fn(async () => null as {
    inviterUserId: string
    inviterName: string | null
    sourceId: string
    sourceType: 'friend_invitation' | 'follow'
  } | null),
  getInviteLinkSeedTopicsMock: vi.fn(async () => [] as Array<{
    label: string
    description?: string | null
    broadCategory?: string | null
  }>),
  // B-FRIENDS-INVITE-LINKS-01: null by default so every existing test keeps
  // exercising the pre-attribution fallback (getInviteLinkSeedTopics against
  // the inviter, ambient/unslotted) unless a test explicitly opts into
  // slot-precise resolution.
  getSeedTopicsForJoinedLinkMock: vi.fn(async () => null as Array<{
    label: string
    description?: string | null
    broadCategory?: string | null
  }> | null),
  // Drives the FriendInvitation grandfather-guard query result.
  friendInvitationRowsMock: vi.fn(
    async () => [{ id: 'inv-1' }] as Array<{ id: string }>,
  ),
  // Empty by default so every pre-existing test is unaffected; the
  // adjacency-suggestions test below overrides it.
  getCatalogSuggestionsMock: vi.fn(async () => [] as Array<{
    domain: string
    broadCategory: string | null
  }>),
  redirectMock: vi.fn((target: string) => {
    // Mirror Next.js: redirect() throws to short-circuit rendering.
    throw new Error(`__REDIRECT__:${target}`)
  }),
  onboardingFlowMock: vi.fn(() => null),
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/db/queries/users', () => ({
  getUserOnboardingProfile: getUserOnboardingProfileMock,
  getPreSeededInterestsForUser: getPreSeededInterestsForUserMock,
  normalizePersonName: (value: string | null | undefined) => {
    const trimmed = value?.trim().replace(/\s+/g, ' ')
    return trimmed ? trimmed.slice(0, 80) : null
  },
}))

// The page runs a grandfather-guard query (select FriendInvitation … limit 1)
// directly against db. Stub the chain so it resolves without a real connection;
// the result is discarded by the page (void hasInvitation), so [] is fine.
// The page runs a grandfather-guard query (select FriendInvitation … limit 1)
// directly against db. The limit() result is driven by friendInvitationRowsMock
// so individual tests can simulate "no FriendInvitation row" (invite-link path).
vi.mock('@/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => friendInvitationRowsMock(),
        }),
      }),
    }),
  },
  friendInvitations: {
    id: 'friendInvitations.id',
    inviteeUserId: 'friendInvitations.inviteeUserId',
    acceptedAt: 'friendInvitations.acceptedAt',
  },
}))

vi.mock('@/server/friends/user-invite-token', () => ({
  hasInviteLinkFriendship: hasInviteLinkFriendshipMock,
  getInviteLinkSeedTopics: getInviteLinkSeedTopicsMock,
  getSeedTopicsForJoinedLink: getSeedTopicsForJoinedLinkMock,
}))

vi.mock('@/server/db/queries/friend-invitations', () => ({
  getInviterForUser: getInviterForUserMock,
}))

vi.mock('@/server/db/queries/suggestion-catalog', () => ({
  getCatalogSuggestions: getCatalogSuggestionsMock,
}))

// Seeds run through convergeDomain server-side; stub it to a passthrough (no
// exact match) so this test stays off the real DB-backed corpus query.
vi.mock('@/server/knowledge/converge-domain', () => ({
  convergeDomain: vi.fn(async (label: string) => ({ raw: label, candidates: [] })),
}))

// Stub the client component import so this test stays server-side. Captures
// props via onboardingFlowMock so tests can assert on seedSource/topics
// without rendering.
vi.mock('@/app/onboarding/OnboardingFlow', () => ({
  default: onboardingFlowMock,
}))

import OnboardingPage from '@/app/onboarding/page'

async function callPage() {
  try {
    const element = await OnboardingPage()
    // JSX creation doesn't invoke the component function — it just builds a
    // descriptor — so props live on the returned element, not on a call to
    // the mocked OnboardingFlow. Expose them for assertions without a real render.
    return { redirected: false as const, props: (element as { props?: Record<string, unknown> })?.props }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const match = message.match(/^__REDIRECT__:(.+)$/)
    if (match) return { redirected: true as const, target: match[1] }
    throw err
  }
}

describe('OnboardingPage guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockReset()
    getUserOnboardingProfileMock.mockReset()
    getPreSeededInterestsForUserMock.mockReset()
    getPreSeededInterestsForUserMock.mockResolvedValue({
      inviterName: 'Someone',
      interests: [],
    })
    hasInviteLinkFriendshipMock.mockReset()
    hasInviteLinkFriendshipMock.mockResolvedValue(false)
    friendInvitationRowsMock.mockReset()
    friendInvitationRowsMock.mockResolvedValue([{ id: 'inv-1' }])
    getInviterForUserMock.mockReset()
    getInviterForUserMock.mockResolvedValue(null)
    getInviteLinkSeedTopicsMock.mockReset()
    getInviteLinkSeedTopicsMock.mockResolvedValue([])
    getSeedTopicsForJoinedLinkMock.mockReset()
    getSeedTopicsForJoinedLinkMock.mockResolvedValue(null)
    getCatalogSuggestionsMock.mockReset()
    getCatalogSuggestionsMock.mockResolvedValue([])
  })

  it('redirects to /login when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/login' })
  })

  it('redirects to /login when the user row is missing', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce(null)
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/login' })
  })

  it('redirects already-onboarded users to /', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: true,
    })
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/' })
  })

  it('renders OnboardingFlow when session present and not-yet-onboarded', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    const result = await callPage()
    expect(result.redirected).toBe(false)
    expect(getPreSeededInterestsForUserMock).toHaveBeenCalledWith('u1')
  })

  it('renders OnboardingFlow for an invite-link signup (no FriendInvitation row, but an invite-link friendship)', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    friendInvitationRowsMock.mockResolvedValueOnce([]) // no SMS-style invitation
    hasInviteLinkFriendshipMock.mockResolvedValueOnce(true) // arrived via /u/<handle>/<token>
    // getPreSeededInterestsForUser finds no accepted FriendInvitation, so it
    // resolves with no interests AND no inviter name — realistic for a pure
    // link arrival (matches getPreSeededInterestsForUser's real behavior).
    getPreSeededInterestsForUserMock.mockResolvedValueOnce({
      inviterName: null,
      inviteeDisplayName: null,
      interests: [],
    })
    getInviterForUserMock.mockResolvedValueOnce({
      inviterUserId: 'inviter-1',
      inviterName: 'Jaime',
      sourceId: 'follow-1',
      sourceType: 'follow',
    })
    getInviteLinkSeedTopicsMock.mockResolvedValueOnce([
      { label: 'Jazz', broadCategory: 'Music' },
    ])

    const result = await callPage()

    expect(result.redirected).toBe(false)
    // Boundary-level check per Stage 1/2's recurring-failure guard: the
    // resolved link topics must actually reach the OnboardingFlow props, not
    // just come back correctly from the query.
    expect(result.props?.seedSource).toBe('link')
    expect(result.props?.inviterName).toBe('Jaime')
    expect(result.props?.preSeededInterests).toEqual([
      { domain: 'Jazz', broadCategory: 'Music', rationale: null },
    ])
  })

  it('prefers slot-precise attribution (getSeedTopicsForJoinedLink) over the ambient inviter-wide fallback', async () => {
    // B-FRIENDS-INVITE-LINKS-01: when the invitee's users.joined_via_invite_link_id
    // is attributed, that specific link's topic wins — even though the ambient
    // getInviteLinkSeedTopics(inviter) mock below would return something
    // different, proving the slot-precise path takes priority.
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    friendInvitationRowsMock.mockResolvedValueOnce([])
    hasInviteLinkFriendshipMock.mockResolvedValueOnce(true)
    getPreSeededInterestsForUserMock.mockResolvedValueOnce({
      inviterName: null,
      inviteeDisplayName: null,
      interests: [],
    })
    getInviterForUserMock.mockResolvedValueOnce({
      inviterUserId: 'inviter-1',
      inviterName: 'Jaime',
      sourceId: 'follow-1',
      sourceType: 'follow',
    })
    getSeedTopicsForJoinedLinkMock.mockResolvedValueOnce([
      { label: 'Sondheim', broadCategory: 'Music' },
    ])
    getInviteLinkSeedTopicsMock.mockResolvedValueOnce([
      { label: 'Jazz', broadCategory: 'Music' },
    ])

    const result = await callPage()

    expect(result.props?.seedSource).toBe('link')
    expect(result.props?.preSeededInterests).toEqual([
      { domain: 'Sondheim', broadCategory: 'Music', rationale: null },
    ])
    // The ambient fallback is only a fallback — it must not even be called
    // once slot-precise attribution resolves.
    expect(getInviteLinkSeedTopicsMock).not.toHaveBeenCalled()
  })

  it('breaks the blank-topic wall for a thin tagged link with adjacent catalog suggestions', async () => {
    // B-FRIENDS-INVITE-LINKS-01: a tagged link carries exactly one topic. That
    // alone leaves the invitee well short of MIN_INTERESTS=3, so the page
    // fills the gap with real, verified-question domains from the SAME broad
    // category — not fabricated ones, and never pre-selected (seedSource stays
    // 'link').
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    friendInvitationRowsMock.mockResolvedValueOnce([])
    hasInviteLinkFriendshipMock.mockResolvedValueOnce(true)
    getPreSeededInterestsForUserMock.mockResolvedValueOnce({
      inviterName: null,
      inviteeDisplayName: null,
      interests: [],
    })
    getInviterForUserMock.mockResolvedValueOnce({
      inviterUserId: 'inviter-1',
      inviterName: 'Jaime',
      sourceId: 'follow-1',
      sourceType: 'follow',
    })
    getSeedTopicsForJoinedLinkMock.mockResolvedValueOnce([
      { label: 'Sondheim', broadCategory: 'Music' },
    ])
    getCatalogSuggestionsMock.mockResolvedValueOnce([
      { domain: 'Kander & Ebb', broadCategory: 'Music' },
      { domain: 'Cole Porter', broadCategory: 'Music' },
    ])

    const result = await callPage()

    expect(getCatalogSuggestionsMock).toHaveBeenCalledWith(['Music'], new Set(['sondheim']), 2)
    expect(result.props?.seedSource).toBe('link')
    expect(result.props?.preSeededInterests).toEqual([
      { domain: 'Sondheim', broadCategory: 'Music', rationale: null },
      { domain: 'Kander & Ebb', broadCategory: 'Music', rationale: null },
      { domain: 'Cole Porter', broadCategory: 'Music', rationale: null },
    ])
  })

  it('does not fetch adjacent suggestions when the link already resolved 3 topics', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    friendInvitationRowsMock.mockResolvedValueOnce([])
    hasInviteLinkFriendshipMock.mockResolvedValueOnce(true)
    getPreSeededInterestsForUserMock.mockResolvedValueOnce({
      inviterName: null,
      inviteeDisplayName: null,
      interests: [],
    })
    getInviterForUserMock.mockResolvedValueOnce({
      inviterUserId: 'inviter-1',
      inviterName: 'Jaime',
      sourceId: 'follow-1',
      sourceType: 'follow',
    })
    getSeedTopicsForJoinedLinkMock.mockResolvedValueOnce([
      { label: 'Sondheim', broadCategory: 'Music' },
      { label: 'Jazz', broadCategory: 'Music' },
      { label: 'Chess', broadCategory: 'Games' },
    ])

    await callPage()

    expect(getCatalogSuggestionsMock).not.toHaveBeenCalled()
  })

  it('skips adjacent suggestions when there is nothing to be adjacent to (untagged link, no topics at all)', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    friendInvitationRowsMock.mockResolvedValueOnce([])
    hasInviteLinkFriendshipMock.mockResolvedValueOnce(true)
    getPreSeededInterestsForUserMock.mockResolvedValueOnce({
      inviterName: null,
      inviteeDisplayName: null,
      interests: [],
    })
    getInviterForUserMock.mockResolvedValueOnce({
      inviterUserId: 'inviter-1',
      inviterName: 'Jaime',
      sourceId: 'follow-1',
      sourceType: 'follow',
    })
    getSeedTopicsForJoinedLinkMock.mockResolvedValueOnce([])
    getInviteLinkSeedTopicsMock.mockResolvedValueOnce([])

    const result = await callPage()

    expect(getCatalogSuggestionsMock).not.toHaveBeenCalled()
    expect(result.props?.preSeededInterests).toEqual([])
  })

  it('does NOT fall back to invite-link topics for a named invite with zero seeded interests', async () => {
    // A named invite where the inviter simply seeded nothing — Stage 2 must
    // not change what this shows (still the empty "add a few below" state),
    // even though seeded.interests.length === 0 looks identical to the link
    // case at first glance. Distinguished via getInviterForUser's sourceType.
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    getPreSeededInterestsForUserMock.mockResolvedValueOnce({
      inviterName: 'Alex',
      inviteeDisplayName: null,
      interests: [],
    })
    getInviterForUserMock.mockResolvedValueOnce({
      inviterUserId: 'inviter-2',
      inviterName: 'Alex',
      sourceId: 'inv-2',
      sourceType: 'friend_invitation',
    })

    const result = await callPage()

    expect(result.redirected).toBe(false)
    expect(getInviteLinkSeedTopicsMock).not.toHaveBeenCalled()
    expect(result.props?.seedSource).toBe('named')
    expect(result.props?.preSeededInterests).toEqual([])
  })

  it('redirects to /login when there is neither a FriendInvitation nor an invite-link friendship', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', id: 's1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    friendInvitationRowsMock.mockResolvedValueOnce([])
    hasInviteLinkFriendshipMock.mockResolvedValueOnce(false)
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/login' })
  })
})
