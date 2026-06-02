import assert from 'node:assert/strict';

// D-2 WS4 — niche-match dedup NON-collision guard.
//
// /activities runs filterUtilityActivities to drop activity rows that a Lately
// "connection moment" already narrates, so the same event never double-renders.
// The load-bearing D-2 invariant is the OPPOSITE: the two niche_match_* types
// must SURVIVE this filter unconditionally. Lately moments are friend-scoped,
// but niche-match fires only between strangers (the 'none' relationship), so the
// two are disjoint by construction — dropping a niche_match item here would
// silently delete the only surface the discovery loop renders on. This run
// guards that boundary at the `npm run smoke:*` layer.
import { filterUtilityActivities } from '../src/app/activities/filter-utility-activities';
import type { ActivityItemView } from '../src/server/db/queries/activity';
import type { LatelyMoment } from '../src/server/db/queries/lately';

// Minimal typed factory — only the fields filterUtilityActivities reads matter,
// but the base columns are required by ActivityItemView so we fill them.
function mk(
  id: string,
  type: ActivityItemView['type'],
  reference: ActivityItemView['reference'] = {},
): ActivityItemView {
  return {
    id,
    userId: 'viewer',
    actorUserId: 'actor',
    referenceId: 'ref',
    referenceType: 'question',
    read: false,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    type,
    actor: { displayName: 'Someone' },
    reference,
  };
}

function youGotThemMoment(questionId: string): LatelyMoment {
  return {
    momentId: `m-${questionId}`,
    dir: 'you_got_them',
    friendId: 'f1',
    friendName: 'Ada Lovelace',
    friendFirstName: 'Ada',
    questionId,
    questionText: 'Q?',
    category: 'music',
    gameTitle: 'Daily',
    answeredAt: new Date('2026-06-01T00:00:00.000Z'),
  };
}

// A full mix of items: the two niche_match types, the three utility types that
// SHOULD be deduped, and the variants of those types that should survive.
const items: ActivityItemView[] = [
  // niche-match — must always survive.
  mk('nm-author', 'niche_match_answered_your_question', { nicheMatch: { domain: 'Free Jazz', questionText: 'Q?' } }),
  mk('nm-answerer', 'niche_match_you_answered', { nicheMatch: { domain: 'Free Jazz', questionText: 'Q?' } }),
  // A niche-match item whose questionId collides with a you_got_them moment —
  // still must survive (niche-match is never keyed on questionId here).
  mk('nm-collide', 'niche_match_you_answered', { directQuestion: { feedItemId: 'fi', questionId: 'q-shared', questionText: 'Q?', personalMessage: null, category: null } }),

  // Utility types that the Lately moments already narrate — should be dropped.
  mk('drop-friend-correct', 'friend_answered_your_question', { friendAnsweredQuestion: { domain: 'Music', questionText: 'Q?', result: 'correct' } }),
  mk('drop-declared', 'declared_promoted'),
  mk('drop-direct-covered', 'received_direct_question', { directQuestion: { feedItemId: 'fi', questionId: 'q-shared', questionText: 'Q?', personalMessage: null, category: null } }),

  // Same families, but NOT covered by a moment — should survive.
  mk('keep-friend-incorrect', 'friend_answered_your_question', { friendAnsweredQuestion: { domain: 'Music', questionText: 'Q?', result: 'incorrect' } }),
  mk('keep-direct-uncovered', 'received_direct_question', { directQuestion: { feedItemId: 'fi', questionId: 'q-other', questionText: 'Q?', personalMessage: null, category: null } }),
];

const moments: LatelyMoment[] = [youGotThemMoment('q-shared')];

const surviving = filterUtilityActivities(items, moments).map((i) => i.id);

// The crux: both niche_match items survive, including the one whose questionId
// collides with a you_got_them moment.
assert.ok(surviving.includes('nm-author'), 'niche_match_answered_your_question must survive dedup');
assert.ok(surviving.includes('nm-answerer'), 'niche_match_you_answered must survive dedup');
assert.ok(surviving.includes('nm-collide'), 'niche-match must survive even on a questionId collision');

// The three covered utility rows are dropped.
assert.ok(!surviving.includes('drop-friend-correct'), 'a correct friend_answered_your_question is covered by they_got_you');
assert.ok(!surviving.includes('drop-declared'), 'declared_promoted is a strict subset of they_got_you');
assert.ok(!surviving.includes('drop-direct-covered'), 'a received_direct_question the viewer already got is covered by you_got_them');

// Their uncovered variants survive.
assert.ok(surviving.includes('keep-friend-incorrect'), 'an incorrect friend_answered_your_question is not deduped');
assert.ok(surviving.includes('keep-direct-uncovered'), 'a received_direct_question with no matching moment survives');

// Exact surviving set (order preserved from input).
assert.deepEqual(surviving, [
  'nm-author',
  'nm-answerer',
  'nm-collide',
  'keep-friend-incorrect',
  'keep-direct-uncovered',
]);

// No moments at all: only the type-keyed drops apply (friend-correct, declared).
const noMoments = filterUtilityActivities(items, []).map((i) => i.id);
assert.ok(noMoments.includes('drop-direct-covered'), 'with no you_got_them moment, the direct question is not deduped');
assert.ok(!noMoments.includes('drop-friend-correct'));
assert.ok(!noMoments.includes('drop-declared'));

console.log('niche-match-dedup.smoke: ok');
