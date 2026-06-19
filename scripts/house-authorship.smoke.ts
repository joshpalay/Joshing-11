import assert from 'node:assert/strict';

// D-3 house/editorial author + D-1 Stage 5 feed flip.
//
// These two surfaces share one provenance discriminator — the (source, creatorId)
// pair — and carry the load-bearing invariants:
//   H-1  a house question NEVER resolves to a users row (no person, no FK).
//   H-2  the client badges a house question off an explicit flag, not a name match.
//   C    house content never enters the Feed (it is curated, NOT LLM-origin).
//   D-1  friend_answered (type-3) is no longer rendered in the Feed.
// The unit tests cover the same modules; this smoke run guards them at the
// `npm run smoke:*` boundary so a regression trips the same gate as the others.
import {
  HOUSE_AUTHOR,
  LLM_QUESTION_ATTRIBUTION,
  QUESTION_SOURCES,
  isHouseAttribution,
  isLlmAttribution,
  parseQuestionSource,
  resolveAuthorDisplay,
  resolveQuestionAuthor,
} from '../src/lib/questions-types';
import {
  ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES,
  SOCIAL_FEED_SOURCE_TYPE,
  isCorrectAnswerFeedEligible,
  isLlmOriginQuestion,
  isMainFeedSourceVisible,
} from '../src/server/feed/visibility';

// --- Provenance union -------------------------------------------------------
// house_authored joined the union as a type-only change (free text, no migration).
assert.deepEqual(
  [...QUESTION_SOURCES],
  ['authored', 'daily_generated', 'curated_sent', 'house_authored'],
);

// parseQuestionSource is the trust-boundary guard: known values pass, unknown
// values fail LOUDLY rather than silently misrouting (e.g. a house question
// rendering as a person).
for (const source of QUESTION_SOURCES) {
  assert.equal(parseQuestionSource(source), source);
}
assert.throws(() => parseQuestionSource('person'), /Unknown Question\.source/);
assert.throws(() => parseQuestionSource(''), /Unknown Question\.source/);

// --- House identity is a sentinel, never a users row ------------------------
assert.equal(HOUSE_AUTHOR.id, 'house');
assert.equal(HOUSE_AUTHOR.kind, 'house');
assert.equal(LLM_QUESTION_ATTRIBUTION, 'Maid Acasa');
// The house label must NOT collide with the LLM-origin attribution.
assert.notEqual(HOUSE_AUTHOR.displayName, LLM_QUESTION_ATTRIBUTION);

// --- resolveQuestionAuthor: the single (creatorId, source) router -----------
// A real human creator hydrates the users row regardless of source.
assert.deepEqual(
  resolveQuestionAuthor({ creatorId: 'u1', source: 'authored', user: { name: 'Bob' } }),
  { kind: 'human', user: { name: 'Bob' } },
);
// Even a (set creatorId, house_authored) pair stays human — creatorId wins.
assert.equal(
  resolveQuestionAuthor({ creatorId: 'u1', source: 'house_authored', user: { name: 'Bob' } }).kind,
  'human',
);

// H-1: a house question (null creatorId) resolves to the house constant and is
// NEVER 'human'. This is the invariant that keeps the house unfollowable.
const house = resolveQuestionAuthor({ creatorId: null, source: 'house_authored', user: { name: 'Bob' } });
assert.deepEqual(house, { kind: 'house', displayName: 'Joshing', label: 'Editorial' });
assert.notEqual(house.kind, 'human');

// LLM origins (and an inconsistent null-creator 'authored') get the non-person
// LLM_QUESTION_ATTRIBUTION treatment, never a person and never the house.
for (const source of ['daily_generated', 'curated_sent', 'authored'] as const) {
  assert.deepEqual(
    resolveQuestionAuthor({ creatorId: null, source, user: { name: 'Bob' } }),
    { kind: 'generated', name: LLM_QUESTION_ATTRIBUTION },
  );
}

// --- resolveAuthorDisplay: explicit authorIsHouse flag (H-2) ----------------
assert.deepEqual(
  resolveAuthorDisplay('u1', 'authored', 'Bob'),
  { authorName: 'Bob', authorIsHouse: false },
);
// A house question yields the house name AND the robust flag, so the client
// never has to string-match the name (a human literally named "Joshing" must
// not be mistaken for the house author).
assert.deepEqual(
  resolveAuthorDisplay(null, 'house_authored', null),
  { authorName: 'Joshing', authorIsHouse: true },
);
// A human named "Joshing" is NOT the house author.
assert.deepEqual(
  resolveAuthorDisplay('u1', 'authored', 'Joshing'),
  { authorName: 'Joshing', authorIsHouse: false },
);
assert.deepEqual(
  resolveAuthorDisplay(null, 'daily_generated', null),
  { authorName: null, authorIsHouse: false },
);

