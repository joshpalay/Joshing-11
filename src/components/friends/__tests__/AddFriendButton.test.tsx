import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AddFriendButton } from '@/components/friends/AddFriendButton';
import type { RelationshipResult } from '@/server/db/queries/friend-requests';

function relationship(state: RelationshipResult['state']): RelationshipResult {
  return {
    state,
    friendshipId: state === 'friends' || state === 'following' ? 'friendship-1' : null,
    formedAt: null,
    isBlocked: false,
  };
}

describe('AddFriendButton removal copy', () => {
  it('uses unfriend language for accepted friends', () => {
    const html = renderToStaticMarkup(
      <AddFriendButton
        targetUserId="friend-1"
        targetDisplayName="Jordan"
        relationship={relationship('friends')}
      />,
    );

    expect(html).toContain('Friends ✓');
    expect(html).toContain('Unfriend');
    expect(html).not.toContain('Unfollow');
  });

  it('keeps unfollow language for one-way relationships', () => {
    const html = renderToStaticMarkup(
      <AddFriendButton
        targetUserId="person-1"
        targetDisplayName="Jordan"
        relationship={relationship('following')}
      />,
    );

    expect(html).toContain('Following ✓');
    expect(html).toContain('Unfollow');
  });
});
