import { describe, expect, it } from 'vitest'

import { formatUsPhoneInput, maskPhoneE164 } from '@/lib/phone-e164'

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

describe('formatUsPhoneInput', () => {
  it('formats a full 10-digit number as (555) 123-4567', () => {
    expect(formatUsPhoneInput('5551234567')).toBe('(555) 123-4567')
  })

  it('formats partial input progressively as the user types', () => {
    expect(formatUsPhoneInput('')).toBe('')
    expect(formatUsPhoneInput('5')).toBe('(5')
    expect(formatUsPhoneInput('555')).toBe('(555')
    expect(formatUsPhoneInput('5551')).toBe('(555) 1')
    expect(formatUsPhoneInput('555123')).toBe('(555) 123')
    expect(formatUsPhoneInput('5551234')).toBe('(555) 123-4')
  })

  it('ignores characters the user already typed (re-formats from digits)', () => {
    expect(formatUsPhoneInput('(555) 123-4567')).toBe('(555) 123-4567')
    expect(formatUsPhoneInput('555.123.4567')).toBe('(555) 123-4567')
  })

  it('drops a leading US country code', () => {
    expect(formatUsPhoneInput('15551234567')).toBe('(555) 123-4567')
    expect(formatUsPhoneInput('+1 (555) 123-4567')).toBe('(555) 123-4567')
  })

  it('caps at 10 national digits', () => {
    expect(formatUsPhoneInput('55512345678901')).toBe('(555) 123-4567')
  })
})
