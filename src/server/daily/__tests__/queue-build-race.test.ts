import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAILY_QUEUE_SIZE } from '@/server/daily/types';

// B-DAILY-QUEUE-SWAP-01 regression. The login pre-warm (after()) and the
// /daily page's synchronous POST both call fillDailyQueueForUser for the SAME
// user within seconds. Before the fix, two concurrent builds each generated a
// (different, non-deterministic) set and the second persist overwrote the
// queue the player was already answering — they answered question 1 and an
// entirely new five appeared. The in-process single-flight here is the first
// line of defence: concurrent same-user builds in one instance coalesce into a
// single generation + single persist, so they yield ONE queue. (The
// cross-instance guarantee lives in persistDailyQueue's first-writer-wins ON
// CONFLICT DO NOTHING — covered in persist-first-writer-wins.test.ts.)
//
// Same mock surface as queue-floor.test.ts: fillDailyQueueForUser pulls in the
// whole DB + LLM graph, which throws at import without a connection. Mock it
// all so this exercises ONLY the coalescing wrapper.
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
  getDailyPreferences: vi.fn(),
  getFriendAndFoFUserIds: vi.fn(),
  getFriendDomainsForBonus: vi.fn(),
  generateDailyQuestionsFromKnowledgeBase: vi.fn(),
  generateBonusQuestionsForDomains: vi.fn(),
  isGenericSubcategory: vi.fn(),
  commitPendingRefineDecisions: vi.fn(),
  logLatency: vi.fn(),
}));

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

vi.mock('@/server/refine/commit', () => ({
  commitPendingRefineDecisions: mocks.commitPendingRefineDecisions,
}));

vi.mock('@/server/telemetry', () => ({
  logLatency: mocks.logLatency,
}));

import { fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';

const USER = 'user-1';

// A distinct generated question per id. The orchestrator only reads id,
// questionText, and canonicalSubcategory. Distinct subcategories keep every
// question under the intra-day diversity cap so all of them survive into the
// core (the test asserts on identity, not gating).
function genq(id: string) {
  return { id, questionText: `Question ${id}`, canonicalSubcategory: id } as never;
}

// A generation result with more than enough distinct questions to fill the core
// in a single pass — no top-up rounds — so generate is called exactly once per
// build and the call count cleanly reflects how many builds actually ran.
function fullGeneration(prefix: string) {
  return Array.from({ length: DAILY_QUEUE_SIZE + 2 }, (_unused, i) => genq(`${prefix}-q${i}`));
}

// Resolve only when signalled, so two builds can be held concurrently in flight
// and we can prove the second coalesces onto the first before either settles.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.getTodaysDailyQueue.mockResolvedValue(null);
  mocks.carryForwardUntouchedDailyQueue.mockResolvedValue(false);
  mocks.clearStaleShortTodayQueue.mockResolvedValue(false);
  mocks.countDailyQueues.mockResolvedValue(3);
  mocks.getKnowledgeBase.mockResolvedValue([{ domain: 'Jazz' }]);
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
  mocks.getFriendDomainsForBonus.mockResolvedValue([]);
  mocks.generateBonusQuestionsForDomains.mockResolvedValue([]);
  mocks.isGenericSubcategory.mockReturnValue(false);
  mocks.commitPendingRefineDecisions.mockResolvedValue(undefined);
  mocks.persistDailyQueue.mockResolvedValue(undefined);
});

describe('fillDailyQueueForUser — concurrent build coalescing (B-DAILY-QUEUE-SWAP-01)', () => {
  it('two concurrent same-user builds generate once and persist once (one queue)', async () => {
    const gate = deferred<ReturnType<typeof fullGeneration>>();
    // Hold the first build inside generation so the second call lands while the
    // first is still in flight — the exact pre-warm-vs-POST overlap.
    mocks.generateDailyQuestionsFromKnowledgeBase.mockReturnValue(gate.promise as never);

    const first = fillDailyQueueForUser(USER);
    const second = fillDailyQueueForUser(USER);

    // Identical promise: the second caller coalesced onto the first's build.
    expect(second).toBe(first);

    gate.resolve(fullGeneration('build-a'));
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);

    // The whole point: ONE generation, ONE persist — not two racing builds whose
    // second persist clobbers the first's served queue.
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(mocks.persistDailyQueue).toHaveBeenCalledTimes(1);

    const persistedSlots = mocks.persistDailyQueue.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(persistedSlots.map((slot) => slot.generated_question_id)).toEqual(
      fullGeneration('build-a').slice(0, DAILY_QUEUE_SIZE).map((q) => (q as { id: string }).id),
    );
  });

  it('releases the in-flight entry on settle so a later build still runs', async () => {
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue(fullGeneration('build-a'));

    await fillDailyQueueForUser(USER);
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(mocks.persistDailyQueue).toHaveBeenCalledTimes(1);

    // A genuinely later build (e.g. tomorrow's, or after the player finished) must
    // not be suppressed by a stale single-flight entry.
    await fillDailyQueueForUser(USER);
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).toHaveBeenCalledTimes(2);
    expect(mocks.persistDailyQueue).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry when the build rejects, so a retry can rebuild', async () => {
    // First build throws after generation (knowledge base disappeared); the
    // single-flight entry must still clear so a retry isn't permanently wedged.
    mocks.getKnowledgeBase.mockResolvedValueOnce([]);
    await expect(fillDailyQueueForUser(USER)).rejects.toMatchObject({ code: 'no_knowledge_base' });

    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue(fullGeneration('build-a'));
    await expect(fillDailyQueueForUser(USER)).resolves.toBeUndefined();
    expect(mocks.persistDailyQueue).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce builds for different users', async () => {
    const gate = deferred<ReturnType<typeof fullGeneration>>();
    mocks.generateDailyQuestionsFromKnowledgeBase.mockReturnValue(gate.promise as never);

    const a = fillDailyQueueForUser('user-a');
    const b = fillDailyQueueForUser('user-b');
    expect(b).not.toBe(a);

    gate.resolve(fullGeneration('shared'));
    await Promise.all([a, b]);

    // Distinct users never share a build — each gets its own generation + persist.
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).toHaveBeenCalledTimes(2);
    expect(mocks.persistDailyQueue).toHaveBeenCalledTimes(2);
  });
});
