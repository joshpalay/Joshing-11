import {
  createDailyQueueItem,
  createDailyQueueItemFromAuthored,
  getKnowledgeBase,
  getTodaysDailyQueue,
  pickEligibleAuthoredQuestions,
} from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { getFriendAndFoFUserIds } from '@/server/db/queries/friends';
import { generateDailyQuestionsFromKnowledgeBase } from '@/server/daily/generate-questions';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';

export type DailyQueueFillErrorCode = 'no_knowledge_base' | 'generation_failed';

export class DailyQueueFillError extends Error {
  constructor(readonly code: DailyQueueFillErrorCode, message: string) {
    super(message);
    this.name = 'DailyQueueFillError';
  }
}

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

// Only start a recovery top-up generation while this much of the function
// budget is still unspent. A second generation call can take up to
// GENERATION_TIMEOUT_MS (35s); gating it on elapsed time keeps the retry from
// pushing the request past the route's maxDuration.
const TOP_UP_TIME_BUDGET_MS = 30_000;

// NOTE: do NOT over-request the generation count to absorb the gate drop rate.
// The generator caps output at 2000 tokens; asking for more than ~DAILY_QUEUE_SIZE
// questions overflows that budget, truncates the JSON, and yields ZERO parseable
// questions (and the larger response flirts with the 35s GENERATION_TIMEOUT_MS).
// Request the actual gap and let the graceful-degrade below persist whatever
// survives the gates — a short queue beats an empty one.

