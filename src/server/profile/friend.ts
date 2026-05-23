import { and, asc, eq, inArray } from 'drizzle-orm'

import { db, declaredInterests } from '@/server/db'
import { getFriends, getFriendship } from '@/server/db/queries/friends'
import { getUserById } from '@/server/db/queries/users'

type FriendProfileVisibility = 'self' | 'friend' | 'stranger'

const MUTUAL_FRIENDS_LIMIT = 24

export type FriendPortraitInterest = {
  domain: string
  broadCategory: string | null
  shared: boolean
}

export type FriendPortraitMutualFriend = {
  id: string
  displayName: string
}

export type FriendPortraitFriendship = {
  id: string
  status: string
  formedAt: Date | null
  requestedByUserId: string
  viewerIsRequester: boolean
}

export type FriendPortraitData = {
  user: {
    id: string
    displayName: string
    handle: string | null
    tagline: string | null
    location: string | null
    bio: string | null
    authorProfilePublic: boolean
    memberSince: Date
  }
  visibility: FriendProfileVisibility
  friendship: FriendPortraitFriendship | null
  interests: FriendPortraitInterest[]
  sharedInterests: string[]
  viewerSoloInterests: string[]
  friendSoloInterests: string[]
  mutualFriends: FriendPortraitMutualFriend[]
  mutualFriendsOverflow: number
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

  const isActiveFriend = !isSelf && friendship?.status === 'active'
  const visibility: FriendProfileVisibility = isSelf
    ? 'self'
    : isActiveFriend
      ? 'friend'
      : 'stranger'

  const interestOwnerIds = isSelf
    ? [normalizedUserId]
    : isActiveFriend
      ? [normalizedUserId, normalizedViewerId]
      : [normalizedViewerId]

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
        inArray(declaredInterests.userId, interestOwnerIds)
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
      shared: isActiveFriend && viewerInterests.has(interest.domain),
    }))

  const friendInterestDomains = new Set(interests.map((i) => i.domain))
  const viewerSoloInterests = isActiveFriend
    ? Array.from(viewerInterests)
        .filter((domain) => !friendInterestDomains.has(domain))
        .sort((a, b) => a.localeCompare(b))
    : []
  const friendSoloInterests = isActiveFriend
    ? interests.filter((interest) => !interest.shared).map((i) => i.domain)
    : []

  let mutualFriends: FriendPortraitMutualFriend[] = []
  let mutualFriendsOverflow = 0
  if (!isSelf) {
    const [viewerFriends, viewedUserFriends] = await Promise.all([
      getFriends(normalizedViewerId),
      getFriends(normalizedUserId),
    ])
    const viewerFriendIds = new Set(viewerFriends.map((u) => u.id))
    const mutuals = viewedUserFriends
      .filter((user) => viewerFriendIds.has(user.id))
      .map((user) => ({
        id: user.id,
        displayName: profileDisplayName(user.displayName, user.phoneNumber),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
    mutualFriends = mutuals.slice(0, MUTUAL_FRIENDS_LIMIT)
    mutualFriendsOverflow = Math.max(0, mutuals.length - mutualFriends.length)
  }

  const portraitFriendship: FriendPortraitFriendship | null = friendship
    ? {
        id: friendship.id,
        status: friendship.status,
        formedAt: friendship.formedAt,
        requestedByUserId: friendship.requestedByUserId,
        viewerIsRequester: friendship.requestedByUserId === normalizedViewerId,
      }
    : null

  return {
    user: {
      id: viewedUser.id,
      displayName: profileDisplayName(
        viewedUser.displayName,
        viewedUser.phoneNumber
      ),
      handle: viewedUser.handle?.trim() ? viewedUser.handle.trim() : null,
      tagline: viewedUser.tagline?.trim() ? viewedUser.tagline.trim() : null,
      location: viewedUser.location?.trim() ? viewedUser.location.trim() : null,
      bio: viewedUser.bio?.trim() ? viewedUser.bio.trim() : null,
      authorProfilePublic: viewedUser.authorProfilePublic,
      memberSince: viewedUser.createdAt,
    },
    visibility,
    friendship: portraitFriendship,
    interests,
    sharedInterests: interests
      .filter((interest) => interest.shared)
      .map((interest) => interest.domain),
    viewerSoloInterests,
    friendSoloInterests,
    mutualFriends,
    mutualFriendsOverflow,
  }
}
