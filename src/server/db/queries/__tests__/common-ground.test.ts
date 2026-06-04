import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MasteryTier } from '@/types/db'

// getCommonGround compares two users' full PLAYER_MASTERY bases and resolves
// each shared domain into a proven (both demonstrated) or latent (shared but
// not yet proven) tier. These tests drive the in-memory classification/ranking
// by seeding the two DB reads it performs.

type MasteryRow = {
  userId: string
  canonicalSubcategory: string
  broadCategory: string | null
  totalPoints: number
  tier: MasteryTier
}
type ProvenRow = { userId: string; canonicalSubcategory: string }

const { masteryRowsRef, provenRowsRef } = vi.hoisted(() => ({
  masteryRowsRef: { rows: [] as MasteryRow[] },
  provenRowsRef: { rows: [] as ProvenRow[] },
}))

// Spread the REAL schema so table identity (playerMastery vs masteryEvents) is
// preserved, and stub only `db`. The select chain resolves to the seeded rows
// for whichever table `.from()` receives. The real `.where()` source-type
// filter isn't executed here, so `provenRowsRef` models the POST-filter result:
// only live_correct/catchup_correct events ever land in it.
vi.mock('@/server/db', async () => {
  const schema =
    await vi.importActual<typeof import('@/server/db/schema')>(
      '@/server/db/schema',
    )
  return {
    ...schema,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            Promise.resolve(
              table === schema.playerMastery
                ? masteryRowsRef.rows
                : provenRowsRef.rows,
            ),
        }),
      }),
    },
  }
})

import { getCommonGround } from '../common-ground'

const VIEWER = 'viewer-1'
const FRIEND = 'friend-1'

function mastery(
  userId: string,
  canonicalSubcategory: string,
  totalPoints: number,
  tier: MasteryTier = 'familiar',
  broadCategory: string | null = 'Literature',
): MasteryRow {
  return { userId, canonicalSubcategory, broadCategory, totalPoints, tier }
}

function proven(userId: string, canonicalSubcategory: string): ProvenRow {
  return { userId, canonicalSubcategory }
}

beforeEach(() => {
  masteryRowsRef.rows = []
  provenRowsRef.rows = []
})

