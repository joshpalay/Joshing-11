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
  milestoneToStreamItem,
  momentToStreamItem,
  type StreamItem,
  type StreamQuestion,
} from '@/lib/activity-stream';
import { sortByProminence } from '@/lib/lately';
import { MILESTONE_CARD_QUESTION_CAP } from '@/lib/lately-milestones';
import { getActivitiesForUser } from '@/server/db/queries/activity';
import {
  getLatelyMilestones,
  getLatelyMoments,
  getMilestoneQuestionText,
  getViewerCorrectlyAnsweredIds,
} from '@/server/db/queries/lately';

export async function buildActivityStream(userId: string): Promise<StreamItem[]> {
  const [items, moments, milestones] = await Promise.all([
    getActivitiesForUser(userId),
    getLatelyMoments(userId),
    getLatelyMilestones(userId),
  ]);

  // Resolve every milestone's first ≤5 literal questions in one batch (text +
  // display domain), and which of them the viewer already answered correctly.
  const cappedIdsByMilestone = milestones.map((m) => ({
    id: m.id,
    ids: m.questionIds.slice(0, MILESTONE_CARD_QUESTION_CAP),
  }));
  const allMilestoneIds = [
    ...new Set(cappedIdsByMilestone.flatMap((m) => m.ids)),
  ];
  const [textById, answeredIds] = await Promise.all([
    getMilestoneQuestionText(allMilestoneIds),
    getViewerCorrectlyAnsweredIds(userId, allMilestoneIds),
  ]);

  const utilityItems = filterUtilityActivities(items, moments).map(
    activityToStreamItem,
  );
  const momentItems = moments.map(momentToStreamItem);
  const milestoneItems = milestones.map((m, i) => {
    const questions: StreamQuestion[] = cappedIdsByMilestone[i].ids
      .map((id) => textById.get(id))
      .filter((q): q is NonNullable<typeof q> => Boolean(q))
      .map((q) => ({
        questionId: q.questionId,
        text: q.text,
        domain: q.domain,
        answered: answeredIds.has(q.questionId),
      }));
    return milestoneToStreamItem(m, questions);
  });

  return sortByProminence([...momentItems, ...milestoneItems, ...utilityItems]);
}
