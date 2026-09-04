import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  dbSelectMock,
  listInviteReflectionsMock,
  listContactMatchesMock,
  getLastContactHashUploadMock,
  listLiveInviteLinksMock,
  getInviteLinkSeedTopicsMock,
  redirectMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  dbSelectMock: vi.fn(),
  listInviteReflectionsMock: vi.fn(async () => [] as unknown[]),
  listContactMatchesMock: vi.fn(async () => [] as unknown[]),
  getLastContactHashUploadMock: vi.fn(async () => null),
  listLiveInviteLinksMock: vi.fn(async () => [] as unknown[]),
  getInviteLinkSeedTopicsMock: vi.fn(async () => [] as unknown[]),
  redirectMock: vi.fn(() => {
    throw new Error('__REDIRECT__')
  }),
}))

vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db', () => ({
  db: { select: dbSelectMock },
  users: { id: 'id', handle: 'handle', discoverableByContacts: 'dbc' },
}))
vi.mock('@/server/db/queries/contact-hashes', () => ({
  listContactMatches: listContactMatchesMock,
  getLastContactHashUpload: getLastContactHashUploadMock,
  isRefreshDue: () => false,
  markDiscoveryChecked: vi.fn(async () => {}),
}))
vi.mock('@/server/db/queries/friend-invitations', () => ({
  listInviteReflections: listInviteReflectionsMock,
}))
vi.mock('@/server/db/queries/invite-links', () => ({
  listLiveInviteLinks: listLiveInviteLinksMock,
}))
vi.mock('@/server/friends/user-invite-token', () => ({
  getInviteLinkSeedTopics: getInviteLinkSeedTopicsMock,
  buildInviteUrl: (base: string, handle: string, token: string) => `${base}/u/${handle}/${token}`,
  getBaseUrl: () => 'https://example.com',
}))
// Client islands are stubbed: this test is about which SECTIONS the server
// component renders, not their internals.
vi.mock('@/components/friends/ContactMatchBlock', () => ({
  ContactMatchBlock: () => <div data-stub="contact-match" />,
}))
vi.mock('@/components/friends/FindFriendsSearch', () => ({
  FindFriendsSearch: () => <div data-stub="find-friends-search" />,
}))
vi.mock('@/components/friends/InviteLinksSection', () => ({
  InviteLinksSection: () => <div data-stub="invite-links" />,
}))
vi.mock('@/components/FriendsList', () => ({ default: () => <div data-stub="friends-list" /> }))

import FriendsPage from '@/app/friends/page'

function mockViewer(discoverableByContacts = true) {
  dbSelectMock.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => [{ handle: 'jpalay', discoverableByContacts }],
      }),
    }),
  })
}

async function render() {
  const element = await FriendsPage()
  return renderToStaticMarkup(element)
}

describe('/friends page sections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listInviteReflectionsMock.mockResolvedValue([])
    listContactMatchesMock.mockResolvedValue([])
    getLastContactHashUploadMock.mockResolvedValue(null)
    listLiveInviteLinksMock.mockResolvedValue([])
    getInviteLinkSeedTopicsMock.mockResolvedValue([])
    getSessionMock.mockResolvedValue({ userId: 'u1' })
    mockViewer()
  })

  it('omits the Suggested section ENTIRELY when there is nothing to suggest', async () => {
    // The heading used to render unconditionally, so with no contact matches
    // and no invite reflections the section was a title over a "Coming soon"
    // card -- roughly a third of the first screen saying nothing.
    const html = await render()
    expect(html).not.toContain('Suggested')
    // The rest of the page is unaffected.
    expect(html).toContain('data-stub="find-friends-search"')
    expect(html).toContain('data-stub="invite-links"')
    expect(html).toContain('data-stub="friends-list"')
  })

  it('renders the Suggested section WITH its heading when reflections exist', async () => {
    // The guard must hide an empty section, not delete the label -- otherwise
    // users who DO have suggestions get an unlabelled block. This is the case
    // the browser pass could not reach (that account had no reflections).
    listInviteReflectionsMock.mockResolvedValue([
      {
        invitationId: 'inv-1',
        inviteeUserId: 'u2',
        handle: 'robyn',
        displayName: 'Robyn',
        avatarColor: '#7d2c3f',
        joinedAt: new Date('2026-09-01T00:00:00Z'),
        invitedAt: new Date('2026-08-30T00:00:00Z'),
        acceptedAt: new Date('2026-09-01T00:00:00Z'),
        relationship: { state: 'none', friendshipId: null, formedAt: null, isBlocked: false },
      },
    ])

    const html = await render()
    expect(html).toContain('Suggested')
    expect(html).toContain('Robyn')
    // Provenance chip: a suggestion must never read as unexplained.
    expect(html).toContain('Joined from your invite')
  })

  it('never renders the retired "Coming soon" mutual-friends placeholder', async () => {
    listInviteReflectionsMock.mockResolvedValue([])
    const html = await render()
    expect(html).not.toContain('Coming soon')
    expect(html).not.toContain('Suggested via mutual friends')
  })

  it('redirects a signed-out visitor', async () => {
    getSessionMock.mockResolvedValue(null)
    await expect(render()).rejects.toThrow('__REDIRECT__')
  })
})
