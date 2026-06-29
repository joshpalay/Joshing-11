import { describe, expect, it } from 'vitest'
import { beatsPayloadSchema } from '@/server/ceremony/compute-beats'

const WELL_FORMED = {
  cycleStart: '2026-05-01',
  cycleEnd: '2026-05-15',
  beat1: [
    { domain: 'jazz', fromTier: 'familiar', toTier: 'solid' },
  ],
  beat2: {
    friendMediated: [{ domain: 'jazz', questionCount: 3, correctCount: 2 }],
    authored: [{ domain: 'poetry' }],
    promoted: [],
  },
  beat3: [
    { userId: 'u1', displayName: 'Alice', contributionCount: 5 },
  ],
  beat4: {
    userId: 'u2',
    displayName: 'Bob',
    sharedDomains: ['jazz', 'poetry'],
  },
  beat5: {
    totalCreatorPoints: 42,
    topQuestion: { text: 'Q?', answeredCount: 7 },
  },
}

describe('beatsPayloadSchema (F3.5)', () => {
  it('accepts a well-formed payload', () => {
    expect(beatsPayloadSchema.safeParse(WELL_FORMED).success).toBe(true)
  })

  it('accepts a payload with all beats null (no activity this cycle)', () => {
    const result = beatsPayloadSchema.safeParse({
      cycleStart: '2026-05-01',
      cycleEnd: '2026-05-15',
      beat1: null,
      beat2: null,
      beat3: null,
      beat4: null,
      beat5: null,
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional mode and mergeNote fields', () => {
    const result = beatsPayloadSchema.safeParse({
      ...WELL_FORMED,
      mode: 'group',
      mergeNote: {
        mergesApplied: 1,
        details: [
          { sources: ['Bebop'], target: 'Jazz', rationale: 'consolidated' },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a payload where beat1 contains an unknown tier value', () => {
    const result = beatsPayloadSchema.safeParse({
      ...WELL_FORMED,
      beat1: [{ domain: 'jazz', fromTier: 'wizard', toTier: 'solid' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a payload where beat4 sharedDomains is not an array of strings', () => {
    const result = beatsPayloadSchema.safeParse({
      ...WELL_FORMED,
      beat4: { userId: 'u2', displayName: 'Bob', sharedDomains: [1, 2, 3] },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a payload missing cycleStart', () => {
    const { cycleStart: _cycleStart, ...rest } = WELL_FORMED
    const result = beatsPayloadSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects entirely unknown shape (e.g. a string)', () => {
    expect(beatsPayloadSchema.safeParse('not a payload').success).toBe(false)
    expect(beatsPayloadSchema.safeParse(null).success).toBe(false)
  })

  it('accepts a payload with friend fallbacks for empty Beat1 and Beat5', () => {
    const result = beatsPayloadSchema.safeParse({
      cycleStart: '2026-05-10',
      cycleEnd: '2026-05-17',
      beat1: null,
      beat1FriendFallback: { friendName: 'Sara', count: 2, domains: ['jazz', 'poetry'] },
      beat2: null,
      beat3: null,
      beat4: null,
      beat5: null,
      beat5FriendFallback: { friendName: 'Marcus', totalCreatorPoints: 14.5 },
    })
    expect(result.success).toBe(true)
  })

  it('accepts an optional Beat6 (something you learned this week)', () => {
    const result = beatsPayloadSchema.safeParse({
      ...WELL_FORMED,
      beat6: [
        { domain: 'jazz', questionText: 'Who composed Giant Steps?', correctAnswer: 'John Coltrane' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a payload omitting Beat6 entirely (pre-existing corpus)', () => {
    expect(beatsPayloadSchema.safeParse(WELL_FORMED).success).toBe(true)
  })

  it('rejects a malformed Beat6 item', () => {
    const result = beatsPayloadSchema.safeParse({
      ...WELL_FORMED,
      beat6: [{ domain: 'jazz', questionText: 'Q?' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects malformed friend fallback shapes', () => {
    const result = beatsPayloadSchema.safeParse({
      ...WELL_FORMED,
      beat1FriendFallback: { friendName: 'Sara', count: 'two', domains: [] },
    })
    expect(result.success).toBe(false)
  })

  it('accepts the redesign fields: opener, friendMediated.via, beat5.totalAnswered', () => {
    const result = beatsPayloadSchema.safeParse({
      ...WELL_FORMED,
      opener: { weekIndex: 14, questionsRight: 22, sessionsPlayed: 6 },
      beat2: {
        friendMediated: [{ domain: 'jazz', questionCount: 3, correctCount: 2, via: 'Maya' }],
        authored: [],
        promoted: [],
      },
      beat5: {
        totalCreatorPoints: 42,
        totalAnswered: 9,
        topQuestion: { text: 'Q?', answeredCount: 7 },
      },
    })
    expect(result.success).toBe(true)
  })

  it('still accepts payloads omitting the redesign fields (pre-redesign corpus)', () => {
    // WELL_FORMED has no opener, no via on friendMediated, no totalAnswered.
    expect(beatsPayloadSchema.safeParse(WELL_FORMED).success).toBe(true)
  })

  it('rejects a malformed opener (questionsRight must be a number)', () => {
    const result = beatsPayloadSchema.safeParse({
      ...WELL_FORMED,
      opener: { weekIndex: 14, questionsRight: 'lots', sessionsPlayed: 6 },
    })
    expect(result.success).toBe(false)
  })
})
