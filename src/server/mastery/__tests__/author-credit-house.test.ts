import { describe, expect, it } from 'vitest';

import { isAuthorCreditEligible } from '@/server/mastery/author-credit';
import { resolveQuestionAuthor } from '@/lib/questions-types';

// D-3 Stage 4 — provenance + mastery invariants.
//
// House authorship accrues NO mastery. isAuthorCreditEligible is the single gate
// the daily and catch-up answer routes pass through before writing an
// `author_credit` mastery event (and before promoteDeclaredToDemonstrated). A
// house question carries creatorId=null, so it can never pass the gate — which
// is exactly why a correctly-answered house question:
//   - writes no author_credit / curator mastery event, AND
//   - never appears in the "written by me" archive (keyed on creatorId = me), AND
//   - contributes no knowledge "recently expanding" saved-questions signal
//     (keyed on author_credit events).
// All three derive from this one gate, so this is the load-bearing regression.
//
// The curator-credit path (addToBank in db/queries/bank.ts) is a SEPARATE writer
// but is gated identically — `question.creatorId && creatorId !== userId` — so a
// null-creator house question accrues no curator_credit either. Both gates fail
// on the same `creatorId === null` construction; this suite asserts the shared
// answer-route gate and the provenance coherence it relies on.

describe('isAuthorCreditEligible — house questions accrue zero author/curator mastery', () => {
  const answerer = 'answerer-1';

  it('denies credit for a correctly-answered house question (creatorId is null)', () => {
    expect(isAuthorCreditEligible({
      isCorrect: true,
      creatorId: null, // house_authored questions are creatorId=null by construction
      answererUserId: answerer,
      domain: 'Bowie-era Glam Rock',
    })).toBe(false);
  });

  it('also denies credit for the LLM origins (same null-creator construction)', () => {
    expect(isAuthorCreditEligible({
      isCorrect: true,
      creatorId: null,
      answererUserId: answerer,
      domain: 'Bowie-era Glam Rock',
    })).toBe(false);
  });

  it('still grants credit to a real human author who is not the answerer', () => {
    expect(isAuthorCreditEligible({
      isCorrect: true,
      creatorId: 'human-author-9',
      answererUserId: answerer,
      domain: 'Bowie-era Glam Rock',
    })).toBe(true);
  });

  it('denies credit for wrong answers, self-answers, and missing domains', () => {
    const base = { creatorId: 'human-author-9', answererUserId: answerer, domain: 'music' };
    expect(isAuthorCreditEligible({ ...base, isCorrect: false })).toBe(false);
    expect(isAuthorCreditEligible({ ...base, isCorrect: true, answererUserId: 'human-author-9' })).toBe(false);
    expect(isAuthorCreditEligible({ ...base, isCorrect: true, domain: null })).toBe(false);
    expect(isAuthorCreditEligible({ ...base, isCorrect: true, domain: '' })).toBe(false);
  });
});

describe('house provenance is coherent: (source=house_authored, creatorId=null) never resolves to a creditable human', () => {
  it('resolves to the house identity, not a human author', () => {
    const resolved = resolveQuestionAuthor({ creatorId: null, source: 'house_authored', user: { id: 'x' } });
    expect(resolved.kind).toBe('house');
    // A 'house' result has no `user` — there is no users row to credit.
    expect('user' in resolved).toBe(false);
  });
});
