import { describe, expect, it } from 'vitest'
import { getNextCeremonyAt } from '@/server/db/queries/ceremony'

// Pins UTC dates so the test is stable regardless of host timezone.
function utc(iso: string): Date {
  return new Date(iso)
}

describe('getNextCeremonyAt (Sunday 08:00 UTC cadence)', () => {
  it('returns this Sunday at 08:00 UTC when called Monday', () => {
    // 2026-05-18 is a Monday.
    const next = getNextCeremonyAt(utc('2026-05-18T12:00:00Z'))
    expect(next.toISOString()).toBe('2026-05-24T08:00:00.000Z')
  })

  it('returns this Sunday at 08:00 UTC when called Saturday', () => {
    // 2026-05-23 is a Saturday.
    const next = getNextCeremonyAt(utc('2026-05-23T23:59:00Z'))
    expect(next.toISOString()).toBe('2026-05-24T08:00:00.000Z')
  })

  it('returns today at 08:00 UTC when called Sunday before 08:00 UTC', () => {
    const next = getNextCeremonyAt(utc('2026-05-24T03:00:00Z'))
    expect(next.toISOString()).toBe('2026-05-24T08:00:00.000Z')
  })

  it('returns next Sunday when called Sunday after 08:00 UTC', () => {
    const next = getNextCeremonyAt(utc('2026-05-24T09:00:00Z'))
    expect(next.toISOString()).toBe('2026-05-31T08:00:00.000Z')
  })

  it('handles month boundaries correctly', () => {
    // 2026-05-31 is a Sunday. Calling Wednesday before should return that Sunday.
    const next = getNextCeremonyAt(utc('2026-05-27T15:00:00Z'))
    expect(next.toISOString()).toBe('2026-05-31T08:00:00.000Z')
  })
})