describe('getCommonGround', () => {
  it('surfaces a domain both users proved as proven', async () => {
    masteryRowsRef.rows = [
      mastery(VIEWER, 'Jazz Theory', 10, 'solid'),
      mastery(FRIEND, 'Jazz Theory', 4, 'familiar'),
    ]
    provenRowsRef.rows = [
      proven(VIEWER, 'Jazz Theory'),
      proven(FRIEND, 'Jazz Theory'),
    ]

    const result = await getCommonGround(VIEWER, FRIEND)

    expect(result.isEmpty).toBe(false)
    expect(result.latent).toHaveLength(0)
    expect(result.proven).toHaveLength(1)
    const domain = result.proven[0]
    expect(domain.canonical_subcategory).toBe('Jazz Theory')
    expect(domain.kind).toBe('proven')
    expect(domain.viewer.proven).toBe(true)
    expect(domain.friend.proven).toBe(true)
    expect(domain.viewer.mastery_points).toBe(10)
    expect(domain.friend.mastery_points).toBe(4)
  })

  it('classifies a shared domain neither has proven as latent', async () => {
    masteryRowsRef.rows = [
      mastery(VIEWER, 'Roman Roads', 0, 'establishing'),
      mastery(FRIEND, 'Roman Roads', 0, 'establishing'),
    ]
    // No proven events for either user.

    const result = await getCommonGround(VIEWER, FRIEND)

    expect(result.proven).toHaveLength(0)
    expect(result.latent).toHaveLength(1)
    expect(result.latent[0].kind).toBe('latent')
    expect(result.latent[0].viewer.proven).toBe(false)
    expect(result.latent[0].friend.proven).toBe(false)
    expect(result.isEmpty).toBe(false)
  })

  it('treats a one-sided proof as latent (both must be proven)', async () => {
    masteryRowsRef.rows = [
      mastery(VIEWER, 'Virginia Woolf', 8, 'solid'),
      mastery(FRIEND, 'Virginia Woolf', 2, 'establishing'),
    ]
    provenRowsRef.rows = [proven(VIEWER, 'Virginia Woolf')]

    const result = await getCommonGround(VIEWER, FRIEND)

    expect(result.proven).toHaveLength(0)
    expect(result.latent).toHaveLength(1)
    expect(result.latent[0].viewer.proven).toBe(true)
    expect(result.latent[0].friend.proven).toBe(false)
  })

  it('does not filter on depth — a master-vs-establishing proven domain still appears', async () => {
    masteryRowsRef.rows = [
      mastery(VIEWER, 'Opera', 200, 'mastery'),
      mastery(FRIEND, 'Opera', 1, 'establishing'),
    ]
    provenRowsRef.rows = [proven(VIEWER, 'Opera'), proven(FRIEND, 'Opera')]

    const result = await getCommonGround(VIEWER, FRIEND)

    expect(result.proven).toHaveLength(1)
    expect(result.proven[0].canonical_subcategory).toBe('Opera')
    expect(result.proven[0].viewer.current_tier).toBe('mastery')
    expect(result.proven[0].friend.current_tier).toBe('establishing')
  })

  it('returns the top 5 proven domains ranked by combined mastery points', async () => {
    const points = [1, 7, 3, 9, 5, 8, 2]
    masteryRowsRef.rows = points.flatMap((p, i) => [
      mastery(VIEWER, `Domain ${i}`, p),
      mastery(FRIEND, `Domain ${i}`, p),
    ])
    provenRowsRef.rows = points.flatMap((_, i) => [
      proven(VIEWER, `Domain ${i}`),
      proven(FRIEND, `Domain ${i}`),
    ])

    const result = await getCommonGround(VIEWER, FRIEND)

    expect(result.proven).toHaveLength(5)
    // Combined points = 2 * p. Highest p first: 9,8,7,5,3 → Domain 3,5,1,4,2.
    expect(result.proven.map((d) => d.canonical_subcategory)).toEqual([
      'Domain 3',
      'Domain 5',
      'Domain 1',
      'Domain 4',
      'Domain 2',
    ])
  })

  it('reports empty when there is no shared domain', async () => {
    masteryRowsRef.rows = [
      mastery(VIEWER, 'Astronomy', 5),
      mastery(FRIEND, 'Cricket', 5),
    ]

    const result = await getCommonGround(VIEWER, FRIEND)

    expect(result.proven).toHaveLength(0)
    expect(result.latent).toHaveLength(0)
    expect(result.isEmpty).toBe(true)
  })

  it('matches the same domain case-insensitively, keeping the viewer label', async () => {
    masteryRowsRef.rows = [
      mastery(VIEWER, 'star trek', 6, 'familiar'),
      mastery(FRIEND, 'Star Trek', 6, 'familiar'),
    ]
    provenRowsRef.rows = [proven(VIEWER, 'star trek'), proven(FRIEND, 'Star Trek')]

    const result = await getCommonGround(VIEWER, FRIEND)

    expect(result.proven).toHaveLength(1)
    expect(result.proven[0].canonical_subcategory).toBe('star trek')
  })

  it('does not count non-live source types as proven (lands in latent)', async () => {
    // A domain whose only mastery events were 'authored' is filtered out by the
    // query's source-type WHERE, so it never appears in provenRowsRef → latent.
    masteryRowsRef.rows = [
      mastery(VIEWER, 'Cartography', 0, 'establishing'),
      mastery(FRIEND, 'Cartography', 0, 'establishing'),
    ]
    provenRowsRef.rows = []

    const result = await getCommonGround(VIEWER, FRIEND)

    expect(result.proven).toHaveLength(0)
    expect(result.latent).toHaveLength(1)
    expect(result.isEmpty).toBe(false)
  })
})
