import { and, inArray } from 'drizzle-orm'

import { db, masteryEvents, playerMastery } from '@/server/db'
import type { MasteryTier } from '@/types/db'

// A single shared-knowledge domain between the viewer and a friend, resolved
// from each user's FULL PLAYER_MASTERY base (not the daily-five seeds, not a
// game scope). See src/server/db/queries/__tests__/common-ground.test.ts.
export type CommonGroundDomain = {
  canonical_subcategory: string
  broad_category: string | null
  viewer: { mastery_points: number; current_tier: MasteryTier; proven: boolean }
  friend: { mastery_points: number; current_tier: MasteryTier; proven: boolean }
  kind: 'proven' | 'latent'
}

export type CommonGround = {
  // Domains both users have PROVEN. Top 5, ranked by combined mastery points.
  proven: CommonGroundDomain[]
  // Domains both users hold but at least one hasn't proven yet (an invitation,
  // not a match). Declared-but-untested interests land here.
  latent: CommonGroundDomain[]
  // True only when there is genuinely zero shared domain across BOTH tiers.
  isEmpty: boolean
}

// A user is "proven" in a domain when they have answered correctly on a live
// surface: at least one MASTERY_EVENTS row with one of these source types.
const PROVEN_SOURCE_TYPES = ['live_correct', 'catchup_correct'] as const

const MAX_PROVEN = 5

// PLAYER_MASTERY.canonicalSubcategory is already canonicalized, so a simple
// case-fold is enough to match the same domain across two users. Mirrors the
// `domainKey` convention used throughout knowledge.ts.
function domainKey(domain: string): string {
  return domain.trim().toLowerCase()
}

type MasteryHolding = {
  label: string
  broadCategory: string | null
  points: number
  tier: MasteryTier
}

/**
 * Compute the common ground between two users from their full PLAYER_MASTERY
 * bases. Resolves each shared domain into a proven tier (both demonstrated) or
 * a latent tier (shared but at least one unproven). Depth asymmetry is NOT a
 * disqualifier — a master-vs-curious shared domain still appears; we only sort.
 */
export async function getCommonGround(
  viewerId: string,
  friendId: string,
): Promise<CommonGround> {
  const userIds = [viewerId, friendId]

  // Two reads: every domain each user holds, and every domain each user has
  // proven. We explicitly enumerate the PLAYER_MASTERY columns (omitting the
  // legacy `territory_type`) so the query can't trip the 42703 missing-column
  // failure that getPlayerMasteryRows defends against — proven-ness is derived
  // from MASTERY_EVENTS here, not from territory_type.
  const [masteryRows, provenRows] = await Promise.all([
    db
      .select({
        userId: playerMastery.userId,
        canonicalSubcategory: playerMastery.canonicalSubcategory,
        broadCategory: playerMastery.broadCategory,
        totalPoints: playerMastery.totalPoints,
        tier: playerMastery.tier,
      })
      .from(playerMastery)
      .where(inArray(playerMastery.userId, userIds)),
    db
      .select({
        userId: masteryEvents.userId,
        canonicalSubcategory: masteryEvents.canonicalSubcategory,
      })
      .from(masteryEvents)
      .where(
        and(
          inArray(masteryEvents.userId, userIds),
          inArray(masteryEvents.sourceType, [...PROVEN_SOURCE_TYPES]),
        ),
      ),
  ])

  const viewerByKey = new Map<string, MasteryHolding>()
  const friendByKey = new Map<string, MasteryHolding>()
  for (const row of masteryRows) {
    const target = row.userId === viewerId ? viewerByKey : friendByKey
    const key = domainKey(row.canonicalSubcategory)
    // Unique (user, canonicalSubcategory) means one row per pair; keep the
    // first if two only differ by case.
    if (target.has(key)) continue
    target.set(key, {
      label: row.canonicalSubcategory,
      broadCategory: row.broadCategory ?? null,
      points: Number(row.totalPoints ?? 0),
      tier: row.tier,
    })
  }

  const viewerProvenKeys = new Set<string>()
  const friendProvenKeys = new Set<string>()
  for (const row of provenRows) {
    const target = row.userId === viewerId ? viewerProvenKeys : friendProvenKeys
    target.add(domainKey(row.canonicalSubcategory))
  }

  const shared: CommonGroundDomain[] = []
  for (const [key, viewerHolding] of viewerByKey) {
    const friendHolding = friendByKey.get(key)
    if (!friendHolding) continue

    const viewerProven = viewerProvenKeys.has(key)
    const friendProven = friendProvenKeys.has(key)
    shared.push({
      // Prefer the viewer's stored casing for the display label.
      canonical_subcategory: viewerHolding.label,
      broad_category: viewerHolding.broadCategory ?? friendHolding.broadCategory,
      viewer: {
        mastery_points: viewerHolding.points,
        current_tier: viewerHolding.tier,
        proven: viewerProven,
      },
      friend: {
        mastery_points: friendHolding.points,
        current_tier: friendHolding.tier,
        proven: friendProven,
      },
      kind: viewerProven && friendProven ? 'proven' : 'latent',
    })
  }

  const combinedPoints = (d: CommonGroundDomain) =>
    d.viewer.mastery_points + d.friend.mastery_points

  const proven = shared
    .filter((d) => d.kind === 'proven')
    .sort(
      (a, b) =>
        combinedPoints(b) - combinedPoints(a) ||
        a.canonical_subcategory.localeCompare(b.canonical_subcategory),
    )
    .slice(0, MAX_PROVEN)

  const latent = shared
    .filter((d) => d.kind === 'latent')
    .sort(
      (a, b) =>
        combinedPoints(b) - combinedPoints(a) ||
        a.canonical_subcategory.localeCompare(b.canonical_subcategory),
    )

  // Invariant: if any domain is shared, the section is never empty. This is the
  // guard that prevents "No overlap" while a domain appears in both columns.
  const isEmpty = proven.length === 0 && latent.length === 0

  return { proven, latent, isEmpty }
}
