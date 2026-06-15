import { describe, expect, it, vi } from 'vitest'

// compute-beats imports '@/server/db', which throws at load without
// DATABASE_URL. selectDiscoveries is pure (no DB), so a hollow mock is enough
// to let the module load. (Mirrors fire-ceremony.test's db mock.)
vi.mock('@/server/db', () => ({
  db: {},
  declaredInterests: {},
  feedItems: {},
  joshingGameResponses: {},
  masteryEvents: {},
  playerMastery: {},
  profileDomainVisibility: {},
  questions: {},
  users: {},
}))

import { selectDiscoveries, type DiscoveryCandidate } from '@/server/ceremony/compute-beats'
import { djb2 } from '@/lib/lately'

function candidate(overrides: Partial<DiscoveryCandidate> & { questionId: string }): DiscoveryCandidate {
  return {
    domain: 'History',
    questionText: `q-${overrides.questionId}`,
    correctAnswer: `a-${overrides.questionId}`,
    createdAt: new Date('2026-06-10T00:00:00Z'),
    ...overrides,
  }
}

describe('selectDiscoveries (Beat E selection signal)', () => {
  it('ranks "most friends also missed it" above a more-recent miss with fewer co-missers', () => {
    const candidates = [
      candidate({ questionId: 'recent-lonely', createdAt: new Date('2026-06-14T00:00:00Z') }),
      candidate({ questionId: 'old-shared', createdAt: new Date('2026-06-01T00:00:00Z') }),
    ]
    const friendMissCount = new Map([
      ['recent-lonely', 0],
      ['old-shared', 3],
    ])

    const result = selectDiscoveries(candidates, friendMissCount, 3)

    expect(result.map((r) => r.questionText)).toEqual(['q-old-shared', 'q-recent-lonely'])
  })

  it('falls back to most-recent when co-miss counts tie', () => {
    const candidates = [
      candidate({ questionId: 'older', createdAt: new Date('2026-06-02T00:00:00Z') }),
      candidate({ questionId: 'newer', createdAt: new Date('2026-06-09T00:00:00Z') }),
    ]
    const friendMissCount = new Map([
      ['older', 1],
      ['newer', 1],
    ])

    const result = selectDiscoveries(candidates, friendMissCount, 3)

    expect(result.map((r) => r.questionText)).toEqual(['q-newer', 'q-older'])
  })

  it('uses a hash-stable (djb2) tiebreak when co-miss and recency are equal', () => {
    const sameMoment = new Date('2026-06-05T00:00:00Z')
    const candidates = [
      candidate({ questionId: 'zeta', createdAt: sameMoment }),
      candidate({ questionId: 'alpha', createdAt: sameMoment }),
    ]
    const friendMissCount = new Map<string, number>()

    const first = selectDiscoveries(candidates, friendMissCount, 3)
    const second = selectDiscoveries([...candidates].reverse(), friendMissCount, 3)

    // Deterministic regardless of input order...
    expect(first.map((r) => r.questionText)).toEqual(second.map((r) => r.questionText))
    // ...and the order is exactly djb2(questionId) ascending.
    const expected = ['zeta', 'alpha']
      .sort((a, b) => djb2(a) - djb2(b))
      .map((id) => `q-${id}`)
    expect(first.map((r) => r.questionText)).toEqual(expected)
  })

  it('curates down to the cap (2–3, never a dump)', () => {
    const candidates = Array.from({ length: 7 }, (_, i) =>
      candidate({ questionId: `q${i}`, createdAt: new Date(`2026-06-${10 + i}T00:00:00Z`) }),
    )

    expect(selectDiscoveries(candidates, new Map(), 3)).toHaveLength(3)
  })

  it('projects only the render shape (no questionId / createdAt leak)', () => {
    const result = selectDiscoveries([candidate({ questionId: 'only' })], new Map(), 3)

    expect(result[0]).toEqual({ domain: 'History', questionText: 'q-only', correctAnswer: 'a-only' })
  })
})
