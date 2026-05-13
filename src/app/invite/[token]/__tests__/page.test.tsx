import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getFriendInvitationLandingByTokenMock } = vi.hoisted(() => ({
  getFriendInvitationLandingByTokenMock: vi.fn(),
}))

vi.mock('@/server/friends/invitations', () => ({
  getFriendInvitationLandingByToken: getFriendInvitationLandingByTokenMock,
}))

import InvitePage from '@/app/invite/[token]/page'

async function renderInvite(token = 'safe-token') {
  const element = await InvitePage({ params: Promise.resolve({ token }) })
  return renderToStaticMarkup(element)
}

describe('/invite/[token] landing QA states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens a valid invite landing with inviter name, suggested interests, and auth continuation', async () => {
    getFriendInvitationLandingByTokenMock.mockResolvedValueOnce({
      status: 'valid',
      inviterName: 'Alex Inviter',
      suggestedInterests: [{ label: 'Jazz' }, { label: 'Poetry' }],
    })

    const html = await renderInvite('valid-token')

    expect(getFriendInvitationLandingByTokenMock).toHaveBeenCalledWith(
      'valid-token'
    )
    expect(html).toContain('Alex Inviter invited you to Joshing.')
    expect(html).toContain('Jazz')
    expect(html).toContain('Poetry')
    expect(html).toContain('href="/login?invitationToken=valid-token"')
    expect(html).not.toMatch(/leaderboard|ranking|score|points?|percent|%/i)
  })

  it.each([
    {
      status: 'expired',
      expectedHeading: 'This invitation has expired.',
      expectedEyebrow: 'Invitation expired',
    },
    {
      status: 'accepted',
      expectedHeading: 'This invitation has already been used.',
      expectedEyebrow: 'Invitation already used',
    },
    {
      status: 'invalid',
      expectedHeading: 'This invitation link is not valid.',
      expectedEyebrow: 'Invalid invitation',
    },
  ])(
    'renders the $status invite state safely',
    async ({ status, expectedHeading, expectedEyebrow }) => {
      getFriendInvitationLandingByTokenMock.mockResolvedValueOnce({
        status,
        inviterName: 'Alex Inviter',
        suggestedInterests: [{ label: 'Hidden' }],
      })

      const html = await renderInvite(`${status}-token`)

      expect(html).toContain(expectedEyebrow)
      expect(html).toContain(expectedHeading)
      expect(html).toContain('href="/login"')
      expect(html).not.toContain('Hidden')
      expect(html).not.toContain(`${status}-token`)
    }
  )
})
