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
  milestoneToStreamItem,
  momentToStreamItem,
  type StreamItem,
  type StreamQuestion,
} from '@/lib/activity-stream';
import { convergenceCaptionTemplate, sortByProminence } from '@/lib/lately';
import { MILESTONE_CARD_QUESTION_CAP } from '@/lib/lately-milestones';
import { getActivitiesForUser } from '@/server/db/queries/activity';
import { getViewerHiddenQuestionIds } from '@/server/db/queries/content-reports';
import {
  getLatelyConvergences,
  getLatelyMilestones,
  getLatelyMoments,
  getMilestoneQuestionText,
  getViewerPriorAnswerResults,
} from '@/server/db/queries/lately';

export async function buildActivityStream(userId: string): Promise<StreamItem[]> {
  const [items, moments, milestones, convergences] = await Promise.all([
    getActivitiesForUser(userId),
    getLatelyMoments(userId),
    getLatelyMilestones(userId),
    getLatelyConvergences(userId),
  ]);

  // Resolve every milestone's first ≤5 literal questions and every
  // convergence's 3 cluster questions in one batch (text + display domain), and
  // the viewer's prior result on each (right OR wrong) — so a question the
  // viewer already attempted stays locked in the expansion across reloads.
  const cappedIdsByMilestone = milestones.map((m) => ({
    id: m.id,
    ids: m.questionIds.slice(0, MILESTONE_CARD_QUESTION_CAP),
  }));
  const allQuestionIds = [
    ...new Set([
      ...cappedIdsByMilestone.flatMap((m) => m.ids),
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
  const milestoneItems = milestones
    .map((m, i) => {
      const questions: StreamQuestion[] = cappedIdsByMilestone[i].ids
        .map((id) => textById.get(id))
        .filter((q): q is NonNullable<typeof q> => Boolean(q))
        .filter((q) => !hiddenIds.has(q.questionId))
        // Keep EVERY one of the friend's questions in the bundle — including the
        // ones the viewer already answered. Each carries its prior result, so the
        // answered ones render as spent (hollow) triangles in the expansion and
        // the title stays stable across reloads (answered questions don't vanish,
        // and the triangle count doesn't shrink as you play).
        .map((q) => ({
          questionId: q.questionId,
          text: q.text,
          domain: q.domain,
          priorResult: priorById.get(q.questionId) ?? null,
        }));
      // A milestone whose questions all collapse out is a contentless streak
      // card — suppress it rather than render an empty triangle.
      return questions.length > 0 ? milestoneToStreamItem(m, questions) : null;
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
      }));
    return convergenceToStreamItem(c, questions, convergenceCaptionTemplate(c.id));
  });

  return sortByProminence([
    ...momentItems,
    ...milestoneItems,
    ...convergenceItems,
    ...utilityItems,
  ]);
}