// --- Attribution predicates -------------------------------------------------
assert.equal(isHouseAttribution('Joshing'), true);
assert.equal(isHouseAttribution('  Joshing  '), true); // trims
assert.equal(isHouseAttribution(LLM_QUESTION_ATTRIBUTION), false);
assert.equal(isHouseAttribution(null), false);
assert.equal(isHouseAttribution(undefined), false);

assert.equal(isLlmAttribution('Maid Acasa'), true);
assert.equal(isLlmAttribution('  Maid Acasa '), true);
assert.equal(isLlmAttribution('Joshing'), false);
assert.equal(isLlmAttribution(null), false);

// --- isLlmOriginQuestion: house is curated, NOT LLM-origin ------------------
assert.equal(isLlmOriginQuestion('daily_generated'), true);
assert.equal(isLlmOriginQuestion('curated_sent'), true);
assert.equal(isLlmOriginQuestion('authored'), false);
// The crux of D-3 §C: house questions are editorial, so they are not LLM-origin.
assert.equal(isLlmOriginQuestion('house_authored'), false);

// --- isCorrectAnswerFeedEligible -------------------------------------------
const base = { answerIsCorrect: true, answererUserId: 'answerer', hasVisibleSocialContext: true } as const;

// An LLM-origin correct answer is feed-eligible (no author to key on).
assert.equal(
  isCorrectAnswerFeedEligible({
    ...base,
    question: { creatorId: null, source: 'daily_generated', visibility: 'public', deletedAt: null },
  }),
  true,
);

// C invariant: a house question NEVER enters the Feed. It is not LLM-origin and
// has no creatorId, so it falls through to the null-creator guard → false.
assert.equal(
  isCorrectAnswerFeedEligible({
    ...base,
    question: { creatorId: null, source: 'house_authored', visibility: 'public', deletedAt: null },
  }),
  false,
);

// A human-authored question is eligible for a different answerer...
assert.equal(
  isCorrectAnswerFeedEligible({
    ...base,
    question: { creatorId: 'author', source: 'authored', visibility: 'public', deletedAt: null },
  }),
  true,
);
// ...but never for the author answering their own question.
assert.equal(
  isCorrectAnswerFeedEligible({
    ...base,
    answererUserId: 'author',
    question: { creatorId: 'author', source: 'authored', visibility: 'public', deletedAt: null },
  }),
  false,
);
// Hard gates: wrong answer, no social context, private, deleted, missing question.
assert.equal(isCorrectAnswerFeedEligible({ ...base, answerIsCorrect: false, question: { creatorId: 'a', source: 'authored', visibility: 'public', deletedAt: null } }), false);
assert.equal(isCorrectAnswerFeedEligible({ ...base, hasVisibleSocialContext: false, question: { creatorId: 'a', source: 'authored', visibility: 'public', deletedAt: null } }), false);
assert.equal(isCorrectAnswerFeedEligible({ ...base, question: { creatorId: 'a', source: 'authored', visibility: 'private', deletedAt: null } }), false);
assert.equal(isCorrectAnswerFeedEligible({ ...base, question: { creatorId: 'a', source: 'authored', visibility: 'public', deletedAt: new Date() } }), false);
assert.equal(isCorrectAnswerFeedEligible({ ...base, question: null }), false);

// --- D-1 Stage 5 feed flip: friend_answered (type-3) leaves the Feed --------
// The social source type is still WRITTEN (it backs Daily +2 and "Recently
// exploring"), but it is no longer one of the always-visible main-feed types.
assert.equal(SOCIAL_FEED_SOURCE_TYPE, 'friend_answered');
assert.equal(isMainFeedSourceVisible('friend_answered'), false);
assert.ok(
  !(ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES as readonly string[]).includes('friend_answered'),
  'friend_answered must not be a visible main-feed source after the feed flip',
);
// Broadcasts (authored_shared + legacy thumbs_upped) and Sent (direct_sent) stay.
assert.equal(isMainFeedSourceVisible('authored_shared'), true);
assert.equal(isMainFeedSourceVisible('direct_sent'), true);
assert.equal(isMainFeedSourceVisible('thumbs_upped'), true);
assert.equal(isMainFeedSourceVisible('totally_made_up'), false);

console.log('house-authorship.smoke: ok');
