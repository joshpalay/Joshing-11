import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { countDailyQueues, getTodaysDailyQueue } from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { DailyQueueFillError, fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';

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

function serializeQueue(
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
  const isFirstDaily =
    totalQueues <= 1 && raw.every((slot) => !slot.answered && !slot.skipped);

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

  return {
    queue_id: queue.id,
    queue_date: queue.queueDate,
    slots: kept,
    difficulty_mode: difficultyMode,
    is_first_daily: isFirstDaily,
  };
}

async function requireUserId() {
  const session = await getSession();
  return session?.userId ?? null;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [queue, prefs, totalQueues] = await Promise.all([
    getTodaysDailyQueue(userId),
    getDailyPreferences(userId),
    countDailyQueues(userId).catch(() => 2),
  ]);

  if (!queue) {
    return NextResponse.json({ queue: null, slots: [] });
  }

  return NextResponse.json(serializeQueue(queue, prefs.difficulty, userId, totalQueues));
}

export async function POST() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    await fillDailyQueueForUser(userId);
  } catch (error) {
    if (error instanceof DailyQueueFillError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.code === 'no_knowledge_base' ? 409 : 503 },
      );
    }
    throw error;
  }

  const [queue, prefs, totalQueues] = await Promise.all([
    getTodaysDailyQueue(userId),
    getDailyPreferences(userId),
    countDailyQueues(userId).catch(() => 2),
  ]);

  if (!queue) {
    return NextResponse.json({ error: 'queue_not_created' }, { status: 500 });
  }

  return NextResponse.json(serializeQueue(queue, prefs.difficulty, userId, totalQueues));
}
