import { describe, expect, it } from 'vitest'

import { resolveDisplayName } from '@/server/lib/display-name'

/**
 * F8 (2026-09-10 audit) — resolveDisplayName is the one shared precedence
 * chain for showing one user's name to another: display name -> username ->
 * a neutral generic fallback. The phone number must never appear, at any
 * step, regardless of what other fields a caller happens to pass in.
 */
describe('resolveDisplayName', () => {
  it('prefers a set display name over everything else', () => {
    expect(
      resolveDisplayName({ displayName: 'Robyn', handle: 'robyn123' }),
    ).toBe('Robyn')
  })

  it('trims a display name that is only whitespace and falls through', () => {
    expect(resolveDisplayName({ displayName: '   ', handle: 'robyn123' })).toBe('@robyn123')
  })

  it('falls back to the handle, as @handle, when there is no display name', () => {
    expect(resolveDisplayName({ displayName: null, handle: 'robyn123' })).toBe('@robyn123')
  })

  // The legacy nameless, handle-less account: no identity signal at all.
  it('falls back to a neutral generic placeholder for a legacy nameless account with no handle', () => {
    expect(resolveDisplayName({ displayName: null, handle: null })).toBe('Joshing friend')
  })

  it('never returns an empty string', () => {
    expect(resolveDisplayName({ displayName: '', handle: '' })).toBe('Joshing friend')
  })

  it('ignores a phoneNumber field entirely even if present on the input', () => {
    const withPhone = { displayName: null, handle: null, phoneNumber: '+15550101010' }
    expect(resolveDisplayName(withPhone)).not.toContain('+1')
    expect(resolveDisplayName(withPhone)).toBe('Joshing friend')
  })
})
