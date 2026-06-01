'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { AddFriendButton } from '@/components/friends/AddFriendButton';
import type { RelationshipResult } from '@/server/db/queries/friend-requests';

type FriendshipShape = {
  id: string;
  status: string;
  viewerIsRequester: boolean;
} | null;

type ProfileFriendButtonProps = {
  targetUserId: string;
  friendship: FriendshipShape;
  targetDisplayName: string;
};

// Derives a RelationshipResult from the limited shape the profile page
// passes today. We don't surface "recently_sent" here — the profile is
// not a re-send surface, and FriendPortraitData doesn't carry resolvedAt.
// If a recently-sent state is ever needed on profiles, expand
// getFriendPortraitData to pass resolvedAt and refine this mapping.
function deriveRelationship(friendship: FriendshipShape): RelationshipResult {
  if (!friendship) {
    return { state: 'none', friendshipId: null, isBlocked: false };
  }
  if (friendship.status === 'active') {
    return { state: 'friends', friendshipId: friendship.id, isBlocked: false };
  }
  if (friendship.status === 'pending') {
    return {
      state: friendship.viewerIsRequester ? 'pending_outbound' : 'pending_inbound',
      friendshipId: friendship.id,
      isBlocked: false,
    };
  }
  return { state: 'none', friendshipId: null, isBlocked: false };
}

export function ProfileFriendButton({
  targetUserId,
  friendship,
  targetDisplayName,
}: ProfileFriendButtonProps) {
  const router = useRouter();
  const relationship = useMemo(() => deriveRelationship(friendship), [friendship]);

  return (
    <div className="mt-4">
      <AddFriendButton
        targetUserId={targetUserId}
        targetDisplayName={targetDisplayName}
        relationship={relationship}
        onChange={() => router.refresh()}
      />
    </div>
  );
}
