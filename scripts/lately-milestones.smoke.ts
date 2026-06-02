import assert from 'node:assert/strict';

// D-4 §A Lately skill milestones (dual-form split + CORRECTION 3 5-cap).
//
// deriveLatelyMilestones is a pure transform over a viewer's correct
// `friend_answered` rows. The load-bearing rules it must keep:
//   - DEEP: a (friend, domain) group with ≥ MILESTONE_DEEP_MIN correct answers
//     becomes its own line, excluded from the breadth roll-up (no double-count).
//   - BREADTH: a friend's remaining light domains aggregate — but ONLY with ≥ 2
//     of them. A lone light domain is silent (neither form).
//   - DEDUP: the same canonical question answered twice cannot inflate a count.
//   - 5-CAP: no line surfaces more than MILESTONE_CARD_QUESTION_CAP questions; a
//     deep line keeps the 5 most-recent, and over-cap breadth SPLITS into
//     several honest lines instead of a "+N others" mega-card.
//   - ORDER: deterministic (sortAt desc, id tie-break) so the shape is assertable.
import {
  MILESTONE_CARD_QUESTION_CAP,
  MILESTONE_DEEP_MIN,
  MILESTONE_MIN_CORRECT,
  breadthMilestoneCopy,
  collectMilestoneQuestionIds,
  deriveLatelyMilestones,
  type MilestoneAnswerRow,
  type MilestoneBreadth,
  type MilestoneDeep,
  deepMilestoneCopy,
} from '../src/lib/lately-milestones';

// Seconds-since-epoch helper so the recency ordering in assertions is obvious.
const at = (t: number) => new Date(t * 1000);
const row = (
  friendId: string,
  friendFirstName: string,
  domain: string,
  questionId: string,
  t: number,
): MilestoneAnswerRow => ({
  friendId,
  friendName: `${friendFirstName} Lovelace`,
  friendFirstName,
  domain,
  questionId,
  answeredAt: at(t),
});

// --- Tunable thresholds -----------------------------------------------------
assert.equal(MILESTONE_MIN_CORRECT, 1);
assert.equal(MILESTONE_DEEP_MIN, 3);
assert.equal(MILESTONE_CARD_QUESTION_CAP, 5);

// --- Scenario A: one deep line + one breadth line ---------------------------
// Ada: Jazz ×3 (deep), Poetry ×2 + Film ×1 (two light domains → breadth).
const scenarioA = deriveLatelyMilestones([
  row('f1', 'Ada', 'Jazz', 'q1', 10),
  row('f1', 'Ada', 'Jazz', 'q2', 9),
  row('f1', 'Ada', 'Jazz', 'q3', 8),
  row('f1', 'Ada', 'Poetry', 'q5', 7),
  row('f1', 'Ada', 'Poetry', 'q6', 6),
  row('f1', 'Ada', 'Film', 'q4', 5),
]);

assert.equal(scenarioA.length, 2);
// Deep sorts ahead of breadth (its sortAt is the most recent answer, t=10).
const deep = scenarioA[0] as MilestoneDeep;
assert.equal(deep.kind, 'milestone_deep');
assert.equal(deep.domain, 'Jazz');
assert.equal(deep.correctCount, 3);
assert.deepEqual([...deep.questionIds].sort(), ['q1', 'q2', 'q3']);
assert.equal(deep.id, 'deep:f1:Jazz');

const breadth = scenarioA[1] as MilestoneBreadth;
assert.equal(breadth.kind, 'milestone_breadth');
// Light domains ordered most-recent first: Poetry (t=7) before Film (t=5).
assert.deepEqual(breadth.domains.map((d) => d.domain), ['Poetry', 'Film']);
// Jazz (the deep domain) is NOT double-counted into the breadth roll-up.
assert.ok(!breadth.domains.some((d) => d.domain === 'Jazz'));
assert.deepEqual(breadth.questionIds, ['q5', 'q6', 'q4']);

// Copy (PLACEHOLDER per spec, but the shape is contractual for the render layer).
assert.equal(deepMilestoneCopy(deep), 'Ada went deep on Jazz');
assert.equal(breadthMilestoneCopy(breadth), "Ada's been killing it — Poetry and Film");

// --- Scenario B: a lone light domain is silent ------------------------------
// One light domain (below the deep threshold, only one of it) → no milestone.
assert.deepEqual(
  deriveLatelyMilestones([
    row('f2', 'Bo', 'Chess', 'q7', 5),
    row('f2', 'Bo', 'Chess', 'q8', 4),
  ]),
  [],
);

// --- Scenario C: dedup keeps a repeat-answer off the deep threshold ---------
// The same questionId answered three times is ONE distinct question, so this
// single domain stays light-and-lonely (→ silent) rather than crossing to deep.
assert.deepEqual(
  deriveLatelyMilestones([
    row('f3', 'Cy', 'Opera', 'q9', 1),
    row('f3', 'Cy', 'Opera', 'q9', 2),
    row('f3', 'Cy', 'Opera', 'q9', 3),
  ]),
  [],
);

// --- Scenario D: breadth splits at the 5-question cap -----------------------
// Three light domains of 2 questions each = 6 > cap, so breadth packs into two
// lines (most-recent first), never a single over-cap card.
const scenarioD = deriveLatelyMilestones([
  row('f4', 'Di', 'D1', 'a1', 30),
  row('f4', 'Di', 'D1', 'a2', 29),
  row('f4', 'Di', 'D2', 'b1', 20),
  row('f4', 'Di', 'D2', 'b2', 19),
  row('f4', 'Di', 'D3', 'c1', 10),
  row('f4', 'Di', 'D3', 'c2', 9),
]);
assert.equal(scenarioD.length, 2);
for (const milestone of scenarioD) {
  assert.equal(milestone.kind, 'milestone_breadth');
  assert.ok(
    milestone.questionIds.length <= MILESTONE_CARD_QUESTION_CAP,
    'no breadth line may exceed the 5-question cap',
  );
}
// First line packs the two most-recent domains (D1+D2 = 4 ≤ 5); D3 spills over.
const [lineOne, lineTwo] = scenarioD as MilestoneBreadth[];
assert.deepEqual(lineOne.domains.map((d) => d.domain), ['D1', 'D2']);
assert.deepEqual(lineTwo.domains.map((d) => d.domain), ['D3']);

// --- Scenario E: a deep line keeps only the 5 most-recent questions ---------
const scenarioE = deriveLatelyMilestones(
  Array.from({ length: 7 }, (_, i) => row('f5', 'Ev', 'Sci', `s${i}`, i + 1)),
);
assert.equal(scenarioE.length, 1);
const bigDeep = scenarioE[0] as MilestoneDeep;
assert.equal(bigDeep.kind, 'milestone_deep');
assert.equal(bigDeep.correctCount, 7); // the true count is preserved...
assert.equal(bigDeep.questionIds.length, MILESTONE_CARD_QUESTION_CAP); // ...but only 5 surface
// The 5 most-recent (highest t) are kept: s6,s5,s4,s3,s2; s1,s0 are dropped.
assert.deepEqual([...bigDeep.questionIds].sort(), ['s2', 's3', 's4', 's5', 's6']);

// --- collectMilestoneQuestionIds: union of everything playable --------------
const ids = collectMilestoneQuestionIds(scenarioA);
assert.deepEqual([...ids].sort(), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
assert.deepEqual([...collectMilestoneQuestionIds([])], []);

console.log('lately-milestones.smoke: ok');
