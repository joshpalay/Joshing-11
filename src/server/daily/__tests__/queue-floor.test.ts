import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAILY_QUEUE_MIN_SIZE, DAILY_QUEUE_SIZE } from '@/server/daily/types';

// fillDailyQueueForUser orchestrates DB pickers + LLM generation; every one of
// those touches @/server/db, which throws at module load without a connection
// string. Mock the whole dependency surface so this exercises ONLY the
// orchestrator's completeness loop + minimum-size floor (the single-question
// "Daily Five" regression). The mocks are hoisted so the vi.mock factories can
// reference them.
const mocks = vi.hoisted(() => ({
  getTodaysDailyQueue: vi.fn(),
  carryForwardUntouchedDailyQueue: vi.fn(),
  clearStaleShortTodayQueue: vi.fn(),
  countDailyQueues: vi.fn(),
  getKnowledgeBase: vi.fn(),
  pickEligibleAuthoredQuestions: vi.fn(),
  pickHouseQuestions: vi.fn(),
  persistDailyQueue: vi.fn(),
  getDailyPreferences: vi.fn(),
  getFriendAndFoFUserIds: vi.fn(),
  getFriendDomainsForBonus: vi.fn(),
  generateDailyQuestionsFromKnowledgeBase: vi.fn(),
  generateBonusQuestionsForDomains: vi.fn(),
  isGenericSubcategory: vi.fn(),
}));

