import { describe, expect, it } from 'vitest'

import { maskPhoneE164 } from '@/lib/phone-e164'

describe('maskPhoneE164', () => {
  it('masks a US E.164 number to •••-•••-1234', () => {
    expect(maskPhoneE164('+17345556819')).toBe('•••-•••-6819')
  })

  it('masks a bare 10-digit number', () => {
    expect(maskPhoneE164('7345556819')).toBe('•••-•••-6819')
  })

  it('strips a leading 1 (11-digit) before masking', () => {
    expect(maskPhoneE164('17345556819')).toBe('•••-•••-6819')
  })

  it('falls back to a fully masked placeholder for non-10-digit input', () => {
    expect(maskPhoneE164('+44 20 7946 0958')).toBe('•••-•••-••••')
    expect(maskPhoneE164('')).toBe('•••-•••-••••')
  })
})
