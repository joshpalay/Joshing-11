import { describe, expect, it } from 'vitest';

import {
  prefilterForVerification,
  type PrefilterDecision,
} from '@/server/quality/verification-prefilter';

// Pure unit — no DB, no network, no LLM. The whole point of Phase 2 is that a
// `needsVerification: false` decision provably short-circuits before any web call.

function decide(
  questionText: string,
  answer: string,
  explanation?: string | null,
): PrefilterDecision {
  return prefilterForVerification({ questionText, answer, explanation });
}

describe('prefilterForVerification — SKIP (never reaches the web)', () => {
  it('skips a bare ask over a stable canonical fact', () => {
    const d = decide('What is the capital of France?', 'Paris');
    expect(d.needsVerification).toBe(false);
    if (!d.needsVerification) expect(d.verdict).toBe('skipped');
  });

  it('does not treat a lone signal word in a bare ask as a premise', () => {
    // "first" is the ANSWER (Washington was the first president), not a separate
    // premise to check — no setup clause, so it must skip.
    const d = decide('Who was the first president of the United States?', 'George Washington');
    expect(d.needsVerification).toBe(false);
  });

  it('skips opinion-adjacent questions outright', () => {
    const d = decide('What is the best Beatles album?', 'Abbey Road');
    expect(d.needsVerification).toBe(false);
    if (!d.needsVerification) expect(d.reason).toMatch(/opinion/i);
  });
});

describe('prefilterForVerification — FALSE PREMISE routing', () => {
  it('routes a setup clause that embeds a count claim', () => {
    // The Bach case: a dash-delimited setup asserting "three for violin and three
    // for cello" (false — it is six of each). Answer is right; premise is not.
    const d = decide(
      'Bach composed six celebrated works for unaccompanied string instrument — three for solo violin and three for solo cello. What collective title is given to the works for solo cello?',
      'Cello Suites',
    );
    expect(d.needsVerification).toBe(true);
    if (d.needsVerification) expect(d.dimensions).toContain('false_premise');
  });

  it('routes the niche-fiction recurrence premise (the reported Spy School case)', () => {
    const d = decide(
      "In the Spy School series, one of the recurring antagonists is a student who repeatedly proves to be a thorn in Ben's side — not because he's a skilled spy, but because he's a bully and a schemer within the academy itself. What is this student's name?",
      'Chip Schacter',
    );
    expect(d.needsVerification).toBe(true);
    if (d.needsVerification) expect(d.dimensions).toContain('false_premise');
  });
});

describe('prefilterForVerification — EXTRA / ADJACENT FACT routing', () => {
  it('routes a bare ask whose explanation carries adjacent claims', () => {
    const d = decide(
      'Who wrote Pride and Prejudice?',
      'Jane Austen',
      'Jane Austen wrote Pride and Prejudice, published in 1813; it was her second published novel and is set in rural England.',
    );
    expect(d.needsVerification).toBe(true);
    if (d.needsVerification) expect(d.dimensions).toContain('extra_fact');
  });

  it('routes an answer that bundles an extra descriptor', () => {
    const d = decide(
      "What is the title of Beethoven's Third Symphony?",
      'Eroica (his Third, originally dedicated to Napoleon)',
    );
    expect(d.needsVerification).toBe(true);
    if (d.needsVerification) expect(d.dimensions).toContain('extra_fact');
  });
});

describe('prefilterForVerification — tightened extra_fact answer heuristic (2026-07)', () => {
  it('no longer routes a bundled answer that asserts nothing checkable', () => {
    // Separators without an assertion signal: a list is structure, not a claim.
    // Under the legacy heuristic the comma + "and" routed this to a paid verify.
    const d = decide('What items does Ben buy at the store?', 'Bread, eggs and milk');
    expect(d.needsVerification).toBe(false);
  });

  it('still routes a bundled answer whose descriptor carries a signal', () => {
    // "1804" (year) inside the bundle = a checkable adjacent claim.
    const d = decide(
      'Which symphony did Beethoven dedicate to a patron?',
      'Eroica (composed 1804)',
    );
    expect(d.needsVerification).toBe(true);
    if (d.needsVerification) expect(d.dimensions).toContain('extra_fact');
  });

  it('claim-bearing explanations still route regardless of the answer shape', () => {
    // The explanation path is untouched by the tightening.
    const d = decide(
      'Who painted the ceiling of the Sistine Chapel?',
      'Michelangelo',
      'Michelangelo painted it between 1508 and 1512, commissioned by Pope Julius II.',
    );
    expect(d.needsVerification).toBe(true);
    if (d.needsVerification) expect(d.dimensions).toContain('extra_fact');
  });

  it('the legacy escape hatch restores the old routing', () => {
    const input = { questionText: 'What items does Ben buy at the store?', answer: 'Bread, eggs and milk' };
    const strict = prefilterForVerification(input);
    const legacy = prefilterForVerification(input, { legacyExtraFact: true });
    expect(strict.needsVerification).toBe(false);
    expect(legacy.needsVerification).toBe(true);
    if (legacy.needsVerification) expect(legacy.dimensions).toContain('extra_fact');
  });
});

describe('prefilterForVerification — purity / determinism', () => {
  it('returns the same decision on repeated calls (no hidden state)', () => {
    const input = { questionText: 'What is the capital of France?', answer: 'Paris' };
    expect(prefilterForVerification(input)).toEqual(prefilterForVerification(input));
  });
});