// The orchestrator assembles the queue in memory via pure slot builders, then
// persists it once via persistDailyQueue (atomic write). Provide faithful pure
// builders so the slots handed to persistDailyQueue carry the asserted fields.
vi.mock('@/server/db/queries/daily', () => ({
  getTodaysDailyQueue: mocks.getTodaysDailyQueue,
  carryForwardUntouchedDailyQueue: mocks.carryForwardUntouchedDailyQueue,
  clearStaleShortTodayQueue: mocks.clearStaleShortTodayQueue,
  countDailyQueues: mocks.countDailyQueues,
  getKnowledgeBase: mocks.getKnowledgeBase,
  pickEligibleAuthoredQuestions: mocks.pickEligibleAuthoredQuestions,
  pickHouseQuestions: mocks.pickHouseQuestions,
  getRecentAnsweredAnswerKeys: vi.fn(async () => new Set<string>()),
  persistDailyQueue: mocks.persistDailyQueue,
  buildAuthoredSlot: (a: { id: string; canonicalSubcategory: string; questionText: string }, position: number) => ({
    slot_index: position, source: 'friend', question_id: a.id, domain: a.canonicalSubcategory, question_text: a.questionText, answered: false,
  }),
  buildHouseSlot: (h: { id: string; canonicalSubcategory: string; questionText: string }, position: number) => ({
    slot_index: position, source: 'house', question_id: h.id, domain: h.canonicalSubcategory, question_text: h.questionText, answered: false,
  }),
  buildBotSlot: (q: { id: string; canonicalSubcategory: string; questionText: string }, position: number) => ({
    slot_index: position, source: 'bot', generated_question_id: q.id, domain: q.canonicalSubcategory, question_text: q.questionText, answered: false,
  }),
  buildPresenceSlot: (q: { id: string; canonicalSubcategory: string; questionText: string }, presence: { sourceId: string }, position: number) => ({
    slot_index: position, source: 'bot', generated_question_id: q.id, domain: q.canonicalSubcategory, question_text: q.questionText, presence_source_id: presence?.sourceId, answered: false,
  }),
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

import { DailyQueueFillError, fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';

const USER = 'user-1';

// Minimal stand-in for a generated question row — the orchestrator only reads
// id, questionText, and canonicalSubcategory.
function genq(id: string, subcategory = 'Jazz') {
  return { id, questionText: `Question ${id}`, canonicalSubcategory: subcategory } as never;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Fresh build path: no existing queue, nothing to carry forward.
  mocks.getTodaysDailyQueue.mockResolvedValue(null);
  mocks.carryForwardUntouchedDailyQueue.mockResolvedValue(false);
  mocks.clearStaleShortTodayQueue.mockResolvedValue(false);
  // Returning player (not first-run); these tests exercise the completeness loop,
  // not first-run seeding. The orchestrator only passes this flag through to the
  // (mocked) generator, so the value doesn't change call counts here.
  mocks.countDailyQueues.mockResolvedValue(3);

  // A non-empty knowledge base in random mode; no authored or house picks, so
  // the queue is built purely from generated questions (the path that yields
  // the single-question regression when generation under-yields).
  mocks.getKnowledgeBase.mockResolvedValue([{ domain: 'Jazz' }]);
  mocks.getDailyPreferences.mockResolvedValue({
    difficulty: 'adaptive',
    domainMode: 'random',
    selectedDomains: [],
  });
  mocks.pickEligibleAuthoredQuestions.mockResolvedValue([]);
  mocks.pickHouseQuestions.mockResolvedValue([]);
  mocks.getFriendAndFoFUserIds.mockResolvedValue({ direct: new Set(), extended: new Set() });

  // No +2 bonus domains — keep the test focused on the core slots.
  mocks.getFriendDomainsForBonus.mockResolvedValue([]);
  mocks.generateBonusQuestionsForDomains.mockResolvedValue([]);

  mocks.isGenericSubcategory.mockReturnValue(false);

  mocks.persistDailyQueue.mockResolvedValue(undefined);
});

// The single atomic persist call's slots argument, with the generated (bot) core
// slots in slot order — the post-refactor equivalent of the old per-slot
// createDailyQueueItem call list.
function persistedSlots(): Array<Record<string, unknown>> {
  expect(mocks.persistDailyQueue).toHaveBeenCalledTimes(1);
  return mocks.persistDailyQueue.mock.calls[0][1] as Array<Record<string, unknown>>;
}
function persistedBotSlots(): Array<Record<string, unknown>> {
  return persistedSlots().filter((slot) => slot.source === 'bot' && !slot.presence_source_id);
}

describe('fillDailyQueueForUser — minimum-size floor', () => {
  it('fails retryably (and persists nothing) when only one question survives the gates', async () => {
    // The exact regression: generation yields a single usable question and the
    // pool is tapped out, so every retry round returns the same (deduped) item.
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([genq('q1')]);

    await expect(fillDailyQueueForUser(USER)).rejects.toMatchObject({
      code: 'generation_failed',
    });
    await expect(fillDailyQueueForUser(USER)).rejects.toBeInstanceOf(DailyQueueFillError);

    // A degenerate one-question queue must never be persisted.
    expect(mocks.persistDailyQueue).not.toHaveBeenCalled();
  });

  it('stops topping up once a round recovers nothing (tapped-out pool)', async () => {
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([genq('q1')]);

    await expect(fillDailyQueueForUser(USER)).rejects.toBeInstanceOf(DailyQueueFillError);

    // One initial generation + exactly one top-up round (which recovers nothing
    // new) — not the full MAX_TOP_UP_ROUNDS — because the loop breaks early.
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).toHaveBeenCalledTimes(2);
  });

  it('serves a graceful-degraded short queue at the floor without failing', async () => {
    // Three distinct questions survive; further rounds only return duplicates.
    mocks.generateDailyQuestionsFromKnowledgeBase
      .mockResolvedValueOnce([genq('q1'), genq('q2'), genq('q3')])
      .mockResolvedValue([genq('q1')]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    // Persisted once, atomically, with exactly the floor's worth of bot slots in
    // order — the equivalent of the old three createDailyQueueItem(USER, id, pos).
    const bots = persistedBotSlots();
    expect(bots).toHaveLength(DAILY_QUEUE_MIN_SIZE);
    expect(bots.map((slot) => [slot.generated_question_id, slot.slot_index])).toEqual([
      ['q1', 0],
      ['q2', 1],
      ['q3', 2],
    ]);
  });

  it('loops top-up rounds until it reaches the full five', async () => {
    // Two on the first pass, then one and two more across two top-up rounds.
    mocks.generateDailyQuestionsFromKnowledgeBase
      .mockResolvedValueOnce([genq('q1'), genq('q2')])
      .mockResolvedValueOnce([genq('q3')])
      .mockResolvedValueOnce([genq('q4'), genq('q5')]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    // One initial generation + two top-up rounds reaching the target.
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).toHaveBeenCalledTimes(3);
    expect(persistedBotSlots()).toHaveLength(DAILY_QUEUE_SIZE);
  });
});
