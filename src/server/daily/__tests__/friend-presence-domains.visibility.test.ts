import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DomainMastery } from '@/server/db/queries/knowledge';
import type { SectionVisibility } from '@/server/profile/visibility';

// The +2 presence pool must honor the same `knowledge_base` SECTION visibility
// the profile enforces. These tests exercise the DB-backed
// `getFriendDomainsForBonus` with the REAL `canViewSection` predicate, mocking
// only the data-fetching helpers it composes.
const { getFollowingMock, getMutualFollowsMock, getKnowledgePageDataMock, getSectionVisibilitiesMock, state } =
  vi.hoisted(() => {
    const state = {
      // friendId -> that friend's knowledge_base section visibility.
      sectionByFriend: new Map<string, SectionVisibility>(),
    };
    return {
      getFollowingMock: vi.fn(),
      getMutualFollowsMock: vi.fn(async () => [] as Array<{ id: string }>),
      getKnowledgePageDataMock: vi.fn(),
      getSectionVisibilitiesMock: vi.fn(async (userId: string) => ({
        knowledge_base: state.sectionByFriend.get(userId) ?? 'public',
        friends_list: 'friends' as SectionVisibility,
        authored_questions: 'public' as SectionVisibility,
      })),
      state,
    };
  });

vi.mock('@/server/db/queries/friends', () => ({
  getFollowing: getFollowingMock,
  getMutualFollows: getMutualFollowsMock,
}));

vi.mock('@/server/db/queries/knowledge', () => ({
  getKnowledgePageData: getKnowledgePageDataMock,
}));

// Keep the REAL `canViewSection` (the gate under test); mock only the DB read.
vi.mock('@/server/profile/visibility', async (importActual) => {
  const actual = await importActual<typeof import('@/server/profile/visibility')>();
  return { ...actual, getSectionVisibilities: getSectionVisibilitiesMock };
});

import { getFriendDomainsForBonus } from '@/server/db/queries/friend-presence-domains';

function territoryDomain(domain: string): DomainMastery {
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sectionByFriend.clear();
  getMutualFollowsMock.mockResolvedValue([]);
  getKnowledgePageDataMock.mockImplementation(async (friendId: string) => ({
    allDomains: [territoryDomain(`${friendId}-domain`)],
    declaredInterests: [],
    expandingDomains: [],
  }));
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
    // We don't even need their knowledge map once the section is gated out.
    expect(getKnowledgePageDataMock).not.toHaveBeenCalledWith('pal');
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