export async function fillDailyQueueForUser(userId: string): Promise<void> {
  const startedAt = Date.now();
  const existing = await getTodaysDailyQueue(userId);
  if (existing && asQueueSlots(existing.slots).length > 0) return;

  const [knowledgeBase, preferences] = await Promise.all([
    getKnowledgeBase(userId),
    getDailyPreferences(userId),
  ]);
  if (knowledgeBase.length === 0) {
    throw new DailyQueueFillError(
      'no_knowledge_base',
      'Add declared interests before generating Daily Five.',
    );
  }
  if (preferences.domainMode === 'custom' && preferences.selectedDomains.length === 0) {
    throw new DailyQueueFillError(
      'no_knowledge_base',
      'Choose at least one domain before starting a custom Daily Five.',
    );
  }

  // Prefer vetted user-authored questions, prioritised by friends-of-friends,
  // then top up the remaining slots with LLM-generated questions. The
  // QueueSlot schema already supports both bot and friend sources
  // (src/server/daily/types.ts), so this is a picker change — no slot-shape
  // migration required.
  //
  // Constrain authored picks to the viewer's effective knowledge base — in
  // custom mode that's the explicit selectedDomains list, in random mode
  // it's the full knowledge base (which getKnowledgeBase already filters
  // against userDomainExclusions). Without this, the authored picker
  // surfaced any vetted public question regardless of the viewer's declared
  // or demonstrated interests.
  const allowedSubcategories: ReadonlySet<string> = new Set(
    preferences.domainMode === 'custom'
      ? preferences.selectedDomains
      : knowledgeBase.map((domain) => domain.domain),
  );

  const socialGraph = await getFriendAndFoFUserIds(userId);
  const authored = await pickEligibleAuthoredQuestions(
    userId,
    socialGraph,
    DAILY_QUEUE_SIZE,
    allowedSubcategories,
  );

  const remaining = DAILY_QUEUE_SIZE - authored.length;
  const generated = remaining > 0
    ? await generateDailyQuestionsFromKnowledgeBase(userId, remaining)
    : [];

  // Cross-source dedup by normalized question text. The authored picker
  // dedupes by question_id against past queues, and the generator has its
  // own batch/history dedup — but neither knows about the other, so the
  // same prompt can land in two slots of the same queue (e.g. an authored
  // "Apples are in what plant family?" alongside an LLM-generated one).
  const seenTexts = new Set<string>();
  const normalize = (text: string) => text.trim().toLowerCase();
  for (const pick of authored) {
    seenTexts.add(normalize(pick.questionText));
  }
  const dedupedGenerated: typeof generated = [];
  let droppedDuplicates = 0;
  for (const question of generated) {
    const key = normalize(question.questionText);
    if (seenTexts.has(key)) {
      droppedDuplicates += 1;
      continue;
    }
    seenTexts.add(key);
    dedupedGenerated.push(question);
  }
  if (droppedDuplicates > 0) {
    console.warn('[daily/queue-orchestrator] dropped duplicate generated questions', {
      userId,
      droppedDuplicates,
      authoredCount: authored.length,
      generatedCount: generated.length,
    });
  }

  // If the first pass came up short — the LLM returned fewer usable questions
  // than requested, or the quality/dedup gates dropped some — attempt a single
  // bounded top-up for just the missing slots before failing. A transient slow
  // or partial Anthropic response (e.g. prod request 9lssf-…, where one Sonnet
  // call ran ~34s and the queue fell one slot short) otherwise 503s the entire
  // Daily Five even though most slots generated fine. The top-up is gated on
  // remaining time budget so the recovery can't push the request past the
  // route's maxDuration.
  const topUpGenerated: typeof dedupedGenerated = [];
  const shortfall = DAILY_QUEUE_SIZE - (authored.length + dedupedGenerated.length);
  if (shortfall > 0 && Date.now() - startedAt < TOP_UP_TIME_BUDGET_MS) {
    const extra = await generateDailyQuestionsFromKnowledgeBase(userId, shortfall);
    for (const question of extra) {
      const key = normalize(question.questionText);
      if (seenTexts.has(key)) continue;
      seenTexts.add(key);
      topUpGenerated.push(question);
    }
    if (topUpGenerated.length > 0) {
      console.info('[daily/queue-orchestrator] topped up short queue', {
        userId,
        shortfall,
        recovered: topUpGenerated.length,
      });
    }
  }

  const generatedForQueue = [...dedupedGenerated, ...topUpGenerated];
  const achieved = authored.length + generatedForQueue.length;

  // Graceful degrade: persist whatever we have instead of failing on a short
  // queue. Some niche domains have very low generation yield — the
  // quality/factual/dedup gates correctly reject most of each batch — so even
  // over-provisioned generation can land short. A shorter Daily Five (the good
  // questions we did get) beats a 503; the daily cron retries for a full set on
  // later days. The play flow and home completion are slot-driven (isRound
  // complete + progress read the ACTUAL slot count), so an N<5 queue renders
  // and completes correctly — no more "round ends early with blank dots".
  //
  // Only fail when there's nothing usable at all, so /api/daily/queue still
  // surfaces a retryable 503 + the fill-error UI in the genuine zero case.
  if (achieved === 0) {
    console.warn('[daily/queue-orchestrator] generation_failed (no usable questions)', {
      userId,
      knowledgeBaseDomains: knowledgeBase.length,
      generatedRaw: generated.length,
      droppedDuplicates,
      domainMode: preferences.domainMode,
      selectedDomains: preferences.selectedDomains.length,
      elapsedMs: Date.now() - startedAt,
    });
    throw new DailyQueueFillError(
      'generation_failed',
      "Today's Daily Five is taking longer than usual.",
    );
  }
  if (achieved < DAILY_QUEUE_SIZE) {
    // Persisted a short queue. Log the cause so it's still visible/actionable:
    // thin KB (knowledgeBaseDomains) vs low LLM yield (generatedRaw) vs
    // aggressive dedup (droppedDuplicates) vs skipped top-up (elapsedMs).
    console.warn('[daily/queue-orchestrator] persisted short queue', {
      userId,
      achieved,
      needed: DAILY_QUEUE_SIZE,
      authoredCount: authored.length,
      generatedRaw: generated.length,
      dedupedGenerated: dedupedGenerated.length,
      topUpRecovered: topUpGenerated.length,
      droppedDuplicates,
      knowledgeBaseDomains: knowledgeBase.length,
      domainMode: preferences.domainMode,
      selectedDomains: preferences.selectedDomains.length,
      elapsedMs: Date.now() - startedAt,
    });
  }

  let position = 0;
  for (const pick of authored) {
    await createDailyQueueItemFromAuthored(userId, pick, position);
    position += 1;
  }
  for (const question of generatedForQueue.slice(0, DAILY_QUEUE_SIZE - position)) {
    await createDailyQueueItem(userId, question.id, position);
    position += 1;
  }
}
