import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, state } = vi.hoisted(() => {
  const state = {
    friendshipRows: [] as Array<{ userAId: string; userBId: string }>,
    userRows: [] as Array<{
      id: string;
      phoneNumber: string;
      displayName: string | null;
    }>,
    selectCount: 0,
  };

  function makeWhereBuilder(rows: unknown[]) {
    return {
      // where() must be BOTH awaitable (the friendships query awaits it
      // directly) AND chainable into orderBy/limit (the users query does
      // .where().orderBy(...)). Return a promise with the chain methods
      // attached so both call shapes resolve to the same rows.
      where: vi.fn(() => {
        const p = Promise.resolve(rows) as Promise<unknown[]> & {
          orderBy: () => Promise<unknown[]>;
          limit: () => Promise<unknown[]>;
        };
        p.orderBy = vi.fn(async () => rows);
        p.limit = vi.fn(async () => rows);
        return p;
      }),
    };
  }

  const dbMock = {
    select: vi.fn(() => {
      state.selectCount += 1;
      const rows = state.selectCount === 1 ? state.friendshipRows : state.userRows;
      return {
        from: vi.fn(() => makeWhereBuilder(rows)),
      };
    }),
  };

  return { dbMock, state };
});

vi.mock('@/server/db', () => ({
  db: dbMock,
  declaredInterests: {
    userId: 'declaredInterests.userId',
    domain: 'declaredInterests.domain',
    isActive: 'declaredInterests.isActive',
  },
  friendships: {
    id: 'friendships.id',
    userAId: 'friendships.userAId',
    userBId: 'friendships.userBId',
    status: 'friendships.status',
    requestedByUserId: 'friendships.requestedByUserId',
    requestContext: 'friendships.requestContext',
    createdAt: 'friendships.createdAt',
  },
  users: {
    id: 'users.id',
    phoneNumber: 'users.phoneNumber',
    displayName: 'users.displayName',
  },
}));

import { getFriends } from '@/server/db/queries/friends';

describe('getFriends invitation friendship symmetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.friendshipRows = [];
    state.userRows = [];
    state.selectCount = 0;
  });

  it('getFriends(Jaime) includes Josh after an active invitation friendship', async () => {
    state.friendshipRows = [{ userAId: 'user-jaime', userBId: 'user-josh' }];
    state.userRows = [{ id: 'user-josh', displayName: 'Josh', phoneNumber: '+17345550001' }];

    await expect(getFriends('user-jaime')).resolves.toEqual([
      expect.objectContaining({ id: 'user-josh', displayName: 'Josh' }),
    ]);
  });

  it('getFriends(Josh) includes Jaime from the same active invitation friendship', async () => {
    state.friendshipRows = [{ userAId: 'user-jaime', userBId: 'user-josh' }];
    state.userRows = [{ id: 'user-jaime', displayName: 'Jaime', phoneNumber: '+17345550002' }];

    await expect(getFriends('user-josh')).resolves.toEqual([
      expect.objectContaining({ id: 'user-jaime', displayName: 'Jaime' }),
    ]);
  });
});
