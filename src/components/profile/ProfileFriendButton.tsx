'use client'

import { useRouter } from 'next/navigation'

import { AddFriendButton } from '@/components/friends/AddFriendButton'
import type { RelationshipResult } from '@/server/db/queries/friend-requests'

type ProfileFriendButtonProps = {
  targetUserId: string
  // The viewer's directional relationship to this profile (follow model).
  // `null` only on a profile with no edge in either direction — treated as a
  // fresh "none" relationship.
  relationship: RelationshipResult | null
  targetDisplayName: string
}

const NO_RELATIONSHIP: RelationshipResult = {
  state: 'none',
  friendshipId: null,
  formedAt: null,
  isBlocked: false,
}

export function ProfileFriendButton({
  targetUserId,
  relationship,
  targetDisplayName,
}: ProfileFriendButtonProps) {
  const router = useRouter()

  return (
    <div className="mt-4">
      <AddFriendButton
        targetUserId={targetUserId}
        targetDisplayName={targetDisplayName}
        relationship={relationship ?? NO_RELATIONSHIP}
        onChange={() => router.refresh()}
      />
    </div>
  )
}
