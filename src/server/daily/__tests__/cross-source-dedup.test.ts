import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAILY_QUEUE_SIZE } from '@/server/daily/types';

// Regression: a daily once served two adjacent "The Inner Light" Picard
// questions — one authored, one LLM-generated — both answered "a Ressikan
// flute". They have DIFFERENT question text and DIFFERENT canonical_subcategory
// labels ("Star Trek" vs "Star Trek: The Next Generation"), so the
// orchestrator's exact-text cross-source dedup let both through. The fix adds a
// fact signature (normalized answer scoped to a coarse domain key) so re-worded
// copies of the same trivia collapse. This test pins that behaviour without a DB
// by mocking the picker/generator surface, exactly like queue-floor.test.ts.
const mocks = vi.hoisted(() => ({
  getTodaysDailyQueue: vi.fn(),
  carryForwardUntouchedDailyQueue: vi.fn(),
  clearStaleShortTodayQueue: vi.fn(),
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

import { fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';

const USER = 'user-1';

// The orchestrator reads questionText/answerText/canonicalSubcategory off
// authored picks; the rest of the row is passed opaquely to the (mocked)
// persistence helper.
function authoredPick(
  id: string,
  questionText: string,
  answerText: string,
  canonicalSubcategory: string,
) {
  return { id, questionId: id, questionText, answerText, canonicalSubcategory, broadCategory: null } as never;
}

// Generated rows expose answer + canonicalSubcategory + questionText + id.
function genq(id: string, answer: string, canonicalSubcategory: string, questionText = `Question ${id}`) {
  return { id, questionText, answer, canonicalSubcategory } as never;
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.getTodaysDailyQueue.mockResolvedValue(null);
  mocks.carryForwardUntouchedDailyQueue.mockResolvedValue(false);
  mocks.clearStaleShortTodayQueue.mockResolvedValue(false);

  mocks.getKnowledgeBase.mockResolvedValue([{ domain: 'Star Trek: The Next Generation' }]);
  mocks.getDailyPreferences.mockResolvedValue({
    difficulty: 'adaptive',
    domainMode: 'random',
    selectedDomains: [],
  });
  mocks.pickHouseQuestions.mockResolvedValue([]);
  mocks.getFriendAndFoFUserIds.mockResolvedValue({ direct: new Set(), extended: new Set() });
  mocks.getFriendDomainsForBonus.mockResolvedValue([]);
  mocks.generateBonusQuestionsForDomains.mockResolvedValue([]);
  mocks.isGenericSubcategory.mockReturnValue(false);

  mocks.createDailyQueueItem.mockResolvedValue(undefined);
  mocks.createDailyQueueItemFromAuthored.mockResolvedValue(undefined);
  mocks.createDailyQueueItemFromHouse.mockResolvedValue(undefined);
  mocks.createDailyQueueItemFromPresence.mockResolvedValue(undefined);
});

describe('fillDailyQueueForUser — cross-source fact dedup', () => {
  it('drops an LLM question that re-words an authored fact (the Ressikan-flute regression)', async () => {
    mocks.pickEligibleAuthoredQuestions.mockResolvedValue([
      authoredPick(
        'authored-flute',
        "In the TNG episode 'The Inner Light,' Picard lives an entire lifetime as a man named Katan on a dying alien world, all while comatose for 25 minutes. What instrument does he keep when he wakes?",
        'A Ressikan flute (a small flute)',
        'Star Trek',
      ),
    ]);
    // The generated batch leads with a re-worded copy of the same fact, then
    // distinct fillers. Only the duplicate should be dropped.
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      genq(
        'gen-flute-dup',
        'a Ressikan flute (a penny whistle / Katan’s flute)',
        'Star Trek: The Next Generation',
        "In 'Star Trek: The Next Generation,' the episode 'The Inner Light' features Picard living an entire lifetime as a man named Katan. What does he learn to play?",
      ),
      genq('g1', 'William Riker', 'Star Trek: The Next Generation'),
      genq('g2', 'Locutus of Borg', 'Star Trek: The Next Generation'),
      genq('g3', 'Gul Madred', 'Star Trek: The Next Generation'),
      genq('g4', 'Darmok and Jalad at Tanagra', 'Star Trek: The Next Generation'),
    ]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    // The authored copy is kept and persisted...
    expect(mocks.createDailyQueueItemFromAuthored).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ id: 'authored-flute' }),
      0,
    );
    // ...and the re-worded LLM copy is never written to the queue.
    expect(mocks.createDailyQueueItem).not.toHaveBeenCalledWith(USER, 'gen-flute-dup', expect.anything());
    // The queue still fills (authored flute + 4 distinct generated = 5).
    expect(mocks.createDailyQueueItem).toHaveBeenCalledTimes(DAILY_QUEUE_SIZE - 1);
  });

  it('keeps a same-answer question in a different domain (signature is domain-scoped)', async () => {
    // Guard against over-dedup: an identical answer about a different subject is
    // a different fact, so the coarse domain key must keep them apart.
    mocks.pickEligibleAuthoredQuestions.mockResolvedValue([
      authoredPick(
        'authored-flute',
        "Which instrument does Picard keep from 'The Inner Light'?",
        'A Ressikan flute (a small flute)',
        'Star Trek',
      ),
    ]);
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      // Same normalized answer ("ressikan flute") but a different domain.
      genq('gen-other-domain', 'A Ressikan flute', 'Baroque Woodwind Instruments'),
      genq('g1', 'William Riker', 'Star Trek: The Next Generation'),
      genq('g2', 'Locutus of Borg', 'Star Trek: The Next Generation'),
      genq('g3', 'Gul Madred', 'Star Trek: The Next Generation'),
    ]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    // The different-domain question survives and is persisted.
    expect(mocks.createDailyQueueItem).toHaveBeenCalledWith(USER, 'gen-other-domain', expect.anything());
  });
});
