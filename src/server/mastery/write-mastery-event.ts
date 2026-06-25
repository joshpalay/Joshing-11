import { and, eq, sql } from 'drizzle-orm';

import { db, masteryEvents, playerMastery } from '@/server/db';
import { maybeNotifyInviterOfFirstFive } from '@/server/activity/invite-onboarding';
import { evaluateQuestionTrustOnPlay } from '@/server/db/queries/trust-promotion';
import { effectiveTier } from '@/server/mastery/tiers';
import type { LlmProvider } from '@/server/llm/provider';
import type { AnswerState, MasteryTier } from '@/types/db';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';

type MasteryEventSourceType = 'daily' | 'feed' | 'joshing_game' | 'catchup' | 'author_credit' | 'curator_credit';

export type WriteMasteryEventParams = {
  userId: string;
  questionId: string;
  domain: string;
  answerState?: AnswerState;
  pointsAwarded: number;
  sourceType: MasteryEventSourceType;
  sourceId: string;
  broadCategory?: string | null;
  eventQuestionId?: string | null;
  basePoints?: number;
  weight?: number;
  answeredByUserId?: string | null;
  // B-LLM-PROVIDER-AB-SWITCH B3: provider that GRADED this answer ('anthropic'|
  // 'openai'), or null when the grade never hit an LLM (exact-match/give-up) or
  // the write isn't from a grading path (author/curator credit, backfill, etc.).
  llmProvider?: LlmProvider | null;
  // When true, the best-effort tail (trust-on-play + inviter first-five notify)
  // is NOT run inline. The caller must schedule runMasteryWriteSideEffects()
  // itself (e.g. via after()) when result.eventInserted is true. Used on the
  // user-blocking grading path to keep those queries off the critical section
  // WITHOUT deferring the event/mastery write itself (the daily summary reads
  // the mastery tables, so the write must stay synchronous). Defaults to inline.
  deferSideEffects?: boolean;
};

export type MasteryEventWriteResult = {
  domain: string;
  broadCategory: string | null;
  points: number;
  previousTier: MasteryTier;
  newTier: MasteryTier;
  tierChanged: boolean;
  openedNewTerritory: boolean;
  // Whether THIS call actually inserted the mastery event (false on dedup
  // conflict). The deferred side-effect tail must only run when true.
  eventInserted: boolean;
};

async function readAuthorCredit(userId: string, domain: string) {
  const [row] = await db
    .select({
      points: sql<number>`coalesce(sum(${masteryEvents.awardedPoints}), 0)`,
      distinctQuestions: sql<number>`count(distinct ${masteryEvents.questionId})`,
    })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, userId),
      eq(masteryEvents.canonicalSubcategory, domain),
      eq(masteryEvents.sourceType, 'author_credit'),
    ));

  return {
    points: Number(row?.points ?? 0),
    distinctQuestions: Number(row?.distinctQuestions ?? 0),
  };
}

async function writeTierCrossingActivityForFriends(params: {
  userId: string;
  domain: string;
  previousTier: MasteryTier;
  newTier: MasteryTier;
}) {
  void params;
  // TODO Phase 8: write friend_mastery activity for each friend when
  // friend system is built. Friends list: getFriends(userId).
}

/**
 * The best-effort tail of a mastery write: friend tier-crossing activity,
 * trust-on-play promotion, and the inviter first-five notification. None of
 * these feed the answer response or the daily summary, so they are safe to run
 * off the user-blocking path. Run inline by writeMasteryEvent unless
 * `deferSideEffects` was set, in which case the caller schedules this after the
 * response. Only valid to call when the mastery event was actually inserted.
 * Swallows its own errors — a failed side effect must never surface to the user.
 */
