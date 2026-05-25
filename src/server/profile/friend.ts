import { and, asc, eq, inArray } from 'drizzle-orm'

import { db, declaredInterests } from '@/server/db'
import { areFriends, getFriends, getFriendship } from '@/server/db/queries/friends'
import { getUserById } from '@/server/db/queries/users'
import type { PreviewAs } from '@/server/profile/preview'
import {
  canViewSection,
  getSectionVisibilities,
  PROFILE_SECTIONS,
  type EffectiveViewer,
  type ProfileSection,
  type SectionVisibility,
} from '@/server/profile/visibility'

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
  // True iff the requester is the profile owner. Distinct from
  // `visibility === 'self'` only when `previewedAs` is set (in which
  // case `visibility` reflects the simulated viewer but `isOwnerView`
  // still reports the underlying truth). Pages use this to gate
  // owner-only UI like the gear icon and the Preview-as button.
  isOwnerView: boolean
  // The owner's per-section visibility choices. Only populated when
  // `isOwnerView` is true so non-owners can't introspect another
  // user's settings via the portrait API.
  sectionSettings: Record<ProfileSection, SectionVisibility> | null
  // Per-section gate evaluated against the EFFECTIVE viewer (i.e. the
  // simulated viewer when `previewedAs` is set). Pages render each
  // section behind `sectionVisibleTo[section]`. Phase 2 only widens
  // the contract — the page does not yet consume these fields.
  sectionVisibleTo: Record<ProfileSection, boolean>
  // The kind of viewer being simulated by `?previewAs=`, or null when
  // no preview is active. Pages use this to show the preview banner
  // and hide owner-only controls during preview.
  previewedAs: 'stranger' | 'friend' | null
}

function profileDisplayName(
  name: string | null,
  fallback: string | null = 'Joshing friend'
) {
  return name?.trim() || fallback?.trim() || 'Joshing friend'
}

// Match interests regardless of case, punctuation, or whitespace so that
// e.g. "Star Trek: The Next Generation" overlaps with "Star Trek The Next Generation".
function normalizeInterestKey(domain: string): string {
  return domain.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export async function getFriendPortraitData(
  userId: string,
  viewerId: string,
  previewAs?: PreviewAs | null
): Promise<FriendPortraitData | null> {
  const normalizedUserId = userId.trim()
  const normalizedViewerId = viewerId.trim()
  if (!normalizedUserId || !normalizedViewerId) return null

  const viewedUser = await getUserById(normalizedUserId)
  if (!viewedUser) return null

  const isOwnerView = normalizedUserId === normalizedViewerId
  const friendship = isOwnerView
    ? null
    : await getFriendship(normalizedViewerId, normalizedUserId)

  const isActiveFriend = !isOwnerView && friendship?.status === 'active'
  const realViewer: FriendProfileVisibility = isOwnerView
    ? 'self'
    : isActiveFriend
      ? 'friend'
      : 'stranger'

  // `previewAs` is only honored when the requester is the owner.
  // `resolvePreviewAs` already enforces this server-side, but we double-
  // check here so a misuse from another caller can't bypass it.
  const activePreview: PreviewAs | null = isOwnerView ? (previewAs ?? null) : null
  let effectiveViewer: EffectiveViewer = realViewer
  let previewedAs: 'stranger' | 'friend' | null = null
  if (activePreview === 'stranger') {
    effectiveViewer = 'stranger'
    previewedAs = 'stranger'
  } else if (activePreview === 'friend') {
    effectiveViewer = 'friend'
    previewedAs = 'friend'
  } else if (activePreview && typeof activePreview === 'object') {
    // Specific-user preview: resolve based on whether THAT user is an
    // active friend of the owner (the viewed user). The requester's own
    // friendships are irrelevant — we're simulating what the target
    // would see when they look at the owner's profile.
    const targetIsFriend = await areFriends(activePreview.userId, normalizedUserId)
    effectiveViewer = targetIsFriend ? 'friend' : 'stranger'
    previewedAs = targetIsFriend ? 'friend' : 'stranger'
  }

  // `visibility` continues to reflect the EFFECTIVE viewer so existing
  // call sites (the page's stranger short-circuit at users/[id]/page.tsx:74,
  // the section gates in Phase 4+) behave correctly when preview is on.
  const visibility: FriendProfileVisibility = effectiveViewer

  // Data fetching below mirrors the REAL viewer's relationship to the
  // owner, not the effective (previewed) viewer — preview only affects
  // visibility gates. Phase 5 may revisit interest/mutual semantics if
  // previewing as a friend should expose different counts.
  const interestOwnerIds = isOwnerView
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

  const viewerInterestsByKey = new Map<string, string>()
  for (const interest of interestRows) {
    if (interest.userId !== normalizedViewerId) continue
    viewerInterestsByKey.set(
      normalizeInterestKey(interest.domain),
      interest.domain
    )
  }

  const interests = interestRows
    .filter((interest) => interest.userId === normalizedUserId)
    .map((interest) => ({
      domain: interest.domain,
      broadCategory: interest.broadCategory,
      shared:
        isActiveFriend &&
        viewerInterestsByKey.has(normalizeInterestKey(interest.domain)),
    }))

  const friendInterestKeys = new Set(
    interests.map((i) => normalizeInterestKey(i.domain))
  )
  const viewerSoloInterests = isActiveFriend
    ? Array.from(viewerInterestsByKey.values())
        .filter((domain) => !friendInterestKeys.has(normalizeInterestKey(domain)))
        .sort((a, b) => a.localeCompare(b))
    : []
  const friendSoloInterests = isActiveFriend
    ? interests.filter((interest) => !interest.shared).map((i) => i.domain)
    : []

  let mutualFriends: FriendPortraitMutualFriend[] = []
  let mutualFriendsOverflow = 0
  if (!isOwnerView) {
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

  // Batch-fetch the owner's per-section visibility settings exactly once,
  // then evaluate the gate purely against the effective viewer. Owners
  // get the full settings map back (for editing UI); other viewers get
  // null so they can't introspect another user's choices.
  const sectionSettings = await getSectionVisibilities(normalizedUserId)
  const sectionVisibleTo: Record<ProfileSection, boolean> = Object.fromEntries(
    PROFILE_SECTIONS.map((section) => [
      section,
      canViewSection(sectionSettings, section, effectiveViewer),
    ])
  ) as Record<ProfileSection, boolean>

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
    isOwnerView,
    sectionSettings: isOwnerView ? sectionSettings : null,
    sectionVisibleTo,
    previewedAs,
  }
}
