import type { ActivityItemView } from '@/server/db/queries/activity';
import type { LatelyMoment } from '@/server/db/queries/lately';

// Connection moments come from getLatelyMoments (both directions). Three
// activity types narrate the same event and would double-render:
//   - friend_answered_your_question (correct): already covered by the
//     they_got_you moment.
//   - declared_promoted: a strict subset of they_got_you (correct answer
//     plus a domain transition). The "SEE YOUR MAP" CTA lives on /knowledge.
//   - received_direct_question whose question the viewer already got
//     correctly: covered by the you_got_them moment for that questionId.
//
// D-2 NICHE-MATCH NOTE — do NOT add the niche_match_* types to this dedup set.
// Lately moments (getLatelyMoments, both directions) are FRIEND-scoped, but
// niche-match only fires between strangers (the 'none' relationship state — see
// notifyNicheMatch's stranger gate), so a niche-match item can never collide
// with a they_got_you / you_got_them moment for the same questionId. They are
// disjoint by construction; dropping them here would silently delete the only
// surface the discovery loop renders on. Covered by the
// filter-utility-activities tests.
export function filterUtilityActivities(
  items: ActivityItemView[],
  moments: LatelyMoment[],
): ActivityItemView[] {
  const youGotThemQuestionIds = new Set(
    moments
      .filter((m) => m.dir === 'you_got_them')
      .map((m) => m.questionId),
  );
  return items.filter((i) => {
    if (
      i.type === 'friend_answered_your_question' &&
      i.reference.friendAnsweredQuestion?.result === 'correct'
    ) return false;
    if (i.type === 'declared_promoted') return false;
    if (
      i.type === 'received_direct_question' &&
      i.reference.directQuestion?.questionId &&
      youGotThemQuestionIds.has(i.reference.directQuestion.questionId)
    ) return false;
    return true;
  });
}
