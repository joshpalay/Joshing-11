import { describe, expect, it } from 'vitest'

import { readInvitationToken } from '@/app/login/LoginPanel'

describe('LoginPanel invitation token query aliases', () => {
  it.each([
    ['invitationToken', 'alpha-token'],
    ['invite', 'bravo-token'],
    ['token', 'charlie-token'],
  ])('accepts %s as an invitation token source', (queryKey, token) => {
    expect(readInvitationToken(new URLSearchParams([[queryKey, token]]))).toBe(
      token
    )
  })
})
