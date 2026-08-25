import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  countDailyQueues,
  getTodaysDailyQueue,
  refreshQueueSlotQuestionTexts,
} from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { hasSeenBonusOffer } from '@/server/daily/bonus-offer';
import { DailyQueueFillError, fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';
import { DAILY_QUEUE_MIN_SIZE, DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import { createServerTiming, logServerTiming } from '@/server/lib/server-timing';

export const dynamic = 'force-dynamic';
// The POST path can fall through to synchronous LLM generation when the cron
// hasn't pre-built today's queue. A single Sonnet batch is capped at
// GENERATION_TIMEOUT_MS (35s) and a bounded top-up can follow, so the default
// function budget is too small — give it headroom so the work completes
// instead of being platform-killed mid-generation. See queue-orchestrator.ts.
export const maxDuration = 90;

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

// Drop slots whose domain is a bucket-level label. Older queues built before
// the upstream guard could contain "general"/"general knowledge" slots; we
// suppress them here so the user never sees a general question. The orchestrator
// now counts generic picks as a shortfall and backfills them at build time, so
// for a freshly built queue this should drop nothing — if it does, the warning
// below makes it visible instead of silently shrinking the user's Daily Five.
function partitionGenericSlots(slots: QueueSlot[]): { kept: QueueSlot[]; dropped: QueueSlot[] } {
  const kept: QueueSlot[] = [];
  const dropped: QueueSlot[] = [];
  for (const slot of slots) {
    (isGenericSubcategory(slot.domain) ? dropped : kept).push(slot);
  }
  return { kept, dropped };
}

async function serializeQueue(
  queue: NonNullable<Awaited<ReturnType<typeof getTodaysDailyQueue>>>,
  difficultyMode: string,
  userId: string,
  // Total queues this user has ever had. When it's the only one (this one) and
  // nothing's been answered yet, this is their first Daily Five — the client
  // shows the one-time intro. Defaults conservatively to "not first" so a count
  // failure never falsely re-triggers the intro for a returning player.
  totalQueues = 2,
) {
  const raw = asQueueSlots(queue.slots);
  const { kept, dropped } = partitionGenericSlots(raw);

  // First-run intro gate: their only queue, fully untouched.
  const isFirstDaily = totalQueues <= 1 && raw.every((slot) => !slot.answered && !slot.skipped);

  // A served queue shorter than DAILY_QUEUE_SIZE is the exact symptom a user
  // reports as "only 3 of my 5 showed up." Trace it at the moment of serving,
  // and separate the two causes so the logs say which one happened:
  //   - dropped.length > 0  → generic slots filtered here on read
  //   - raw.length < SIZE    → orchestrator persisted a short queue (low yield;
  //     it logs its own '[daily/queue-orchestrator] persisted short queue')
  if (kept.length < DAILY_QUEUE_SIZE) {
    console.warn('[daily/queue] served short queue', {
      userId,
      queueDate: queue.queueDate,
      served: kept.length,
      expected: DAILY_QUEUE_SIZE,
      persistedSlots: raw.length,
      droppedGeneric: dropped.length,
      droppedGenericDomains: dropped.map((slot) => slot.domain),
    });
  }

  const [slots, bonusOfferSeen] = await Promise.all([
    // Serve live question text (slot.question_text is an assignment-time
    // snapshot; grading resolves the live row, so an admin edit made after
    // assignment must reach the display too).
    refreshQueueSlotQuestionTexts(kept),
    // B-BONUS-OFFER-01: drives the one-time friend-bonus interstitial. Read here
    // rather than on the client so a second device can't re-show it.
    hasSeenBonusOffer(userId),
  ]);

  return {
    queue_id: queue.id,
    queue_date: queue.queueDate,
    slots,
    difficulty_mode: difficultyMode,
    is_first_daily: isFirstDaily,
    bonus_offer_seen: bonusOfferSeen,
  };
}

async function requireUserId() {
  const session = await getSession();
  return session?.userId ?? null;
}

export async function GET() {
  const startedAt = Date.now();
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Server-Timing (B-PERF-04): tags the queue-read duration on every served
  // response so the Daily reveal / Daily-page hot path is observable in logs and
  // the Network panel. Header-only — no change to status or body.
  const withTiming = (response: NextResponse): NextResponse => {
    const timing = createServerTiming();
    timing.measure('queue', startedAt);
    logServerTiming('daily/queue', timing);
    response.headers.set('Server-Timing', timing.toHeader());
    return response;
  };

  const [queue, prefs, totalQueues] = await Promise.all([
    getTodaysDailyQueue(userId),
    getDailyPreferences(userId),
    countDailyQueues(userId).catch(() => 2),
  ]);

  if (!queue) {
    return withTiming(NextResponse.json({ queue: null, slots: [] }));
  }

  // Read floor (B-DAILY-PARTIAL-QUEUE-01). A queue below the minimum servable
  // size that the player hasn't started yet is treated as "still building"
  // rather than served as a degenerate 1–2 question round. The client's
  // null-handling re-POSTs, which awaits a full synchronous build (and, with
  // atomic persistence, observes the completed queue). The orchestrator never
  // PERSISTS below the floor, so in practice this only catches a transient read
  // that raced a build, or legacy partial data. Only applied on GET — POST has
  // just awaited a full build and a genuinely short (≥ floor) low-yield queue
  // there is valid and should be served.
  const rawSlots = asQueueSlots(queue.slots);
  const { kept: keptSlots } = partitionGenericSlots(rawSlots);
  const untouched = rawSlots.every((slot) => !slot.answered && !slot.skipped);
  if (untouched && keptSlots.length < DAILY_QUEUE_MIN_SIZE) {
    console.warn('[daily/queue] withholding sub-floor untouched queue (treating as building)', {
      userId,
      queueDate: queue.queueDate,
      kept: keptSlots.length,
      persistedSlots: rawSlots.length,
    });
    return withTiming(NextResponse.json({ queue: null, slots: [], building: true }));
  }

  return withTiming(
    NextResponse.json(await serializeQueue(queue, prefs.difficulty, userId, totalQueues)),
  );
}

export async function POST() {
  // The POST path is the Daily Five reveal's worst case: when the cron hasn't
  // pre-built today's queue it falls through to synchronous Sonnet generation
  // (seconds), which the GET path never pays. Time the build span and the
  // end-to-end total here (B-PERF-04) so this long pole is queryable in logs —
  // the GET-only `Server-Timing` header never sees it.
  const startedAt = Date.now();
  const timing = createServerTiming();
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    await fillDailyQueueForUser(userId);
  } catch (error) {
    if (error instanceof DailyQueueFillError) {
      timing.measure('total', startedAt);
      logServerTiming('daily/queue:POST', timing, { outcome: error.code });
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.code === 'no_knowledge_base' ? 409 : 503 },
      );
    }
    throw error;
  }
  timing.measure('build', startedAt);

  const [queue, prefs, totalQueues] = await Promise.all([
    getTodaysDailyQueue(userId),
    getDailyPreferences(userId),
    countDailyQueues(userId).catch(() => 2),
  ]);

  if (!queue) {
    timing.measure('total', startedAt);
    logServerTiming('daily/queue:POST', timing, { outcome: 'queue_not_created' });
    return NextResponse.json({ error: 'queue_not_created' }, { status: 500 });
  }

  const serialized = await serializeQueue(queue, prefs.difficulty, userId, totalQueues);
  timing.measure('total', startedAt);
  logServerTiming('daily/queue:POST', timing, { outcome: 'built' });
  return NextResponse.json(serialized);
}
