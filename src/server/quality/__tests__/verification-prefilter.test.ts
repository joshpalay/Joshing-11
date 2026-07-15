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
    // Survives BOTH tightenings: the explainer's year claim is a kind the
    // question+answer never carried (novel adjacent claim).
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

describe('prefilterForVerification — tightened explanation heuristic (2026-07-05)', () => {
  it('no longer routes an explanation that merely restates the asked fact-kind', () => {
    // The stem/answer are ABOUT a year; the explainer's only signal is that same
    // year. That's context, not an adjacent claim — under the legacy heuristic
    // this routed to a paid verify (any one signal).
    const d = decide(
      'In what year did the Titanic sink?',
      '1912',
      'The Titanic sank in 1912 after striking an iceberg, and the disaster prompted sweeping changes to maritime safety law.',
    );
    expect(d.needsVerification).toBe(false);
  });

  it('no longer routes long pure-prose explanations (length is not a claim)', () => {
    // ≥140 chars but zero assertion signals — legacy routed on length alone.
    const d = decide(
      'What is the capital of France?',
      'Paris',
      'Paris has long been celebrated as a global center of art, fashion, gastronomy and culture, and its cafe-lined boulevards draw countless visitors from far beyond its borders.',
    );
    expect(d.needsVerification).toBe(false);
  });

  it('still routes an explanation that volunteers a NOVEL claim kind', () => {
    // Question asks a "who"; the explainer volunteers a date — a checkable
    // adjacent claim the question never asked about.
    const d = decide(
      'Who wrote The Waste Land?',
      'T. S. Eliot',
      'T. S. Eliot published The Waste Land in 1922, and it quickly became one of the most influential poems of the modernist movement.',
    );
    expect(d.needsVerification).toBe(true);
    if (d.needsVerification) expect(d.dimensions).toContain('extra_fact');
  });

  it('still routes a claim-dense explainer (two-plus signal kinds)', () => {
    const d = decide(
      "What is the title of Beethoven's Third Symphony?",
      'Eroica',
      'Beethoven composed the Eroica in 1804 and it was the first of his symphonies to break with classical convention.',
    );
    expect(d.needsVerification).toBe(true);
    if (d.needsVerification) expect(d.dimensions).toContain('extra_fact');
  });

  it('the legacy explanation hatch restores the old routing', () => {
    const input = {
      questionText: 'In what year did the Titanic sink?',
      answer: '1912',
      explanation:
        'The Titanic sank in 1912 after striking an iceberg, and the disaster prompted sweeping changes to maritime safety law.',
    };
    const strict = prefilterForVerification(input);
    const legacy = prefilterForVerification(input, { legacyExplanation: true });
    expect(strict.needsVerification).toBe(false);
    expect(legacy.needsVerification).toBe(true);
    if (legacy.needsVerification) expect(legacy.dimensions).toContain('extra_fact');
  });
});

describe('prefilterForVerification — ambiguous_source (self-containment) routing', () => {
  it('routes a fiction question that never names its own source', () => {
    // The reported Phineas and Ferb case: the served card shows only the question
    // text + broad category, never "Phineas and Ferb", so this is unanswerable.
    const d = prefilterForVerification({
      questionText:
        "At the start of most episodes, Candace notices the boys' project and immediately reaches for her phone. Whom does she call to try to get them busted?",
      answer: 'their mother',
      canonicalSubcategory: 'Phineas and Ferb',
    });
    expect(d.needsVerification).toBe(true);
    if (d.needsVerification) expect(d.dimensions).toContain('ambiguous_source');
  });

  it('does NOT route when the stem names its source', () => {
    const d = prefilterForVerification({
      questionText: "In Phineas and Ferb, what is the name of the boys' pet platypus?",
      answer: 'Perry',
      canonicalSubcategory: 'Phineas and Ferb',
    });
    if (d.needsVerification) expect(d.dimensions).not.toContain('ambiguous_source');
    else expect(d.verdict).toBe('skipped');
  });

  it('matches the source via an alias the subcategory string also contains', () => {
    // Stem says "Ulysses"; subcategory is "James Joyce's Ulysses" — the shared
    // token means the source IS named, so no ambiguous_source route.
    const d = prefilterForVerification({
      questionText: 'In Ulysses, what newspaper does Leopold Bloom work for as an ad canvasser?',
      answer: 'the Freemans Journal',
      canonicalSubcategory: "James Joyce's Ulysses",
    });
    if (d.needsVerification) expect(d.dimensions).not.toContain('ambiguous_source');
  });

  it('does NOT route a self-contained concept question with no foreign proper noun', () => {
    const d = prefilterForVerification({
      questionText:
        'What is the term for a carbon atom bonded to four different substituents that makes a molecule chiral?',
      answer: 'stereocenter',
      canonicalSubcategory: 'Organic Chemistry',
    });
    if (d.needsVerification) expect(d.dimensions).not.toContain('ambiguous_source');
  });

  it('is inert without a subcategory (existing callers unaffected)', () => {
    const input = {
      questionText:
        "At the start of most episodes, Candace notices the boys' project and immediately reaches for her phone. Whom does she call to try to get them busted?",
      answer: 'their mother',
    };
    const without = prefilterForVerification(input);
    const withSub = prefilterForVerification({ ...input, canonicalSubcategory: 'Phineas and Ferb' });
    if (without.needsVerification) expect(without.dimensions).not.toContain('ambiguous_source');
    expect(withSub.needsVerification).toBe(true);
    if (withSub.needsVerification) expect(withSub.dimensions).toContain('ambiguous_source');
  });
});

describe('prefilterForVerification — purity / determinism', () => {
  it('returns the same decision on repeated calls (no hidden state)', () => {
    const input = { questionText: 'What is the capital of France?', answer: 'Paris' };
    expect(prefilterForVerification(input)).toEqual(prefilterForVerification(input));
  });
});
