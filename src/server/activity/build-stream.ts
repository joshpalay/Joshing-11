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

export type BuildActivityStreamOptions = {
  /**
   * Rolling lower-bound window (in days) for the Zone-2 source scans (From
   * Friends, moments, convergence, activity texture). Omitted for the full
   * Lately / `/activities` list, where each query keeps its own wider
   * historical default; the home edition passes HOME_WINDOW_DAYS so the ambient
   * band is bounded to the dashboard window (D-HOME-DASHBOARD-MODEL-01).
   */
  windowDays?: number;
};

export async function buildActivityStream(
  userId: string,
  options: BuildActivityStreamOptions = {},
): Promise<StreamItem[]> {
  const { windowDays } = options;
  // The dependent question-resolution batch below only needs friendCards +
  // convergences (to know which question IDs to resolve). Activities and moments
  // are independent, so let them resolve alongside that batch instead of gating
  // it behind all four upstream queries — the critical path becomes
  // max(friendCards, convergences) + the dependent batch, with items/moments
  // overlapping rather than adding to it.
  const itemsPromise = getActivitiesForUser(userId, windowDays);
  const momentsPromise = getLatelyMoments(userId, windowDays);
  const [friendCards, convergences] = await Promise.all([
    getFriendActivity(userId, windowDays),
    getLatelyConvergences(userId, windowDays),
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
  const [items, moments, textById, priorById, hiddenIds] = await Promise.all([
    itemsPromise,
    momentsPromise,
    getMilestoneQuestionText(allQuestionIds),
    getViewerPriorAnswerResults(userId, allQuestionIds),
    // B-Report-3: durable self-hide — a question the viewer reported as
    // inappropriate (open|upheld) stays out of their Lately stack across reloads.
    getViewerHiddenQuestionIds(userId, allQuestionIds),
  ]);

  const utilityItems = filterUtilityActivities(items, moments)
    // Drop dead-end degraded rows. An "{actor} answered your question" card whose
    // actor is unknown (the friend/stranger deleted their account, so actorUserId
    // was nulled) AND whose question can't be shown renders as "Someone answered
    // your question" with nothing to see and nothing to open — remove it rather
    // than surface the hollow row (product call 2026-06-16). Consistent with
    // Decision D stripping the equivalent FeedItem actor cards
    // (D-ACCOUNT-DELETION-TERRITORY-01): a card you can't attribute AND can't
    // expand is not worth showing.
    .filter((item) => {
      if (item.actorUserId) return true;
      if (item.type === 'friend_answered_your_question') {
        return Boolean(item.reference.friendAnsweredQuestion?.questionText);
      }
      if (item.type === 'niche_match_answered_your_question') {
        return Boolean(item.reference.nicheMatch?.questionText);
      }
      return true;
    })
    .map(activityToStreamItem);
  const momentItems = moments.map(momentToStreamItem);
  const friendActivityItems = friendCards
    .map((card, i) => {
      const questions: StreamQuestion[] = cappedIdsByCard[i].ids
        .map((id) => textById.get(id))
        .filter((q): q is NonNullable<typeof q> => Boolean(q))
        .filter((q) => !hiddenIds.has(q.questionId))
        // Keep every still-answerable question in the bundle alongside the ones
        // the viewer already played — each carries its viewer-relative prior
        // result, so the played ones render as spent (hollow) triangles in the
        // expansion while the unplayed ones stay answerable.
        .map((q) => ({
          questionId: q.questionId,
          text: q.text,
          domain: q.domain,
          priorResult: priorById.get(q.questionId) ?? null,
          authorName: q.authorName,
          authorIsHouse: q.authorIsHouse,
        }));
      // D-HOME-DASHBOARD-MODEL-01 point 3 — a From Friends bundle is a dashboard
      // item, not an archive entry. Once the viewer has played EVERY answerable
      // question in it (remaining === 0) it is exhausted and disappears; this also
      // drops a contentless card whose questions all collapsed out. Partially-
      // played bundles stay, surfacing their remaining count. This OVERRIDES
      // D-FEED-FRIEND-ACTIVITY-01 §Q4 ("spent cards stay 30 days") for the fully-
      // exhausted case only. `priorResult` is per-viewer (getViewerPriorAnswer
      // Results(userId, …)), so the filter is viewer-relative and never shared
      // across users; the 30-day spent-card roll-off is now moot for exhausted
      // cards (they leave on exhaustion, not on a timer).
      const remaining = questions.filter((q) => q.priorResult === null).length;
      return remaining > 0 ? friendActivityToStreamItem(card, questions) : null;
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
