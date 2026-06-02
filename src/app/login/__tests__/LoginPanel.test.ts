import { describe, expect, it } from 'vitest'

import {
  buildVerifyOtpRequestBody,
  readInvitationToken,
} from '@/app/login/LoginPanel'

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

  it.each([
    ['invitationToken', 'alpha-token'],
    ['invite', 'bravo-token'],
    ['token', 'charlie-token'],
  ])(
    'posts %s as invitationToken to /api/auth/verify-otp',
    (queryKey, token) => {
      expect(
        buildVerifyOtpRequestBody(
          '+17345551234',
          '000000',
          new URLSearchParams([[queryKey, token]])
        )
      ).toEqual({
        phone: '+17345551234',
        code: '000000',
        invitationToken: token,
        userInvite: null,
      })
    }
  )

  it('keeps normal OTP login payload invitationToken empty when no invite query is present', () => {
    expect(
      buildVerifyOtpRequestBody('+17345551234', '000000', new URLSearchParams())
    ).toEqual({
      phone: '+17345551234',
      code: '000000',
      invitationToken: null,
      userInvite: null,
    })
  })
})
