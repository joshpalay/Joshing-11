import assert from 'node:assert/strict';

import { verdictToPublicStatus } from '../src/server/llm/vet-verdict.ts';

const approved = verdictToPublicStatus({ status: 'approved', score: 0.82, reason: 'specific and verifiable' });
assert.equal(approved.publicStatus, 'eligible_pending');
assert.equal(approved.publicEligibilityScore, 0.82);
assert.equal(approved.publicEligibilityReason, 'specific and verifiable');

const rejected = verdictToPublicStatus({ status: 'rejected', score: 0.12, reason: 'factual: wrong answer' });
assert.equal(rejected.publicStatus, 'rejected');
assert.equal(rejected.publicEligibilityScore, 0.12);
assert.equal(rejected.publicEligibilityReason, 'factual: wrong answer');

const needsReview = verdictToPublicStatus({ status: 'needs_review', score: null, reason: 'llm_error' });
assert.equal(needsReview.publicStatus, 'not_scored');
assert.equal(needsReview.publicEligibilityScore, null);
assert.equal(needsReview.publicEligibilityReason, 'llm_error');

const needsReviewWithScore = verdictToPublicStatus({ status: 'needs_review', score: 0.6, reason: 'unverifiable: niche claim' });
assert.equal(needsReviewWithScore.publicStatus, 'not_scored');
assert.equal(needsReviewWithScore.publicEligibilityScore, 0.6);

console.log('question-vetting.smoke: ok');
