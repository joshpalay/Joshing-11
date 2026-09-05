import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAILY_BONUS_SLOT_MAX, DAILY_QUEUE_MIN_SIZE, DAILY_QUEUE_SIZE } from '@/server/daily/types';

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
  getExcludedKnowledgeDomains: vi.fn(),
  pickEligibleAuthoredQuestions: vi.fn(),
  pickHouseQuestions: vi.fn(),
  persistDailyQueue: vi.fn(),
  createDailyQueueItemFromPresence: vi.fn(),
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
  getExcludedKnowledgeDomains: mocks.getExcludedKnowledgeDomains,
  pickEligibleAuthoredQuestions: mocks.pickEligibleAuthoredQuestions,
  pickHouseQuestions: mocks.pickHouseQuestions,
  getRecentAnsweredAnswerKeys: vi.fn(async () => new Set<string>()),
  getRecentAnsweredEntities: vi.fn(async () => new Set<string>()),
  persistDailyQueue: mocks.persistDailyQueue,
  createDailyQueueItemFromPresence: mocks.createDailyQueueItemFromPresence,
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

// Unmocked, commitPendingRefineDecisions reaches the real @/server/db pool and
// these tests fail with ECONNREFUSED instead of exercising the floor.
vi.mock('@/server/refine/commit', () => ({
  commitPendingRefineDecisions: vi.fn().mockResolvedValue(undefined),
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
  // No Rested/Muted domains — the resting allow-set is resting-domains.test.ts's
  // concern, not this suite's.
  mocks.getExcludedKnowledgeDomains.mockResolvedValue({
    subcategories: new Set<string>(),
    broadCategories: new Set<string>(),
  });
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
  mocks.createDailyQueueItemFromPresence.mockResolvedValue({ slots: [] });
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

  it('backfills from the under-difficulty reserve to reach the full five when in-tier yield is short', async () => {
    // Generation yields only 2 in-tier questions and never recovers more, but
    // deflects 3 good-but-too-easy questions into the reserve. The orchestrator
    // should top up from that reserve to a full five rather than serving the floor.
    let reserveSeeded = false;
    mocks.generateDailyQuestionsFromKnowledgeBase.mockImplementation(
      async (_userId: string, _count: number, options?: { underDifficultyReserve?: unknown[] }) => {
        if (!reserveSeeded && options?.underDifficultyReserve) {
          options.underDifficultyReserve.push(genq('easy1'), genq('easy2', 'Blues'), genq('easy3', 'Soul'));
          reserveSeeded = true;
          return [genq('q1'), genq('q2', 'Funk')];
        }
        // Later top-up rounds recover nothing new in-tier.
        return [genq('q1')];
      },
    );

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    const bots = persistedBotSlots();
    expect(bots).toHaveLength(DAILY_QUEUE_SIZE);
    // In-tier picks lead; under-difficulty reserve picks fill the tail in order.
    expect(bots.map((slot) => slot.generated_question_id)).toEqual([
      'q1',
      'q2',
      'easy1',
      'easy2',
      'easy3',
    ]);
  });

  it('does not draw on the under-difficulty reserve when the in-tier yield already fills the five', async () => {
    mocks.generateDailyQuestionsFromKnowledgeBase.mockImplementation(
      async (_userId: string, _count: number, options?: { underDifficultyReserve?: unknown[] }) => {
        // Reserve is seeded but the in-tier yield is already a full five.
        options?.underDifficultyReserve?.push(genq('easy1'));
        return [genq('q1'), genq('q2'), genq('q3'), genq('q4'), genq('q5')];
      },
    );

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    const bots = persistedBotSlots();
    expect(bots).toHaveLength(DAILY_QUEUE_SIZE);
    expect(bots.map((slot) => slot.generated_question_id)).not.toContain('easy1');
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

// A friend-domain candidate as getFriendDomainsForBonus returns it — the
// orchestrator reads `.domain` and `.presenceSources[0]` (via toBonusPresence).
function friendDomain(domain: string, sourceId = `src-${domain}`) {
  return {
    domain,
    presenceSources: [{ userId: sourceId, displayName: `Owner of ${domain}`, lastActivityAt: null }],
  } as never;
}
// A freshly generated friend question as generateBonusQuestionsForDomains returns it.
function friendQ(domain: string, id = `f-${domain}`) {
  return { domain, question: genq(id, domain) };
}

// The persisted BONUS slots (bot rows carrying a presence_source_id).
//
// After the deferral, this is expected to be EMPTY on every build: bonus slots
// are no longer part of the atomic persist. They are appended afterwards, off
// the player's critical path, via createDailyQueueItemFromPresence -- which is
// what deferredBonusAppends() below counts. A non-empty result here means bonus
// generation has moved back onto the critical path.
function persistedBonusSlots(): Array<Record<string, unknown>> {
  return persistedSlots().filter((slot) => Boolean(slot.presence_source_id));
}

// The +2 slots appended by the deferred continuation. In tests there is no
// request scope, so after() is unavailable and the tail runs INLINE -- the end
// state is identical, which is the property that makes the fallback safe.
function deferredBonusAppends(): string[] {
  return mocks.createDailyQueueItemFromPresence.mock.calls.map((call) => call[1] as string);
}

describe('fillDailyQueueForUser — short-core serving backstop (Layer 1)', () => {
  it('promotes friend-domain questions into CORE when the own palette lands short, then fills +2', async () => {
    // Own palette yields only 4 distinct questions and never recovers a 5th.
    mocks.generateDailyQuestionsFromKnowledgeBase
      .mockResolvedValueOnce([genq('q1'), genq('q2'), genq('q3'), genq('q4')])
      .mockResolvedValue([genq('q1')]);
    // Three friend domains are available; each generates one fresh question.
    mocks.getFriendDomainsForBonus.mockResolvedValue([
      friendDomain('Chess'),
      friendDomain('Opera'),
      friendDomain('Sushi'),
    ]);
    mocks.generateBonusQuestionsForDomains.mockResolvedValue([
      friendQ('Chess'),
      friendQ('Opera'),
      friendQ('Sushi'),
    ]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    // One friend question is promoted into the core to reach the full five (the
    // 4 own questions + 1 friend), and the remaining two become +2 bonus slots.
    const core = persistedBotSlots();
    expect(core).toHaveLength(DAILY_QUEUE_SIZE);
    expect(core.map((slot) => slot.generated_question_id)).toEqual([
      'q1',
      'q2',
      'q3',
      'q4',
      'f-Chess',
    ]);
    // THE DEFERRAL SPLIT, asserted directly. Core-fill and bonus used to share
    // one generation call; only bonus is optional, so only bonus is deferred.
    // The core question must be generated SYNCHRONOUSLY -- the queue cannot be
    // served without its fifth slot -- while the two +2 questions are generated
    // after persist.
    expect(mocks.generateBonusQuestionsForDomains).toHaveBeenCalledTimes(2);
    // Synchronous call: exactly the shortfall (1), taken in the selector's own
    // order, never a positional guess.
    expect(mocks.generateBonusQuestionsForDomains).toHaveBeenNthCalledWith(1, USER, ['Chess']);
    // Deferred call: the remaining domains, capped at DAILY_BONUS_SLOT_MAX.
    expect(mocks.generateBonusQuestionsForDomains).toHaveBeenNthCalledWith(2, USER, [
      'Opera',
      'Sushi',
    ]);
    // Nothing bonus-shaped is in the atomic persist any more...
    expect(persistedBonusSlots()).toHaveLength(0);
    // ...it arrives through the deferred append instead.
    expect(deferredBonusAppends()).toHaveLength(DAILY_BONUS_SLOT_MAX);
  });

  it('requests coreShortfall + DAILY_BONUS_SLOT_MAX friend domains so the +2 is not cannibalized', async () => {
    mocks.generateDailyQuestionsFromKnowledgeBase
      .mockResolvedValueOnce([genq('q1'), genq('q2'), genq('q3')]) // 2 short
      .mockResolvedValue([genq('q1')]);
    mocks.getFriendDomainsForBonus.mockResolvedValue([]);
    mocks.generateBonusQuestionsForDomains.mockResolvedValue([]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    // Core short by 2 → asks for 2 + DAILY_BONUS_SLOT_MAX candidates.
    expect(mocks.getFriendDomainsForBonus).toHaveBeenCalledWith(
      USER,
      2 + DAILY_BONUS_SLOT_MAX,
      expect.anything(),
    );
  });

  it('uses every friend question for core (0 bonus) when the shortfall consumes them all', async () => {
    mocks.generateDailyQuestionsFromKnowledgeBase
      .mockResolvedValueOnce([genq('q1'), genq('q2'), genq('q3'), genq('q4')])
      .mockResolvedValue([genq('q1')]);
    mocks.getFriendDomainsForBonus.mockResolvedValue([friendDomain('Chess')]);
    // Only one friend question materializes — it must go to CORE, not bonus.
    mocks.generateBonusQuestionsForDomains.mockResolvedValue([friendQ('Chess')]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    expect(persistedBotSlots()).toHaveLength(DAILY_QUEUE_SIZE);
    expect(persistedBonusSlots()).toHaveLength(0);
  });

  it('leaves a FULL core untouched — friend questions all become +2 bonus (unchanged behavior)', async () => {
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      genq('q1'), genq('q2'), genq('q3'), genq('q4'), genq('q5'),
    ]);
    mocks.getFriendDomainsForBonus.mockResolvedValue([
      friendDomain('Chess'),
      friendDomain('Opera'),
    ]);
    mocks.generateBonusQuestionsForDomains.mockResolvedValue([
      friendQ('Chess'),
      friendQ('Opera'),
    ]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    // Core is the five own questions; both friend questions are bonus.
    expect(persistedBotSlots().map((slot) => slot.generated_question_id)).toEqual([
      'q1', 'q2', 'q3', 'q4', 'q5',
    ]);
    // Bonus is no longer in the atomic persist -- it is appended after the
    // queue is readable. Same two questions, one step later.
    expect(persistedBonusSlots()).toHaveLength(0);
    expect(deferredBonusAppends()).toHaveLength(DAILY_BONUS_SLOT_MAX);
    // Core full → asks only for the standard +2 (coreShortfall 0).
    expect(mocks.getFriendDomainsForBonus).toHaveBeenCalledWith(
      USER,
      DAILY_BONUS_SLOT_MAX,
      expect.anything(),
    );
  });
});

describe('deferral — core-fill robustness (borrow-back)', () => {
  it('borrows a bonus domain back when the core slice under-delivers', async () => {
    // THE REGRESSION THIS PREVENTS. Before the deferral, generation ran across
    // ALL shortfall+2 domains and promotion drew from the whole returned pool,
    // so a domain that produced nothing was covered by another. Slicing domains
    // into core/bonus roles first would leave the queue SHORT on any miss --
    // in the very backstop that exists to stop short queues.
    mocks.generateDailyQuestionsFromKnowledgeBase
      .mockResolvedValueOnce([genq('q1'), genq('q2'), genq('q3'), genq('q4')])
      .mockResolvedValue([genq('q1')]);
    mocks.getFriendDomainsForBonus.mockResolvedValue([
      friendDomain('Chess'),
      friendDomain('Opera'),
      friendDomain('Sushi'),
    ]);
    // The core slice (['Chess']) produces NOTHING; the borrowed domain does.
    mocks.generateBonusQuestionsForDomains
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([friendQ('Opera')])
      .mockResolvedValue([friendQ('Sushi')]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    // The five are intact — Opera was borrowed back to fill the fifth slot.
    const core = persistedBotSlots();
    expect(core).toHaveLength(DAILY_QUEUE_SIZE);
    expect(core.map((slot) => slot.generated_question_id)).toEqual([
      'q1', 'q2', 'q3', 'q4', 'f-Opera',
    ]);
    // Borrowing is synchronous and per-domain: the core slice, then Opera.
    expect(mocks.generateBonusQuestionsForDomains).toHaveBeenNthCalledWith(1, USER, ['Chess']);
    expect(mocks.generateBonusQuestionsForDomains).toHaveBeenNthCalledWith(2, USER, ['Opera']);
    // A borrowed domain leaves the deferred set, so it is never generated twice.
    expect(mocks.generateBonusQuestionsForDomains).toHaveBeenNthCalledWith(3, USER, ['Sushi']);
  });

  it('does not borrow when the core slice delivers — the happy path pays nothing', async () => {
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      genq('q1'), genq('q2'), genq('q3'), genq('q4'), genq('q5'),
    ]);
    mocks.getFriendDomainsForBonus.mockResolvedValue([
      friendDomain('Chess'),
      friendDomain('Opera'),
    ]);
    mocks.generateBonusQuestionsForDomains.mockResolvedValue([friendQ('Chess'), friendQ('Opera')]);

    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();

    // Core was already full, so there is no synchronous call at all — the whole
    // friend-domain cycle is deferred.
    expect(mocks.generateBonusQuestionsForDomains).toHaveBeenCalledTimes(1);
    expect(mocks.generateBonusQuestionsForDomains).toHaveBeenNthCalledWith(1, USER, [
      'Chess',
      'Opera',
    ]);
  });
});
