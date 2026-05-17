import { and, asc, eq, inArray } from 'drizzle-orm'

import { db, declaredInterests } from '@/server/db'
import { getFriendship } from '@/server/db/queries/friends'
import { getUserById } from '@/server/db/queries/users'

type FriendProfileVisibility = 'self' | 'friend'

export type FriendPortraitInterest = {
  domain: string
  broadCategory: string | null
  shared: boolean
}

export type FriendPortraitData = {
  user: {
    id: string
    displayName: string
    memberSince: Date
  }
  visibility: FriendProfileVisibility
  friendship: {
    id: string
    formedAt: Date | null
  } | null
  interests: FriendPortraitInterest[]
  sharedInterests: string[]
  viewerSoloInterests: string[]
  friendSoloInterests: string[]
}

function profileDisplayName(
  name: string | null,
  fallback: string | null = 'Joshing friend'
) {
  return name?.trim() || fallback?.trim() || 'Joshing friend'
}

export async function getFriendPortraitData(
  userId: string,
  viewerId: string
): Promise<FriendPortraitData | null> {
  const normalizedUserId = userId.trim()
  const normalizedViewerId = viewerId.trim()
  if (!normalizedUserId || !normalizedViewerId) return null

  const viewedUser = await getUserById(normalizedUserId)
  if (!viewedUser) return null

  const isSelf = normalizedUserId === normalizedViewerId
  const friendship = isSelf
    ? null
    : await getFriendship(normalizedViewerId, normalizedUserId)

  if (!isSelf && friendship?.status !== 'active') return null

  const visibleUserIds = isSelf
    ? [normalizedUserId]
    : [normalizedUserId, normalizedViewerId]

  const interestRows = await db
    .select({
      userId: declaredInterests.userId,
      domain: declaredInterests.domain,
      broadCategory: declaredInterests.broadCategory,
    })
    .from(declaredInterests)
    .where(
      and(
        eq(declaredInterests.isActive, true),
        inArray(declaredInterests.userId, visibleUserIds)
      )
    )
    .orderBy(asc(declaredInterests.domain))

  const viewerInterests = new Set(
    interestRows
      .filter((interest) => interest.userId === normalizedViewerId)
      .map((interest) => interest.domain)
  )

  const interests = interestRows
    .filter((interest) => interest.userId === normalizedUserId)
    .map((interest) => ({
      domain: interest.domain,
      broadCategory: interest.broadCategory,
      shared: !isSelf && viewerInterests.has(interest.domain),
    }))

  const friendInterestDomains = new Set(interests.map((i) => i.domain))
  const viewerSoloInterests = isSelf
    ? []
    : Array.from(viewerInterests)
        .filter((domain) => !friendInterestDomains.has(domain))
        .sort((a, b) => a.localeCompare(b))
  const friendSoloInterests = interests
    .filter((interest) => !interest.shared)
    .map((interest) => interest.domain)

  return {
    user: {
      id: viewedUser.id,
      displayName: profileDisplayName(
        viewedUser.displayName,
        viewedUser.phoneNumber
      ),
      memberSince: viewedUser.createdAt,
    },
    visibility: isSelf ? 'self' : 'friend',
    friendship: friendship
      ? {
          id: friendship.id,
          formedAt: friendship.formedAt,
        }
      : null,
    interests,
    sharedInterests: interests
      .filter((interest) => interest.shared)
      .map((interest) => interest.domain),
    viewerSoloInterests,
    friendSoloInterests,
  }
}
