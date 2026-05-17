import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db, masteryEvents } from '@/server/db';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { persistGeneratedQuestion } from '@/server/questions/persist-generated-question';

export type BackfillResult = {
  scanned: number;
  parseFailures: number;
  persistFailures: number;
  alreadyHadConflict: number;
  updated: number;
  propagated: number;
  errors: Array<{ masteryEventId: string; error: string }>;
};

// Postgres drivers (postgres-js, pg) and drizzle wrappers attach the actual
// failure reason to the error object — but the property naming differs by
// version. Rather than guess, walk every own property on the error (and on
// `cause` if present) and emit non-noisy primitives. Returns one line per
// call site so the diagnostic UI shows whatever the driver actually wrote.
function describeError(error: unknown): string {
  const skip = new Set(['stack', 'name', 'query', 'sql', 'parameters', 'params']);
  const lines: string[] = [];

  const collect = (label: string, obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    const record = obj as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.getOwnPropertyNames(record)) {
      if (skip.has(key)) continue;
      const value = record[key];
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const stringValue = String(value);
        parts.push(`${key}=${stringValue.length > 400 ? `${stringValue.slice(0, 400)}…` : stringValue}`);
      }
    }
    if (parts.length > 0) lines.push(`${label}: ${parts.join(' · ')}`);
  };

  if (error instanceof Error) {
    collect('error', error);
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause) collect('cause', cause);
  } else {
    return String(error);
  }

  return lines.join(' || ');
}

// Extracts the generated question id from a synthesized `answer_id`
// written by writeMasteryEvent. Format:
//   daily:   `daily:<queueId>:<slotIndex>:<generatedQuestionId>:<answeredByUserId>`
//   catchup: `catchup:<dailyQueueItemId>:<generatedQuestionId>:<answeredByUserId>`
// UUIDs are colon-free, so the generated question id is always the
// second-to-last colon-separated component. Returns null if the layout
// doesn't match (e.g. legacy rows or rewritten by another path).
function extractGeneratedQuestionId(answerId: string | null, sourceType: string): string | null {
  if (!answerId) return null;
  const parts = answerId.split(':');
  if (parts[0] !== sourceType.replace('_correct', '')) {
    if (sourceType === 'live_correct' && parts[0] !== 'daily') return null;
    if (sourceType === 'catchup_correct' && parts[0] !== 'catchup') return null;
  }
  if (parts.length < 4) return null;
  const candidate = parts[parts.length - 2];
  // UUID v4 sanity check (loose). The generated_questions table uses UUIDs.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
    return null;
  }
  return candidate;
}

export async function backfillMissingFeedItemsForAnswerer(
  options: { answererUserId?: string; dryRun?: boolean; limit?: number } = {},
): Promise<BackfillResult> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);

  const filters = [
    isNull(masteryEvents.questionId),
    inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
    inArray(masteryEvents.answerState, ['first_correct', 'first_correct_after_wrong', 'repeat_correct']),
  ];
  if (options.answererUserId) {
    filters.push(eq(masteryEvents.answeredByUserId, options.answererUserId));
  }

  const rows = await db
    .select({
      id: masteryEvents.id,
      sourceType: masteryEvents.sourceType,
      answerId: masteryEvents.answerId,
      answeredByUserId: masteryEvents.answeredByUserId,
      canonicalSubcategory: masteryEvents.canonicalSubcategory,
    })
    .from(masteryEvents)
    .where(and(...filters))
    .orderBy(masteryEvents.createdAt)
    .limit(limit);

  const result: BackfillResult = {
    scanned: rows.length,
    parseFailures: 0,
    persistFailures: 0,
    alreadyHadConflict: 0,
    updated: 0,
    propagated: 0,
    errors: [],
  };

  for (const row of rows) {
    const generatedQuestionId = extractGeneratedQuestionId(row.answerId, row.sourceType);
    if (!generatedQuestionId) {
      result.parseFailures += 1;
      continue;
    }

    let canonicalQuestionId: string;
    try {
      const persisted = await persistGeneratedQuestion(generatedQuestionId, row.canonicalSubcategory);
      canonicalQuestionId = persisted.questionId;
    } catch (error) {
      result.persistFailures += 1;
      result.errors.push({
        masteryEventId: row.id,
        error: describeError(error),
      });
      continue;
    }

    if (options.dryRun) {
      result.updated += 1;
      continue;
    }

    // The unique key (source_type, question_id, answered_by_user_id) means
    // if this answerer somehow already has a non-null row pointing at the
    // canonical question, we cannot UPDATE this NULL row to that id —
    // it would collide. In that case skip; the canonical row already exists.
    try {
      const updateResult = await db.execute(sql`
        UPDATE "MASTERY_EVENTS"
        SET "question_id" = ${canonicalQuestionId}
        WHERE "id" = ${row.id}
          AND "question_id" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "MASTERY_EVENTS" sib
            WHERE sib."source_type" = ${row.sourceType}
              AND sib."question_id" = ${canonicalQuestionId}
              AND sib."answered_by_user_id" = ${row.answeredByUserId}
          )
      `);

      const rowCount =
        typeof (updateResult as { rowCount?: number | null }).rowCount === 'number'
          ? (updateResult as { rowCount: number }).rowCount
          : Array.isArray((updateResult as { rows?: unknown[] }).rows)
            ? (updateResult as { rows: unknown[] }).rows.length
            : 0;

      if (rowCount === 0) {
        result.alreadyHadConflict += 1;
        continue;
      }

      result.updated += 1;
    } catch (error) {
      result.persistFailures += 1;
      result.errors.push({
        masteryEventId: row.id,
        error: describeError(error),
      });
      continue;
    }

    if (!row.answeredByUserId) continue;

    try {
      await createFeedItemsForFriendsFromAnswer(
        row.answeredByUserId,
        canonicalQuestionId,
        'correct',
        row.answerId ?? undefined,
      );
      result.propagated += 1;
    } catch (error) {
      result.errors.push({
        masteryEventId: row.id,
        error: `propagation: ${describeError(error)}`,
      });
    }
  }

  return result;
}

export const __test_only_extractGeneratedQuestionId = extractGeneratedQuestionId;