export async function runMasteryWriteSideEffects(params: {
  userId: string;
  domain: string;
  eventQuestionId: string | null | undefined;
  sourceType: MasteryEventSourceType;
  previousTier: MasteryTier;
  newTier: MasteryTier;
  tierChanged: boolean;
}): Promise<void> {
  if (params.tierChanged) {
    await writeTierCrossingActivityForFriends({
      userId: params.userId,
      domain: params.domain,
      previousTier: params.previousTier,
      newTier: params.newTier,
    });
  }

  // Human-play trust promotion + "nobody got it" smell (B4 Phase 2). A freshly
  // recorded human answer may push the canonical question over the
  // human_validated threshold or the nobody-correct smell. Skipped for
  // author/curator credit (no real answer_state) and when there is no canonical
  // question id to evaluate.
  if (
    params.eventQuestionId &&
    params.sourceType !== 'author_credit' &&
    params.sourceType !== 'curator_credit'
  ) {
    try {
      await evaluateQuestionTrustOnPlay(params.eventQuestionId);
    } catch (error) {
      console.warn('[mastery] trust-on-play evaluation failed', {
        questionId: params.eventQuestionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Only the surfaces a new user actually plays count toward the invited-friend
  // first-five milestone; author/curator credit and feed writes don't.
  if (params.sourceType === 'daily' || params.sourceType === 'joshing_game') {
    try {
      await maybeNotifyInviterOfFirstFive(params.userId);
    } catch (error) {
      console.warn('[mastery] inviter first-five notify failed', {
        userId: params.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function writeMasteryEvent(params: WriteMasteryEventParams): Promise<MasteryEventWriteResult> {
  const [existingMastery, authorCredit] = await Promise.all([
    db
      .select({
        broadCategory: playerMastery.broadCategory,
        totalPoints: playerMastery.totalPoints,
        tier: playerMastery.tier,
        tierReachedAt: playerMastery.tierReachedAt,
      })
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, params.userId),
        eq(playerMastery.canonicalSubcategory, params.domain),
      ))
      .limit(1),
    readAuthorCredit(params.userId, params.domain),
  ]);

  const existing = existingMastery[0];
  const broadCategory = normalizeBroadCategory(params.broadCategory ?? existing?.broadCategory);
  const previousTier: MasteryTier = existing?.tier ?? 'establishing';
  const nextTotalPoints = (existing?.totalPoints ?? 0) + params.pointsAwarded;
  const nextTier = params.pointsAwarded > 0
    ? effectiveTier(nextTotalPoints, authorCredit.points, authorCredit.distinctQuestions)
    : previousTier;
  const tierChanged = previousTier !== nextTier;
  const openedNewTerritory = !existing && params.pointsAwarded > 0;

  const eventInserted = await db.transaction(async (tx) => {
    // ON CONFLICT DO NOTHING covers the two unique constraints on
    // MASTERY_EVENTS: the answer_id key (per-submission idempotency for
    // double-clicks/retries) and the (source_type, question_id,
    // answered_by_user_id) key (cross-surface dedupe when the same canonical
    // question resurfaces via different generated/queue slots). When a
    // conflict skips the insert we must NOT credit player_mastery a second
    // time — the original event already did.
    const insertResult = await tx.execute<{ id: string }>(sql`
      insert into "MASTERY_EVENTS" (
        "user_id",
        "canonical_subcategory",
        "source_type",
        "question_id",
        "answered_by_user_id",
        "answer_id",
        "base_points",
        "weight",
        "awarded_points",
        "answer_state",
        "session_context",
        "llm_provider"
      ) values (
        ${params.userId},
        ${params.domain},
        ${
          params.sourceType === 'author_credit' || params.sourceType === 'curator_credit'
            ? params.sourceType
            : params.sourceType === 'catchup'
              ? 'catchup_correct'
              : 'live_correct'
        },
        ${params.eventQuestionId ?? null},
        ${params.answeredByUserId ?? params.userId},
        ${`${params.sourceType}:${params.sourceId}:${params.questionId}:${params.answeredByUserId ?? params.userId}`},
        ${Math.round(params.basePoints ?? params.pointsAwarded)},
        ${params.weight ?? (params.pointsAwarded > 0 ? 1 : 0)},
        ${params.pointsAwarded},
        ${params.sourceType === 'author_credit' || params.sourceType === 'curator_credit' ? null : (params.answerState ?? null)},
        ${params.sourceType},
        ${params.llmProvider ?? null}
      )
      on conflict do nothing
      returning "id"
    `);

    const inserted = insertResult.rows.length > 0;

    if (inserted && params.pointsAwarded > 0) {
      await tx
        .insert(playerMastery)
        .values({
          userId: params.userId,
          canonicalSubcategory: params.domain,
          broadCategory,
          totalPoints: params.pointsAwarded,
          tier: nextTier,
          tierReachedAt: tierChanged ? new Date() : null,
          lifetimePointsBaseline: 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [playerMastery.userId, playerMastery.canonicalSubcategory],
          set: {
            broadCategory,
            totalPoints: nextTotalPoints,
            tier: nextTier,
            tierReachedAt: tierChanged ? new Date() : existing?.tierReachedAt ?? null,
            updatedAt: new Date(),
          },
        });
    }

    return inserted;
  });

  if (!eventInserted) {
    return {
      domain: params.domain,
      broadCategory: broadCategory ?? null,
      points: 0,
      previousTier,
      newTier: previousTier,
      tierChanged: false,
      openedNewTerritory: false,
      eventInserted: false,
    };
  }

  // The event + mastery upsert above stay synchronous (the daily summary and the
  // response's masteryDelta both read them). Only this best-effort tail is
  // deferrable; when the caller opts in, it schedules runMasteryWriteSideEffects
  // itself off the critical path.
  if (!params.deferSideEffects) {
    await runMasteryWriteSideEffects({
      userId: params.userId,
      domain: params.domain,
      eventQuestionId: params.eventQuestionId,
      sourceType: params.sourceType,
      previousTier,
      newTier: nextTier,
      tierChanged,
    });
  }

  return {
    domain: params.domain,
    broadCategory: broadCategory ?? null,
    points: params.pointsAwarded,
    previousTier,
    newTier: nextTier,
    tierChanged,
    openedNewTerritory,
    eventInserted: true,
  };
}
