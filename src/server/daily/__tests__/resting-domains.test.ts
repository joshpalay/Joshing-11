import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAILY_QUEUE_SIZE } from '@/server/daily/types';

// Same dependency-surface mock as queue-floor.test.ts: fillDailyQueueForUser
// touches @/server/db (which throws without a connection string), so the whole
// picker/generator surface is stubbed. This suite exercises ONLY how the
// orchestrator builds the allow-set it hands to the authored + house pickers —
// specifically that a "Resting" domain set on the Game settings page is excluded
// from Daily Five selection in random mode (custom mode drops rested domains
// from selectedDomains upstream, so it's already covered).
const mocks = vi.hoisted(() => ({
  getTodaysDailyQueue: vi.fn(),
  carryForwardUntouchedDailyQueue: vi.fn(),
  clearStaleShortTodayQueue: vi.fn(),
  countDailyQueues: vi.fn(),
  getKnowledgeBase: vi.fn(),
  pickEligibleAuthoredQuestions: vi.fn(),
  pickHouseQuestions: vi.fn(),
  createDailyQueueItem: vi.fn(),
  createDailyQueueItemFromAuthored: vi.fn(),
  createDailyQueueItemFromHouse: vi.fn(),
  createDailyQueueItemFromPresence: vi.fn(),
  getDailyPreferences: vi.fn(),
  getFriendAndFoFUserIds: vi.fn(),
  getFriendDomainsForBonus: vi.fn(),
  generateDailyQuestionsFromKnowledgeBase: vi.fn(),
  generateBonusQuestionsForDomains: vi.fn(),
  isGenericSubcategory: vi.fn(),
}));

vi.mock('@/server/db/queries/daily', () => ({
  getTodaysDailyQueue: mocks.getTodaysDailyQueue,
  carryForwardUntouchedDailyQueue: mocks.carryForwardUntouchedDailyQueue,
  clearStaleShortTodayQueue: mocks.clearStaleShortTodayQueue,
  countDailyQueues: mocks.countDailyQueues,
  getKnowledgeBase: mocks.getKnowledgeBase,
  pickEligibleAuthoredQuestions: mocks.pickEligibleAuthoredQuestions,
  pickHouseQuestions: mocks.pickHouseQuestions,
  createDailyQueueItem: mocks.createDailyQueueItem,
  createDailyQueueItemFromAuthored: mocks.createDailyQueueItemFromAuthored,
  createDailyQueueItemFromHouse: mocks.createDailyQueueItemFromHouse,
  createDailyQueueItemFromPresence: mocks.createDailyQueueItemFromPresence,
}));

vi.mock('@/server/db/queries/daily-preferences', () => ({
  getDailyPreferences: mocks.getDailyPreferences,
}));

vi.mock('@/server/db/queries/friends', () => ({
  getFriendAndFoFUserIds: mocks.getFriendAndFoFUserIds,
}));

vi.mock('@/server/db/queries/friend-presence-domains', () => ({
  getFriendDomainsForBonus: mocks.getFriendDomainsForBonus,
}));

vi.mock('@/server/daily/generate-questions', () => ({
  generateDailyQuestionsFromKnowledgeBase: mocks.generateDailyQuestionsFromKnowledgeBase,
  generateBonusQuestionsForDomains: mocks.generateBonusQuestionsForDomains,
}));

vi.mock('@/server/questions/canonical-subcategory', () => ({
  isGenericSubcategory: mocks.isGenericSubcategory,
}));

vi.mock('@/server/refine/commit', () => ({
  commitPendingRefineDecisions: vi.fn().mockResolvedValue(undefined),
}));

import { fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';

const USER = 'user-1';

function genq(id: string, subcategory = 'Opera') {
  return { id, questionText: `Question ${id}`, canonicalSubcategory: subcategory } as never;
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.getTodaysDailyQueue.mockResolvedValue(null);
  mocks.carryForwardUntouchedDailyQueue.mockResolvedValue(false);
  mocks.clearStaleShortTodayQueue.mockResolvedValue(false);
  // Returning player; this suite checks the resting allow-set, not first-run seeding.
  mocks.countDailyQueues.mockResolvedValue(3);

  mocks.pickEligibleAuthoredQuestions.mockResolvedValue([]);
  mocks.pickHouseQuestions.mockResolvedValue([]);
  mocks.getFriendAndFoFUserIds.mockResolvedValue({ direct: new Set(), extended: new Set() });
  mocks.getFriendDomainsForBonus.mockResolvedValue([]);
  mocks.generateBonusQuestionsForDomains.mockResolvedValue([]);
  mocks.isGenericSubcategory.mockReturnValue(false);

  // Enough generated questions to reach the full five so the build succeeds and
  // we can inspect the allow-set the pickers were called with.
  mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue(
    Array.from({ length: DAILY_QUEUE_SIZE }, (_, i) => genq(`q${i}`)),
  );

  mocks.createDailyQueueItem.mockResolvedValue(undefined);
  mocks.createDailyQueueItemFromAuthored.mockResolvedValue(undefined);
  mocks.createDailyQueueItemFromHouse.mockResolvedValue(undefined);
  mocks.createDailyQueueItemFromPresence.mockResolvedValue(undefined);
});

describe('fillDailyQueueForUser — Game settings categories drive selection', () => {
  it('excludes Resting domains from authored + house picks in random mode', async () => {
    mocks.getKnowledgeBase.mockResolvedValue([{ domain: 'Jazz' }, { domain: 'Opera' }]);
    mocks.getDailyPreferences.mockResolvedValue({
      difficulty: 'adaptive',
      domainMode: 'random',
      selectedDomains: [],
      // "Jazz" parked in the Resting zone on the Game settings page.
      domainPreferenceFrequency: { Jazz: 'resting', Opera: 'often' },
    });

    await fillDailyQueueForUser(USER);

    for (const picker of [mocks.pickEligibleAuthoredQuestions, mocks.pickHouseQuestions]) {
      expect(picker).toHaveBeenCalled();
      const allowed = picker.mock.calls[0].find(
        (arg): arg is ReadonlySet<string> => arg instanceof Set,
      );
      expect(allowed).toBeDefined();
      expect(allowed!.has('Jazz')).toBe(false);
      expect(allowed!.has('Opera')).toBe(true);
    }
  });

  it('passes the full knowledge base when nothing is Resting (random mode)', async () => {
    mocks.getKnowledgeBase.mockResolvedValue([{ domain: 'Jazz' }, { domain: 'Opera' }]);
    mocks.getDailyPreferences.mockResolvedValue({
      difficulty: 'adaptive',
      domainMode: 'random',
      selectedDomains: [],
      domainPreferenceFrequency: { Opera: 'often' },
    });

    await fillDailyQueueForUser(USER);

    const allowed = mocks.pickEligibleAuthoredQuestions.mock.calls[0].find(
      (arg): arg is ReadonlySet<string> => arg instanceof Set,
    );
    expect(allowed!.has('Jazz')).toBe(true);
    expect(allowed!.has('Opera')).toBe(true);
  });
});
