import { after } from 'next/server';

import { updateDomainDifficultyOnAnswer } from '@/server/adaptive-difficulty';
import { readPriorAnswersForQuestion } from '@/server/answer-history';
import { computeAnswerState } from '@/server/answer-state';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import { awardAuthorCredit, isAuthorCreditEligible } from '@/server/mastery/author-credit';
import {
  writeMasteryEvent,
  type MasteryEventWriteResult,
  type WriteMasteryEventParams,
} from '@/server/mastery/write-mastery-event';
import type { AnswerState } from '@/types/db';

/**
 * The shared answer pipeline (B-ANSWER-PIPELINE-01 / STRUCT-03).
 *
 * Every answer surface (Daily Five, catch-up, feed, profile, milestone,
 * joshing game) runs the same sequence around its surface-specific state
 * write:
 *
 *   1. deriveAnswerOutcome   — mastery history → answer_state → points
 *   2. (route-owned)         — persist the surface's own state (queue slot,
 *                              feed item, …) and build its response
 *   3. recordAnswerSideEffects — mastery event, adaptive difficulty,
 *                              author credit, friend-feed propagation
 *
 * The split into two calls (rather than one orchestrator with a callback)
 * keeps the surface write and its response shape entirely in the route, and
 * lets routes preserve their existing parallelism (e.g. daily/answer resolves
 * the inside-joke display read concurrently with step 1).
 *
 * Per-surface differences enter as DATA (points weighting, source ids,
 * mastery sourceType) — never as branches in here. If a surface genuinely
 * needs different behavior, that behavior belongs in its route.
 */

export type AnswerOutcome = {
  masteryAnswerState: AnswerState;
  pointsAwarded: number;
};

export async function deriveAnswerOutcome(input: {
  userId: string;
  /** Canonical Question id to read mastery history against; null falls back to "first attempt". */
  canonicalQuestionId: string | null;
  isCorrect: boolean;
  /** Surface-specific weighting (e.g. daily: full base / recovery weight; catch-up: 25%). */
  pointsFor: (answerState: AnswerState) => number;
}): Promise<AnswerOutcome> {
  // Compute answer_state against masteryEvents history so first_correct vs
  // first_correct_after_wrong vs repeat_correct vs incorrect is determined
  // correctly across surfaces (F2.1). Falls back to "first attempt" only when
  // there is no canonical id to look history up against.
  const priorAnswers = input.canonicalQuestionId
    ? await readPriorAnswersForQuestion(input.userId, input.canonicalQuestionId)
    : [];
  const masteryAnswerState = computeAnswerState(input.isCorrect ? 'correct' : 'wrong', priorAnswers);
  return { masteryAnswerState, pointsAwarded: input.pointsFor(masteryAnswerState) };
}

export async function recordAnswerSideEffects(input: {
  userId: string;
  isCorrect: boolean;
  /** Route tag for log lines, e.g. 'daily/answer'. */
  logTag: string;
  /** Extra structured fields for the propagation-failure log line. */
  logContext?: Record<string, unknown>;
  masteryEvent: Omit<WriteMasteryEventParams, 'userId'>;
  /** Domain for adaptive-difficulty bookkeeping (fire-and-forget). */
  adaptiveDifficultyDomain: string;
  /**
   * Author credit + friend-feed fan-out. Pass null to skip entirely (no
   * canonical question to propagate, or a deliberate give-up).
   */
  propagation: {
    canonicalQuestionId: string;
    creator: { creatorId: string | null; domain: string | null };
    /** Dedup key for awardAuthorCredit, e.g. `daily:${key}:${userId}`. */
    creditSourceId: string;
    /** Observability scope for awardAuthorCredit, e.g. 'daily/answer'. */
    creditScope: string;
    /** Dedup key for createFeedItemsForFriendsFromAnswer. */
    feedSourceId: string;
  } | null;
}): Promise<MasteryEventWriteResult | null> {
  let masteryDelta: MasteryEventWriteResult | null = null;
  try {
    masteryDelta = await writeMasteryEvent({ userId: input.userId, ...input.masteryEvent });
  } catch (error) {
    console.warn(`[${input.logTag}] writeMasteryEvent failed`, error);
  }

  // Adaptive-difficulty bookkeeping is not consumed by the response; let it
  // run after we've already returned. The function swallows its own errors
  // via the .catch below, so an unhandled rejection cannot escape.
  void updateDomainDifficultyOnAnswer(
    input.userId,
    input.adaptiveDifficultyDomain,
    input.isCorrect,
  ).catch((err) => {
    console.warn(`[${input.logTag}] updateDomainDifficultyOnAnswer failed`, err);
  });

  if (input.propagation) {
    const { canonicalQuestionId, creator, creditSourceId, creditScope, feedSourceId } = input.propagation;
    try {
      const creditContext = {
        isCorrect: input.isCorrect,
        creatorId: creator.creatorId,
        answererUserId: input.userId,
        domain: creator.domain,
      };
      if (isAuthorCreditEligible(creditContext)) {
        void promoteDeclaredToDemonstrated({
          userId: creditContext.creatorId,
          domain: creditContext.domain,
          triggeringFriendId: input.userId,
          questionId: canonicalQuestionId,
        });

        // Author credit (PRD §8.32): off the user's hot path — queries the
        // answerer never sees in their response.
        void awardAuthorCredit({
          creatorUserId: creditContext.creatorId,
          answererUserId: input.userId,
          questionId: canonicalQuestionId,
          domain: creditContext.domain,
          sourceId: creditSourceId,
          scope: creditScope,
        });
      }

      // Fan-out runs after the response is sent: the user-visible reveal does
      // not depend on this work, and the propagation function swallows its
      // own errors (see create-feed-items-for-answer.ts). after() keeps the
      // function alive past the response so Vercel doesn't freeze the work
      // mid-flight — bare `void` would drop the promise on production lambdas.
      after(() => createFeedItemsForFriendsFromAnswer(
        input.userId,
        canonicalQuestionId,
        input.isCorrect ? 'correct' : 'incorrect',
        feedSourceId,
      ));
    } catch (error) {
      console.warn(`[${input.logTag}] feed propagation failed`, {
        ...input.logContext,
        canonicalQuestionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return masteryDelta;
}
