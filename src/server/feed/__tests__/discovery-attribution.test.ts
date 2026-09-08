import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  composeDiscoveryAttribution,
  getDiscoveryAttributionForItems,
  type DiscoveryItemInput,
  type DiscoveryPerson,
} from '@/server/feed/discovery-attribution';

// getDiscoveryAttributionForItems (the DB-touching half, exercised by the
// B-FRIENDS-SAFETY-01 block-gate test below) needs its collaborators mocked.
const { getRelationshipsMock, getNicheMatchDiscoverableMock, getForwardDiscoverableMock, dbMock } = vi.hoisted(() => ({
  getRelationshipsMock: vi.fn(),
  getNicheMatchDiscoverableMock: vi.fn(async () => new Set<string>()),
  getForwardDiscoverableMock: vi.fn(async () => new Set<string>()),
  dbMock: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => []) })),
    })),
  },
}));

vi.mock('@/server/db', () => ({ db: dbMock, users: { id: 'users.id', displayName: 'users.displayName' } }));
vi.mock('@/server/db/queries/account', () => ({
  getNicheMatchDiscoverable: getNicheMatchDiscoverableMock,
  getForwardDiscoverable: getForwardDiscoverableMock,
}));
vi.mock('@/server/db/queries/friend-requests', () => ({ getRelationships: getRelationshipsMock }));

const VIEWER = 'viewer';

// A name resolver that returns a stable person for any id (the DB layer would
// have filtered to resolvable ids before calling compose).
const person = (userId: string): DiscoveryPerson => ({
  userId,
  displayName: userId.toUpperCase(),
  href: `/users/${userId}`,
});

function compose(
  items: DiscoveryItemInput[],
  opts: {
    strangers?: string[];
    authorOptedIn?: string[];
    forwardOptedIn?: string[];
  } = {},
) {
  return composeDiscoveryAttribution(items, {
    viewerUserId: VIEWER,
    strangerIds: new Set(opts.strangers ?? []),
    authorOptedIn: new Set(opts.authorOptedIn ?? []),
    forwardOptedIn: new Set(opts.forwardOptedIn ?? []),
    person,
  });
}

describe('composeDiscoveryAttribution', () => {
  it('surfaces both author and via when each is a stranger + opted-in + public', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: 'maria', viaUserId: 'butt', isPublic: true }],
      { strangers: ['maria', 'butt'], authorOptedIn: ['maria'], forwardOptedIn: ['butt'] },
    );
    expect(result.get('f1')).toEqual({
      author: person('maria'),
      via: person('butt'),
    });
  });

  it('drops a non-public question entirely (gates both signals)', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: 'maria', viaUserId: 'butt', isPublic: false }],
      { strangers: ['maria', 'butt'], authorOptedIn: ['maria'], forwardOptedIn: ['butt'] },
    );
    expect(result.has('f1')).toBe(false);
  });

  it('excludes the viewer from their own author/via slots', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: VIEWER, viaUserId: VIEWER, isPublic: true }],
      { strangers: [VIEWER], authorOptedIn: [VIEWER], forwardOptedIn: [VIEWER] },
    );
    expect(result.has('f1')).toBe(false);
  });

  it('drops a non-stranger (existing relationship) even when opted in', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: 'maria', viaUserId: 'butt', isPublic: true }],
      { strangers: ['maria'], authorOptedIn: ['maria'], forwardOptedIn: ['butt'] }, // butt not a stranger
    );
    expect(result.get('f1')).toEqual({ author: person('maria') });
  });

  it('drops a stranger who has not opted in', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: 'maria', viaUserId: 'butt', isPublic: true }],
      { strangers: ['maria', 'butt'], authorOptedIn: [], forwardOptedIn: ['butt'] }, // maria not opted in
    );
    expect(result.get('f1')).toEqual({ via: person('butt') });
  });

  it('collapses to author only when author and via are the same person (author leads)', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: 'butt', viaUserId: 'butt', isPublic: true }],
      { strangers: ['butt'], authorOptedIn: ['butt'], forwardOptedIn: ['butt'] },
    );
    expect(result.get('f1')).toEqual({ author: person('butt') });
    expect(result.get('f1')?.via).toBeUndefined();
  });

  it('omits items with neither signal surviving', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: null, viaUserId: null, isPublic: true }],
      { strangers: [] },
    );
    expect(result.size).toBe(0);
  });
});

describe('getDiscoveryAttributionForItems — B-FRIENDS-SAFETY-01 block gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNicheMatchDiscoverableMock.mockResolvedValue(new Set());
    getForwardDiscoverableMock.mockResolvedValue(new Set());
  });

  // Done-When: "a blocked pair with no prior follow edge (state: 'none')
  // does not appear in each other's ... forward discovery surface." A
  // blocked stranger's relationship state is still 'none' (no follow edge),
  // so the strangerIds filter must ALSO consult isBlocked, not just state.
  it('excludes a blocked candidate from strangerIds even though state is none', async () => {
    getRelationshipsMock.mockResolvedValue(
      new Map([['blocked-author', { state: 'none', friendshipId: null, formedAt: null, isBlocked: true }]]),
    );
    // If the block gate were missing, this opt-in flag would let the author through.
    getNicheMatchDiscoverableMock.mockResolvedValue(new Set(['blocked-author']));

    const items: DiscoveryItemInput[] = [
      { feedItemId: 'f1', authorUserId: 'blocked-author', viaUserId: null, isPublic: true },
    ];
    const result = await getDiscoveryAttributionForItems(VIEWER, items);

    expect(result.size).toBe(0);
    // strangerIds is empty once the blocked id is excluded, so the function
    // short-circuits before the opt-in lookups run at all.
    expect(getNicheMatchDiscoverableMock).not.toHaveBeenCalled();
    expect(getForwardDiscoverableMock).not.toHaveBeenCalled();
  });

  it('still surfaces an un-blocked, opted-in stranger', async () => {
    getRelationshipsMock.mockResolvedValue(
      new Map([['clean-author', { state: 'none', friendshipId: null, formedAt: null, isBlocked: false }]]),
    );
    getNicheMatchDiscoverableMock.mockResolvedValue(new Set(['clean-author']));
    dbMock.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ id: 'clean-author', displayName: 'Clean Author' }]),
      })),
    });

    const items: DiscoveryItemInput[] = [
      { feedItemId: 'f1', authorUserId: 'clean-author', viaUserId: null, isPublic: true },
    ];
    const result = await getDiscoveryAttributionForItems(VIEWER, items);

    expect(result.get('f1')?.author?.userId).toBe('clean-author');
  });
});
