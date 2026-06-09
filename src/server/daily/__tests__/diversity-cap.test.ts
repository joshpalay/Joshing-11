import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAILY_QUEUE_MAX_PER_SUBCATEGORY, DAILY_QUEUE_SIZE } from '@/server/daily/types';

// Same wholesale-mock strategy as queue-floor.test.ts: fillDailyQueueForUser
// orchestrates DB pickers + LLM generation, all of which touch @/server/db (which
// throws at module load without a connection string). Mock the entire dependency
// surface so these tests exercise ONLY the orchestrator's intra-day diversity cap
// (the "5-question botany run" / "3-Hamlet day" lever).
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

import { fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';

const USER = 'user-1';

// Minimal stand-in for a generated question row — the orchestrator only reads
// id, questionText, and canonicalSubcategory.
function genq(id: string, subcategory: string) {
  return { id, questionText: `Question ${id}`, canonicalSubcategory: subcategory } as never;
}

// Minimal stand-in for an authored/house pick — the orchestrator reads
// canonicalSubcategory for the cap and questionText for cross-source dedup.
function authoredPick(id: string, subcategory: string) {
  return {
    id,
    creatorId: `creator-${id}`,
    questionText: `Authored ${id}`,
    canonicalSubcategory: subcategory,
    broadCategory: null,
    category: '',
    authorName: null,
    authorNote: null,
  } as never;
}

/** The canonicalSubcategory each generated slot was persisted under, in slot order. */
function persistedGeneratedDomains(generatedRows: ReturnType<typeof genq>[]): string[] {
  const byId = new Map(
    generatedRows.map((row) => {
      const q = row as unknown as { id: string; canonicalSubcategory: string };
      return [q.id, q.canonicalSubcategory] as const;
    }),
  );
  return mocks.createDailyQueueItem.mock.calls.map((call) => byId.get(call[1] as string) ?? '?');
}

beforeEach(() => {
  vi.clearAllMocks();

  // Fresh build path: no existing queue, nothing to carry forward.
  mocks.getTodaysDailyQueue.mockResolvedValue(null);
  mocks.carryForwardUntouchedDailyQueue.mockResolvedValue(false);
  mocks.clearStaleShortTodayQueue.mockResolvedValue(false);
  mocks.countDailyQueues.mockResolvedValue(3);

  // A broad knowledge base (≥3 domains) so the effective cap stays at the base
  // DAILY_QUEUE_MAX_PER_SUBCATEGORY rather than scaling up for a thin KB.
  mocks.getKnowledgeBase.mockResolvedValue([
    { domain: 'Botany' },
    { domain: 'Hamlet' },
    { domain: 'Jazz' },
    { domain: 'Astronomy' },
    { domain: 'Cartography' },
  ]);
  mocks.getDailyPreferences.mockResolvedValue({
    difficulty: 'adaptive',
    domainMode: 'random',
    selectedDomains: [],
    domainPreferenceFrequency: {},
  });
  mocks.pickEligibleAuthoredQuestions.mockResolvedValue([]);
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

describe('fillDailyQueueForUser — intra-day diversity cap', () => {
  it('holds the cap across the initial pass AND top-up rounds', async () => {
    // The cap state is shared across the first generation pass and every top-up
    // round, so a botany cluster spread over rounds is still spaced out. First pass:
    // three botany (two admitted, one reserved) + one jazz; top-up round brings two
    // fresh domains that finish the diverse five.
    const rows = [
      genq('b1', 'Botany'),
      genq('b2', 'Botany'),
      genq('b3', 'Botany'),
      genq('j1', 'Jazz'),
      genq('a1', 'Astronomy'),
      genq('c1', 'Cartography'),
    ];
    mocks.generateDailyQuestionsFromKnowledgeBase
      .mockResolvedValueOnce([rows[0], rows[1], rows[2], rows[3]])
      .mockResolvedValueOnce([rows[4], rows[5]]);

    await fillDailyQueueForUser(USER);

    expect(mocks.createDailyQueueItem).toHaveBeenCalledTimes(DAILY_QUEUE_SIZE);
    const domains = persistedGeneratedDomains(rows);
    // Exactly the cap of botany; b3 was deflected and never needed (the round
    // brought diverse material), so it does not appear.
    expect(domains.filter((d) => d === 'Botany').length).toBe(DAILY_QUEUE_MAX_PER_SUBCATEGORY);
    expect(domains).not.toContain('?');
    expect(new Set(domains)).toEqual(new Set(['Botany', 'Jazz', 'Astronomy', 'Cartography']));
  });

  it('caps botany at the limit when other subcategories can fill the rest', async () => {
    // A mixed batch with a botany cluster plus enough distinct domains to fill five.
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      genq('b1', 'Botany'),
      genq('b2', 'Botany'),
      genq('b3', 'Botany'),
      genq('b4', 'Botany'),
      genq('b5', 'Botany'),
      genq('j1', 'Jazz'),
      genq('a1', 'Astronomy'),
      genq('c1', 'Cartography'),
    ]);

    await fillDailyQueueForUser(USER);

    expect(mocks.createDailyQueueItem).toHaveBeenCalledTimes(DAILY_QUEUE_SIZE);
    const domains = mocks.createDailyQueueItem.mock.calls.map((call) => {
      const id = call[1] as string;
      return id.startsWith('b') ? 'Botany' : id;
    });
    const botanyCount = domains.filter((d) => d === 'Botany').length;
    // No more than the cap, and the freed slots are filled by other subcategories.
    expect(botanyCount).toBe(DAILY_QUEUE_MAX_PER_SUBCATEGORY);
    expect(new Set(domains).size).toBeGreaterThan(1);
  });

  it('caps a 3-Hamlet authored run, sourcing the rest from generation', async () => {
    // Three authored Hamlet questions; the cap admits only two into the core.
    mocks.pickEligibleAuthoredQuestions.mockResolvedValue([
      authoredPick('h1', 'Hamlet'),
      authoredPick('h2', 'Hamlet'),
      authoredPick('h3', 'Hamlet'),
    ]);
    // Generation fills the remaining slots with distinct domains.
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      genq('j1', 'Jazz'),
      genq('a1', 'Astronomy'),
      genq('c1', 'Cartography'),
    ]);

    await fillDailyQueueForUser(USER);

    // Only two Hamlet authored slots persisted (cap), not three.
    expect(mocks.createDailyQueueItemFromAuthored).toHaveBeenCalledTimes(
      DAILY_QUEUE_MAX_PER_SUBCATEGORY,
    );
    // Generation backfilled the slot the cap freed, so the queue is still full.
    const totalSlots =
      mocks.createDailyQueueItemFromAuthored.mock.calls.length +
      mocks.createDailyQueueItem.mock.calls.length;
    expect(totalSlots).toBe(DAILY_QUEUE_SIZE);
  });

  it('exempts an "often"-marked subcategory from the cap (Game settings honored)', async () => {
    // The player explicitly asked to see lots of Botany. The diversity cap must NOT
    // throttle a topic the player deliberately requested — "often" is exempt, so a
    // botany-heavy day the player asked for is delivered in full.
    mocks.getDailyPreferences.mockResolvedValue({
      difficulty: 'adaptive',
      domainMode: 'random',
      selectedDomains: [],
      domainPreferenceFrequency: { Botany: 'often' },
    });
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      genq('b1', 'Botany'),
      genq('b2', 'Botany'),
      genq('b3', 'Botany'),
      genq('b4', 'Botany'),
      genq('b5', 'Botany'),
    ]);

    await fillDailyQueueForUser(USER);

    // All five botany slots persisted — not capped at DAILY_QUEUE_MAX_PER_SUBCATEGORY.
    expect(mocks.createDailyQueueItem).toHaveBeenCalledTimes(DAILY_QUEUE_SIZE);
  });

  it('still caps OTHER subcategories while an "often" one runs free', async () => {
    // Botany is "often" (exempt); Jazz is unset (base cap). A mixed batch should let
    // botany exceed the base cap while jazz is still spaced out — the cap and the
    // frequency preference coexist.
    mocks.getDailyPreferences.mockResolvedValue({
      difficulty: 'adaptive',
      domainMode: 'random',
      selectedDomains: [],
      domainPreferenceFrequency: { Botany: 'often' },
    });
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      genq('b1', 'Botany'),
      genq('b2', 'Botany'),
      genq('b3', 'Botany'),
      genq('j1', 'Jazz'),
      genq('j2', 'Jazz'),
      genq('j3', 'Jazz'),
    ]);

    await fillDailyQueueForUser(USER);

    expect(mocks.createDailyQueueItem).toHaveBeenCalledTimes(DAILY_QUEUE_SIZE);
    const domains = mocks.createDailyQueueItem.mock.calls.map((call) => {
      const id = call[1] as string;
      return id.startsWith('b') ? 'Botany' : 'Jazz';
    });
    // Botany (often) exceeds the base cap; Jazz (unset) is held at it.
    expect(domains.filter((d) => d === 'Botany').length).toBeGreaterThan(
      DAILY_QUEUE_MAX_PER_SUBCATEGORY,
    );
    expect(domains.filter((d) => d === 'Jazz').length).toBeLessThanOrEqual(
      DAILY_QUEUE_MAX_PER_SUBCATEGORY,
    );
  });

  it('does not shorten a queue when only one subcategory is available (soft cap)', async () => {
    // Single-domain knowledge base: the cap can never diversify, so it must NOT
    // turn a previously-full queue into a short one or a 503. The effective cap
    // scales up (DAILY_QUEUE_SIZE / 1) and the reserve backfill is the safety net.
    mocks.getKnowledgeBase.mockResolvedValue([{ domain: 'Botany' }]);
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      genq('b1', 'Botany'),
      genq('b2', 'Botany'),
      genq('b3', 'Botany'),
      genq('b4', 'Botany'),
      genq('b5', 'Botany'),
    ]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    // A full five-question queue still builds — the cap degraded gracefully.
    expect(mocks.createDailyQueueItem).toHaveBeenCalledTimes(DAILY_QUEUE_SIZE);
  });
});
