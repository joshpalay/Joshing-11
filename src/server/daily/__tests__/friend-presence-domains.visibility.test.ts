import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DomainMastery } from '@/server/db/queries/knowledge';
import type { SectionVisibility } from '@/server/profile/visibility';

// The +2 presence pool must honor the same `knowledge_base` SECTION visibility
// the profile enforces. These tests exercise the DB-backed
// `getFriendDomainsForBonus` with the REAL `canViewSection` predicate, mocking
// only the data-fetching helpers it composes.
//
// As of B-BONUS-FRIEND-DOMAIN-N1-01 the function fetches section visibility and
// friend domains in TWO set-based queries (`getSectionVisibilitiesBulk` +
// `getKnowledgePageDataForUsers`) instead of fanning out ~6 round-trips per
// followee, so the mocks here are the bulk variants.
const {
  getFollowingMock,
  getMutualFollowsMock,
  getKnowledgePageDataForUsersMock,
  getSectionVisibilitiesBulkMock,
  state,
} = vi.hoisted(() => {
  const state = {
    // friendId -> that friend's knowledge_base section visibility.
    sectionByFriend: new Map<string, SectionVisibility>(),
    // friendId -> the domains getKnowledgePageDataForUsers should return for them.
    // null means "use the default single self-named territory domain".
    domainsByFriend: null as Map<string, DomainMastery[]> | null,
  };
  return {
    getFollowingMock: vi.fn(),
    getMutualFollowsMock: vi.fn(async () => [] as Array<{ id: string }>),
    getKnowledgePageDataForUsersMock: vi.fn(),
    getSectionVisibilitiesBulkMock: vi.fn(
      async (userIds: readonly string[]) =>
        new Map(
          userIds.map((userId) => [
            userId,
            {
              knowledge_base: state.sectionByFriend.get(userId) ?? 'public',
              friends_list: 'friends' as SectionVisibility,
              authored_questions: 'public' as SectionVisibility,
            },
          ]),
        ),
    ),
    state,
  };
});

vi.mock('@/server/db/queries/friends', () => ({
  getFollowing: getFollowingMock,
  getMutualFollows: getMutualFollowsMock,
}));

vi.mock('@/server/db/queries/knowledge', () => ({
  getKnowledgePageDataForUsers: getKnowledgePageDataForUsersMock,
}));

// Keep the REAL `canViewSection` (the gate under test); mock only the DB read.
vi.mock('@/server/profile/visibility', async (importActual) => {
  const actual = await importActual<typeof import('@/server/profile/visibility')>();
  return { ...actual, getSectionVisibilitiesBulk: getSectionVisibilitiesBulkMock };
});

import { getFriendDomainsForBonus } from '@/server/db/queries/friend-presence-domains';

function territoryDomain(domain: string, over: Partial<DomainMastery> = {}): DomainMastery {
  return {
    domain,
    displayName: domain,
    points: 10,
    tier: 'novice',
    tierProgress: 0,
    questionsAnswered: 1,
    questionsCorrect: 1,
    correctRate: 1,
    lastActivityAt: null,
    broadCategory: 'music',
    iconKey: 'music',
    isDeclared: true,
    isDeclaredInterest: false,
    isDemonstrated: false,
    territoryType: 'declared',
    isHidden: false,
    ...over,
  };
}

