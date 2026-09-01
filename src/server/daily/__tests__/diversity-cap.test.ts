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
  getRecentAnsweredAnswerKeys: vi.fn(),
  getRecentAnsweredEntities: vi.fn(),
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
  getRecentAnsweredAnswerKeys: mocks.getRecentAnsweredAnswerKeys,
  getRecentAnsweredEntities: mocks.getRecentAnsweredEntities,
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

// Unmocked, commitPendingRefineDecisions reaches the real @/server/db pool and
// these tests fail with ECONNREFUSED instead of exercising the cap.
vi.mock('@/server/refine/commit', () => ({
  commitPendingRefineDecisions: vi.fn().mockResolvedValue(undefined),
}));

import { DailyQueueFillError, fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';

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

// Minimal stand-in for a house pick (pickHouseQuestions) — distinct answerText
// per id so the (empty by default) answer-cooldown gate never collides across
// picks, matching authoredPick's shape plus the fields the answer/subject
// cooldown gates read.
function houseQuestion(id: string, subcategory: string) {
  return {
    id,
    questionText: `House ${id}`,
    answerText: `Answer ${id}`,
    canonicalSubcategory: subcategory,
    broadCategory: null,
    category: '',
    subjectEntity: null,
    difficultyEstimate: null,
    creatorNote: null,
  } as never;
}

// The single atomic persist call's slots argument.
function persistedSlots(): Array<Record<string, unknown>> {
  expect(mocks.persistDailyQueue).toHaveBeenCalledTimes(1);
  return mocks.persistDailyQueue.mock.calls[0][1] as Array<Record<string, unknown>>;
}
/** Generated (bot) core slots only — excludes authored, house, and +2 bonus. */
function persistedBotSlots(): Array<Record<string, unknown>> {
  return persistedSlots().filter((slot) => slot.source === 'bot' && !slot.presence_source_id);
}
/** The canonicalSubcategory each generated slot was persisted under, in slot order. */
function persistedGeneratedDomains(): string[] {
  return persistedBotSlots().map((slot) => (slot.domain as string) ?? '?');
}

beforeEach(() => {
  vi.clearAllMocks();

  // Fresh build path: no existing queue, nothing to carry forward.
  mocks.getTodaysDailyQueue.mockResolvedValue(null);
  mocks.carryForwardUntouchedDailyQueue.mockResolvedValue(false);
  mocks.clearStaleShortTodayQueue.mockResolvedValue(false);
  mocks.countDailyQueues.mockResolvedValue(3);

  // No Rested/Muted domains — the resting allow-set is resting-domains.test.ts's
  // concern, not this suite's.
  mocks.getExcludedKnowledgeDomains.mockResolvedValue({
    subcategories: new Set<string>(),
    broadCategories: new Set<string>(),
  });

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
  mocks.getRecentAnsweredAnswerKeys.mockResolvedValue(new Set<string>());
  mocks.getRecentAnsweredEntities.mockResolvedValue(new Set<string>());

  mocks.getFriendDomainsForBonus.mockResolvedValue([]);
  mocks.generateBonusQuestionsForDomains.mockResolvedValue([]);

  mocks.isGenericSubcategory.mockReturnValue(false);

  mocks.persistDailyQueue.mockResolvedValue(undefined);
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

    expect(persistedBotSlots()).toHaveLength(DAILY_QUEUE_SIZE);
    const domains = persistedGeneratedDomains();
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

    expect(persistedBotSlots()).toHaveLength(DAILY_QUEUE_SIZE);
    const domains = persistedGeneratedDomains();
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
    const authoredSlots = persistedSlots().filter((slot) => slot.source === 'friend');
    expect(authoredSlots).toHaveLength(DAILY_QUEUE_MAX_PER_SUBCATEGORY);
    // Generation backfilled the slot the cap freed, so the queue is still full.
    const totalSlots = authoredSlots.length + persistedBotSlots().length;
    expect(totalSlots).toBe(DAILY_QUEUE_SIZE);
  });

  it('caps a "blue_moon" subcategory at 1 per round, including friend questions', async () => {
    // Blue Moon means "see rarely" — a friend authoring two questions in a Blue
    // Moon domain must not take two of the five slots. The shared diversity gate
    // runs over authored/friend picks (unlike the frequency weighting, which only
    // steers generated domains), so the cap of 1 reaches them.
    mocks.getDailyPreferences.mockResolvedValue({
      difficulty: 'adaptive',
      domainMode: 'random',
      selectedDomains: [],
      domainPreferenceFrequency: { Hamlet: 'blue_moon' },
    });
    mocks.pickEligibleAuthoredQuestions.mockResolvedValue([
      authoredPick('h1', 'Hamlet'),
      authoredPick('h2', 'Hamlet'),
    ]);
    // Distinct generated domains finish the diverse five around the single Hamlet.
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
      genq('j1', 'Jazz'),
      genq('a1', 'Astronomy'),
      genq('c1', 'Cartography'),
      genq('b1', 'Botany'),
    ]);

    await fillDailyQueueForUser(USER);

    const hamletSlots = persistedSlots().filter(
      (slot) => slot.source === 'friend' && slot.domain === 'Hamlet',
    );
    // Only ONE Hamlet slot — the 2nd was deflected (Blue Moon cap = 1), not two as
    // the base cap would allow.
    expect(hamletSlots).toHaveLength(1);
    // The queue is still full; generation backfilled the slot the cap freed.
    const core = persistedSlots().filter((slot) => !slot.presence_source_id);
    expect(core).toHaveLength(DAILY_QUEUE_SIZE);
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
    expect(persistedBotSlots()).toHaveLength(DAILY_QUEUE_SIZE);
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

    expect(persistedBotSlots()).toHaveLength(DAILY_QUEUE_SIZE);
    const domains = persistedGeneratedDomains();
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
    expect(persistedBotSlots()).toHaveLength(DAILY_QUEUE_SIZE);
  });

  it('never lets the soft-cap backfill exceed the normal cap (prod incidents 2026-08-30 and 2026-09-01)', async () => {
    // Reproduces the 2026-08-30 incident directly: a house bank with only ONE
    // covered subcategory (5 Botany picks, mirroring the 10-question "Beethoven"
    // house bank) and generation that comes back empty every round. The original
    // B-DIVERSITY-BACKFILL-CAP-01 fix stopped the backfill at one slot past the
    // normal cap (3/5), which itself proved to be one too many in prod on
    // 2026-09-01 (3 Beethoven questions in one Five, one of them a genuine
    // answer-cooldown repeat let back in by the backfill). The backfill must now
    // never exceed the normal per-subcategory cap (2), even mid-relaxation, and
    // a knowledge base too narrow to diversify past that must serve short/retry
    // rather than repeat the same subcategory a third time.
    mocks.pickHouseQuestions.mockResolvedValue([
      houseQuestion('h1', 'Botany'),
      houseQuestion('h2', 'Botany'),
      houseQuestion('h3', 'Botany'),
      houseQuestion('h4', 'Botany'),
      houseQuestion('h5', 'Botany'),
    ]);
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([]);

    // Only 2 Botany house picks clear the cap; with nothing else to diversify
    // with and generation empty, the build lands below DAILY_QUEUE_MIN_SIZE and
    // fails closed (retryable) rather than persisting a 3rd repeat.
    await expect(fillDailyQueueForUser(USER)).rejects.toMatchObject({
      code: 'generation_failed',
    });
    expect(mocks.persistDailyQueue).not.toHaveBeenCalled();
  });

  it('never backfills a pick that was deflected for answer-cooldown, not diversity (prod incident 2026-09-01)', async () => {
    // Direct regression for the 2026-09-01 incident: a house pick whose answer
    // the player already gave within the cooldown window must stay excluded
    // even though it would otherwise have clean room under the diversity cap.
    // 3 authored Hamlet picks (unrelated to the repeat, just enough filler to
    // clear the DAILY_QUEUE_MIN_SIZE floor either way) plus one fresh Botany
    // house pick that's admitted normally, plus a 2nd Botany house pick whose
    // answer collides with something the player already answered — diversity
    // has room for it (cap is 2, only 1 Botany admitted so far), so only the
    // answer-cooldown gate stands between it and the queue. Before the fix, a
    // cooldown-deflected pick landed in the same reserve as a diversity-deflected
    // one and could be pulled back in by the backfill step, which only re-checks
    // the diversity gate. It must never be re-admitted by ANY path.
    mocks.pickEligibleAuthoredQuestions.mockResolvedValue([
      authoredPick('a1', 'Hamlet'),
      authoredPick('a2', 'Hamlet'),
      authoredPick('a3', 'Hamlet'),
    ]);
    mocks.pickHouseQuestions.mockResolvedValue([
      houseQuestion('h1', 'Botany'),
      { ...houseQuestion('h2', 'Botany'), answerText: 'Repeated Answer' },
    ]);
    mocks.getRecentAnsweredAnswerKeys.mockResolvedValue(new Set(['repeated answer']));
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([]);

    await fillDailyQueueForUser(USER);

    const questionIds = persistedSlots().map((slot) => slot.question_id);
    // h2 (the cooldown-blocked repeat) must never appear, via the normal pass
    // or the backfill.
    expect(questionIds).not.toContain('h2');
    const houseSlots = persistedSlots().filter((slot) => slot.source === 'house');
    expect(houseSlots).toHaveLength(1);
    expect(houseSlots[0]?.question_id).toBe('h1');
  });

  it('logs the per-domain, per-reason deflection trail whenever a pick is held back', async () => {
    // The exact diagnostic gap the 2026-08-30 incident hit: the aggregate
    // deflectedFor* counters only ever reached a log line when the build fell
    // below DAILY_QUEUE_MIN_SIZE, so a FULL but degenerate queue (5/5 one
    // domain) left no record of which domains/reasons were actually deflected.
    // Three authored Hamlet picks — cap admits two, the third is deflected by
    // the diversity cap — should now produce a log line naming exactly that.
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      mocks.pickEligibleAuthoredQuestions.mockResolvedValue([
        authoredPick('h1', 'Hamlet'),
        authoredPick('h2', 'Hamlet'),
        authoredPick('h3', 'Hamlet'),
      ]);
      mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([
        genq('j1', 'Jazz'),
        genq('a1', 'Astronomy'),
        genq('c1', 'Cartography'),
      ]);

      await fillDailyQueueForUser(USER);

      const trailCall = infoSpy.mock.calls.find(
        (call) => call[0] === '[daily/queue-orchestrator] deflection trail',
      );
      expect(trailCall).toBeDefined();
      const payload = trailCall?.[1] as { deflections: Record<string, number> };
      expect(payload.deflections['authored:Hamlet:diversity_cap']).toBe(1);
    } finally {
      infoSpy.mockRestore();
    }
  });
});
