/**
 * Unified activity-stream assembler (D-4 CORRECTION 2).
 *
 * Runs the three upstream queries — activity rows, Lately moments, Lately
 * milestones — applies the existing utility dedup, resolves the milestone
 * questions a viewer is allowed to answer, and merges everything through the
 * pure transforms in `@/lib/activity-stream` into one prominence-sorted
 * `StreamItem[]`. Both surfaces consume this single source:
 *   - the homepage "What's Happening" renders the home-eligible HEAD,
 *   - Lately / `/activities` renders the FULL list.
 */

import { filterUtilityActivities } from '@/app/activities/filter-utility-activities';
import {
  activityToStreamItem,
  convergenceToStreamItem,
  friendActivityToStreamItem,
  momentToStreamItem,
  type StreamItem,
  type StreamQuestion,
} from '@/lib/activity-stream';
import { convergenceCaptionTemplate, sortByProminence } from '@/lib/lately';
import { MILESTONE_CARD_QUESTION_CAP } from '@/lib/lately-milestones';
import { getActivitiesForUser } from '@/server/db/queries/activity';
import { getViewerHiddenQuestionIds } from '@/server/db/queries/content-reports';
import {
  getFriendActivity,
  getLatelyConvergences,
  getLatelyMoments,
  getMilestoneQuestionText,
  getViewerPriorAnswerResults,
} from '@/server/db/queries/lately';

export async function buildActivityStream(userId: string): Promise<StreamItem[]> {
  const [items, moments, friendCards, convergences] = await Promise.all([
    getActivitiesForUser(userId),
    getLatelyMoments(userId),
    getFriendActivity(userId),
    getLatelyConvergences(userId),
  ]);

  // Resolve every From Friends card's first ≤5 literal questions (most-recent
  // first) and every convergence's 3 cluster questions in one batch (text +
  // display domain), and the viewer's prior result on each (right OR wrong) — so
  // a question the viewer already attempted stays locked in the expansion across
  // reloads (an answered-in-place card keeps its spent triangles, Q4).
  const cappedIdsByCard = friendCards.map((c) => ({
    id: c.id,
    ids: c.questionIds.slice(0, MILESTONE_CARD_QUESTION_CAP),
  }));
  const allQuestionIds = [
    ...new Set([
      ...cappedIdsByCard.flatMap((c) => c.ids),
      ...convergences.flatMap((c) => c.questionIds),
    ]),
  ];
  const [textById, priorById, hiddenIds] = await Promise.all([
    getMilestoneQuestionText(allQuestionIds),
    getViewerPriorAnswerResults(userId, allQuestionIds),
    // B-Report-3: durable self-hide — a question the viewer reported as
    // inappropriate (open|upheld) stays out of their Lately stack across reloads.
    getViewerHiddenQuestionIds(userId, allQuestionIds),
  ]);

  const utilityItems = filterUtilityActivities(items, moments).map(
    activityToStreamItem,
  );
  const momentItems = moments.map(momentToStreamItem);
  const friendActivityItems = friendCards
    .map((card, i) => {
      const questions: StreamQuestion[] = cappedIdsByCard[i].ids
        .map((id) => textById.get(id))
        .filter((q): q is NonNullable<typeof q> => Boolean(q))
        .filter((q) => !hiddenIds.has(q.questionId))
        // Keep EVERY question in the bundle — including the ones the viewer
        // already answered. Each carries its prior result, so the answered ones
        // render as spent (hollow) triangles in the expansion and the card stays
        // put after you play it (Q4), drifting down by recency rather than
        // vanishing.
        .map((q) => ({
          questionId: q.questionId,
          text: q.text,
          domain: q.domain,
          priorResult: priorById.get(q.questionId) ?? null,
          authorName: q.authorName,
          authorIsHouse: q.authorIsHouse,
        }));
      // A card whose questions all collapse out (deleted / hidden) is contentless
      // — suppress it rather than render an empty triangle.
      return questions.length > 0 ? friendActivityToStreamItem(card, questions) : null;
    })
    .filter((item): item is StreamItem => item !== null);
  const convergenceItems = convergences.map((c) => {
    const questions: StreamQuestion[] = c.questionIds
      .map((id) => textById.get(id))
      .filter((q): q is NonNullable<typeof q> => Boolean(q))
      .filter((q) => !hiddenIds.has(q.questionId))
      .map((q) => ({
        questionId: q.questionId,
        text: q.text,
        domain: q.domain,
        priorResult: 'correct' as const, // read-only reveal: both already answered correctly
        authorName: q.authorName,
        authorIsHouse: q.authorIsHouse,
      }));
    // Single-topic headline (Pool 3a) only when EVERY surviving cluster question
    // resolved to the same non-null domain; otherwise the topic-less set (3b).
    const domains = questions.map((q) => q.domain);
    const sharedTopic =
      questions.length > 0 && domains.every((d): d is string => Boolean(d)) && new Set(domains).size === 1
        ? domains[0]
        : null;
    return convergenceToStreamItem(c, questions, convergenceCaptionTemplate(c.id, sharedTopic), sharedTopic);
  });

  return sortByProminence([
    ...momentItems,
    ...friendActivityItems,
    ...convergenceItems,
    ...utilityItems,
  ]);
}