// An activity-only domain: not declared/demonstrated (so NOT territory), but with
// recent `lastActivityAt` so `selectRecentlyExploring` surfaces it.
function activityDomain(domain: string, over: Partial<DomainMastery> = {}): DomainMastery {
  return territoryDomain(domain, {
    isDeclared: false,
    isDeclaredInterest: false,
    isDemonstrated: false,
    territoryType: 'demonstrated',
    lastActivityAt: new Date().toISOString(),
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sectionByFriend.clear();
  state.domainsByFriend = null;
  getMutualFollowsMock.mockResolvedValue([]);
  getKnowledgePageDataForUsersMock.mockImplementation(async (userIds: readonly string[]) => {
    const map = new Map<string, DomainMastery[]>();
    for (const userId of userIds) {
      map.set(userId, state.domainsByFriend?.get(userId) ?? [territoryDomain(`${userId}-domain`)]);
    }
    return map;
  });
});

describe('getFriendDomainsForBonus — knowledge_base section visibility gate', () => {
  it('a one-way followee with a public knowledge_base contributes its domains', async () => {
    getFollowingMock.mockResolvedValue([{ id: 'pub', displayName: 'Pub' }]);
    state.sectionByFriend.set('pub', 'public');

    const result = await getFriendDomainsForBonus('viewer', 2);
    expect(result.map((c) => c.domain)).toEqual(['pub-domain']);
  });

  it('a one-way followee with a friends-only knowledge_base contributes NOTHING', async () => {
    // Viewer follows `pal` but it is not mutual → effective viewer is a stranger,
    // so a `friends`-only knowledge base is hidden, exactly as on the profile.
    getFollowingMock.mockResolvedValue([{ id: 'pal', displayName: 'Pal' }]);
    getMutualFollowsMock.mockResolvedValue([]);
    state.sectionByFriend.set('pal', 'friends');

    const result = await getFriendDomainsForBonus('viewer', 2);
    expect(result).toEqual([]);
    // The gated-out friend is never even included in the batched domain fetch.
    const fetchedIds = getKnowledgePageDataForUsersMock.mock.calls.flatMap(([ids]) => [...ids]);
    expect(fetchedIds).not.toContain('pal');
  });

  it('a MUTUAL followee with a friends-only knowledge_base DOES contribute', async () => {
    getFollowingMock.mockResolvedValue([{ id: 'bestie', displayName: 'Bestie' }]);
    getMutualFollowsMock.mockResolvedValue([{ id: 'bestie' }]);
    state.sectionByFriend.set('bestie', 'friends');

    const result = await getFriendDomainsForBonus('viewer', 2);
    expect(result.map((c) => c.domain)).toEqual(['bestie-domain']);
  });

  it('a private knowledge_base contributes NOTHING even to a mutual followee', async () => {
    getFollowingMock.mockResolvedValue([{ id: 'bestie', displayName: 'Bestie' }]);
    getMutualFollowsMock.mockResolvedValue([{ id: 'bestie' }]);
    state.sectionByFriend.set('bestie', 'private');

    const result = await getFriendDomainsForBonus('viewer', 2);
    expect(result).toEqual([]);
  });

  it('mixes gated and visible followees, dropping only the hidden ones', async () => {
    getFollowingMock.mockResolvedValue([
      { id: 'pub', displayName: 'Pub' },
      { id: 'hidden', displayName: 'Hidden' },
    ]);
    getMutualFollowsMock.mockResolvedValue([]);
    state.sectionByFriend.set('pub', 'public');
    state.sectionByFriend.set('hidden', 'friends');

    const result = await getFriendDomainsForBonus('viewer', 2);
    expect(result.map((c) => c.domain)).toEqual(['pub-domain']);
  });
});

describe('getFriendDomainsForBonus — resting-domain opt-out', () => {
  it('drops a rested domain from the +2 pool ("This is {Name}’s bag but not mine")', async () => {
    getFollowingMock.mockResolvedValue([{ id: 'pub', displayName: 'Pub' }]);
    state.sectionByFriend.set('pub', 'public');
    // The viewer parked this exact friend-presence domain in "Resting".
    const result = await getFriendDomainsForBonus('viewer', 2, new Set(['pub-domain']));
    expect(result).toEqual([]);
  });

  it('matches rested domains case-insensitively and keeps the non-rested ones', async () => {
    getFollowingMock.mockResolvedValue([{ id: 'pub', displayName: 'Pub' }]);
    state.sectionByFriend.set('pub', 'public');
    state.domainsByFriend = new Map([['pub', [territoryDomain('Jazz'), territoryDomain('Opera')]]]);
    // 'JAZZ' rested (different case) should still be excluded; 'Opera' remains.
    const result = await getFriendDomainsForBonus('viewer', 2, new Set(['jazz']));
    expect(result.map((c) => c.domain)).toEqual(['Opera']);
  });
});

describe('getFriendDomainsForBonus — bounded query count (N+1 fan-out removed)', () => {
  // The fan-out this refactor killed was ~6 round-trips PER followee. The new
  // path resolves the whole followee set in a constant number of set-based
  // calls: one mutual-follows query, one bulk section-visibility query, and one
  // bulk knowledge-domain fetch — independent of how many people are followed.
  function seedFollowing(count: number) {
    const following = Array.from({ length: count }, (_, i) => ({
      id: `f${i}`,
      displayName: `Friend ${i}`,
    }));
    getFollowingMock.mockResolvedValue(following);
    for (const f of following) state.sectionByFriend.set(f.id, 'public');
    return following;
  }

  it('issues exactly one bulk visibility + one bulk domain query for 3 followees', async () => {
    seedFollowing(3);
    await getFriendDomainsForBonus('viewer', 2);
    expect(getSectionVisibilitiesBulkMock).toHaveBeenCalledTimes(1);
    expect(getKnowledgePageDataForUsersMock).toHaveBeenCalledTimes(1);
    expect(getMutualFollowsMock).toHaveBeenCalledTimes(1);
  });

  it('stays at the SAME call count for 30 followees — does not scale with follow count', async () => {
    seedFollowing(30);
    await getFriendDomainsForBonus('viewer', 2);
    // Constant regardless of followee count: NOT 30×, NOT 6×30.
    expect(getSectionVisibilitiesBulkMock).toHaveBeenCalledTimes(1);
    expect(getKnowledgePageDataForUsersMock).toHaveBeenCalledTimes(1);
    expect(getMutualFollowsMock).toHaveBeenCalledTimes(1);
    // Both bulk calls receive the whole surviving set in a single invocation.
    expect(getSectionVisibilitiesBulkMock.mock.calls[0][0]).toHaveLength(30);
    // 30 followees + the VIEWER, who rides along in the same batch so their own
    // domains can be subtracted from the pool. Still one call, still constant.
    expect(getKnowledgePageDataForUsersMock.mock.calls[0][0]).toHaveLength(31);
    expect(getKnowledgePageDataForUsersMock.mock.calls[0][0]).toContain('viewer');
  });
});

describe('getFriendDomainsForBonus — batched output equals per-friend behavior', () => {
  it('merges territory + activity across mixed mutual/stranger friends, gating the hidden one', async () => {
    // Sam (mutual, friends-only KB → visible): territory "Jazz".
    // Robyn (one-way, public KB → visible): activity "Jazz" (recent) + territory "Opera".
    //   → "Jazz" is seen as territory by one friend and activity by another ⇒ Both.
    // Pat (one-way, friends-only KB → stranger, hidden): would add "Film" but is gated out.
    getFollowingMock.mockResolvedValue([
      { id: 'sam', displayName: 'Sam' },
      { id: 'robyn', displayName: 'Robyn' },
      { id: 'pat', displayName: 'Pat' },
    ]);
    getMutualFollowsMock.mockResolvedValue([{ id: 'sam' }]);
    state.sectionByFriend.set('sam', 'friends');
    state.sectionByFriend.set('robyn', 'public');
    state.sectionByFriend.set('pat', 'friends');
    state.domainsByFriend = new Map([
      ['sam', [territoryDomain('Jazz')]],
      ['robyn', [activityDomain('Jazz'), territoryDomain('Opera')]],
      ['pat', [territoryDomain('Film')]],
    ]);

    const result = await getFriendDomainsForBonus('viewer', 5);

    // Hidden friend's "Film" never appears; "Jazz" merges to Both and outranks
    // the territory-only "Opera".
    expect(result.map((c) => c.domain)).toEqual(['Jazz', 'Opera']);
    const jazz = result.find((c) => c.domain === 'Jazz');
    expect(jazz?.signal).toBe('both');
    expect(jazz?.presenceSources.map((s) => s.userId).sort()).toEqual(['robyn', 'sam']);
    expect(result.some((c) => c.domain === 'Film')).toBe(false);
  });
});

describe("getFriendDomainsForBonus — the viewer's own domains never come back as a friend's", () => {
  // Regression: the +2 pool was handing players their OWN territory back under a
  // follower's name. A followee who answers a question in the viewer's domain
  // picks that domain up (as territory, or as bare activity) and it round-tripped
  // to the viewer as "from {Name}'s world". Observed in prod with a 781-point
  // declared domain of the viewer's being attributed to a followee who had zero
  // points in it. Both the module docstring and the queue orchestrator claimed
  // this subtraction existed; neither implemented it.
  it("drops a friend's territory domain that is already the viewer's own", async () => {
    getFollowingMock.mockResolvedValue([{ id: 'neil', displayName: 'Neil' }]);
    state.sectionByFriend.set('neil', 'public');
    state.domainsByFriend = new Map([
      ['neil', [territoryDomain('Beethoven'), territoryDomain('Pirates')]],
      ['viewer', [territoryDomain('Beethoven')]],
    ]);

    const result = await getFriendDomainsForBonus('viewer', 5);

    // "Beethoven" is the viewer's own; only the genuinely new domain survives.
    expect(result.map((c) => c.domain)).toEqual(['Pirates']);
  });

  it('matches the viewer\'s own domains case-insensitively', async () => {
    getFollowingMock.mockResolvedValue([{ id: 'neil', displayName: 'Neil' }]);
    state.sectionByFriend.set('neil', 'public');
    state.domainsByFriend = new Map([
      ['neil', [territoryDomain('UX Design')]],
      ['viewer', [territoryDomain('ux design')]],
    ]);

    expect(await getFriendDomainsForBonus('viewer', 5)).toEqual([]);
  });

  it("still excludes a viewer's own domain that the viewer has HIDDEN", async () => {
    // Hiding a domain on your own profile doesn't make it someone else's world.
    getFollowingMock.mockResolvedValue([{ id: 'neil', displayName: 'Neil' }]);
    state.sectionByFriend.set('neil', 'public');
    state.domainsByFriend = new Map([
      ['neil', [territoryDomain('Beethoven')]],
      ['viewer', [territoryDomain('Beethoven', { isHidden: true })]],
    ]);

    expect(await getFriendDomainsForBonus('viewer', 5)).toEqual([]);
  });

  it('leaves the pool untouched when the viewer and friend share nothing', async () => {
    getFollowingMock.mockResolvedValue([{ id: 'neil', displayName: 'Neil' }]);
    state.sectionByFriend.set('neil', 'public');
    state.domainsByFriend = new Map([
      ['neil', [territoryDomain('Pirates')]],
      ['viewer', [territoryDomain('Beethoven')]],
    ]);

    expect((await getFriendDomainsForBonus('viewer', 5)).map((c) => c.domain)).toEqual(['Pirates']);
  });
});

describe('getFriendDomainsForBonus — activity needs a correct answer, not just an answer', () => {
  // `selectRecentlyExploring` gates only on recency + !isHidden, which is right
  // for the profile's own "Recently exploring" section but too loose to promote a
  // domain into someone ELSE's Daily Five. In prod a followee answered three
  // questions, got all three WRONG (0 points, no mastery row), and those domains
  // became "{Name}'s world" for everyone following them.
  it('drops an activity-only domain the friend has never answered correctly', async () => {
    getFollowingMock.mockResolvedValue([{ id: 'neil', displayName: 'Neil' }]);
    state.sectionByFriend.set('neil', 'public');
    state.domainsByFriend = new Map([
      ['neil', [activityDomain('Beethoven', { questionsAnswered: 1, questionsCorrect: 0, correctRate: 0 })]],
      ['viewer', []],
    ]);

    expect(await getFriendDomainsForBonus('viewer', 5)).toEqual([]);
  });

  it('keeps an activity-only domain once the friend has one correct answer', async () => {
    getFollowingMock.mockResolvedValue([{ id: 'neil', displayName: 'Neil' }]);
    state.sectionByFriend.set('neil', 'public');
    state.domainsByFriend = new Map([
      ['neil', [activityDomain('Beethoven', { questionsAnswered: 2, questionsCorrect: 1, correctRate: 0.5 })]],
      ['viewer', []],
    ]);

    const result = await getFriendDomainsForBonus('viewer', 5);
    expect(result.map((c) => c.domain)).toEqual(['Beethoven']);
    expect(result[0]?.signal).toBe('activity');
  });

  it('does NOT apply the correctness floor to territory — a declared domain stands on its own', async () => {
    // Declaring a domain is a first-party claim; it does not need a correct
    // answer behind it. Only the activity path gets the floor.
    getFollowingMock.mockResolvedValue([{ id: 'neil', displayName: 'Neil' }]);
    state.sectionByFriend.set('neil', 'public');
    state.domainsByFriend = new Map([
      ['neil', [territoryDomain('Opera', { questionsAnswered: 1, questionsCorrect: 0, correctRate: 0 })]],
      ['viewer', []],
    ]);

    const result = await getFriendDomainsForBonus('viewer', 5);
    expect(result.map((c) => c.domain)).toEqual(['Opera']);
    expect(result[0]?.signal).toBe('territory');
  });
});
