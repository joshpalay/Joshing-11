import { describe, expect, it } from 'vitest'

import {
  buildVerifyOtpRequestBody,
  readInvitationToken,
  readOfferReminders,
  readVerifiedIdentity,
  shouldCollectProfileIdentity,
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

describe('LoginPanel profile identity detection', () => {
  it('collects both identity fields from verify-otp user payloads', () => {
    expect(
      readVerifiedIdentity({
        user: { display_name: '  Jane Palay  ', handle: '  jpalay  ' },
      })
    ).toEqual({ displayName: 'Jane Palay', handle: 'jpalay' })
  })

  it('requires the profile step when either display name or handle is missing', () => {
    expect(shouldCollectProfileIdentity({ displayName: '', handle: 'jpalay' })).toBe(true)
    expect(shouldCollectProfileIdentity({ displayName: 'Jane Palay', handle: '' })).toBe(true)
    expect(shouldCollectProfileIdentity({ displayName: 'Jane Palay', handle: 'jpalay' })).toBe(
      false
    )
  })
})

describe('LoginPanel post-OTP reminder offer', () => {
  it('routes to /reminders only when verify-otp explicitly opts in', () => {
    expect(readOfferReminders({ offerReminders: true })).toBe(true)
  })

  it('lands home for every other shape', () => {
    // Absent (already opted in, opted out, or mid-onboarding), plus the
    // malformed/legacy responses a cached client could still be sending.
    expect(readOfferReminders({ offerReminders: false })).toBe(false)
    expect(readOfferReminders({ user: { handle: 'jpalay' } })).toBe(false)
    expect(readOfferReminders({ offerReminders: 'true' })).toBe(false)
    expect(readOfferReminders(null)).toBe(false)
    expect(readOfferReminders(undefined)).toBe(false)
  })
})
