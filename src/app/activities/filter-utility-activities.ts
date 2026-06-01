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
export function filterUtilityActivities(
  items: ActivityItemView[],
  moments: LatelyMoment[],
): ActivityItemView[] {
  const youGotThemQuestionIds = new Set(
    moments.filter((m) => m.dir === 'you_got_them').map((m) => m.questionId),
  );
  return items.filter((i) => {
    if (
      i.type === 'friend_answered_your_question' &&
      i.reference.friendAnsweredQuestion?.result === 'correct'
    )
      return false;
    if (i.type === 'declared_promoted') return false;
    if (
      i.type === 'received_direct_question' &&
      i.reference.directQuestion?.questionId &&
      youGotThemQuestionIds.has(i.reference.directQuestion.questionId)
    )
      return false;
    return true;
  });
}
